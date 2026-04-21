import { readFile } from 'fs/promises';
import { join } from 'path';

import { consola } from 'consola';

import { createDefaultConfig, DEFAULT_ARCHITECTURE, DEFAULT_THRESHOLDS } from './types';

import type {
  AnalysisConfig,
  AnalysisThresholds,
  ArchitectureConfig,
  ArchitectureForbiddenRule,
  ArchitectureLayer,
} from './types';

const logger = consola.withTag('AnalysisConfig');

const DEFAULT_CONFIG_FILENAME = 'typescript-viewer.analysis.json';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getThresholdBucket(
  source: Record<string, unknown>,
  key: keyof AnalysisThresholds,
  fallback: { warning: number; error: number }
): { warning: number; error: number } {
  const raw = source[key];
  if (!isRecord(raw)) {
    return { ...fallback };
  }
  const warningValue = raw['warning'];
  const errorValue = raw['error'];
  return {
    warning: typeof warningValue === 'number' ? warningValue : fallback.warning,
    error: typeof errorValue === 'number' ? errorValue : fallback.error,
  };
}

function mergeThresholds(partial: unknown): AnalysisThresholds {
  if (!isRecord(partial)) {
    return {
      cyclomatic: { ...DEFAULT_THRESHOLDS.cyclomatic },
      cognitive: { ...DEFAULT_THRESHOLDS.cognitive },
      methodLines: { ...DEFAULT_THRESHOLDS.methodLines },
      parameters: { ...DEFAULT_THRESHOLDS.parameters },
      anyDensity: { ...DEFAULT_THRESHOLDS.anyDensity },
    };
  }
  return {
    cyclomatic: getThresholdBucket(partial, 'cyclomatic', DEFAULT_THRESHOLDS.cyclomatic),
    cognitive: getThresholdBucket(partial, 'cognitive', DEFAULT_THRESHOLDS.cognitive),
    methodLines: getThresholdBucket(partial, 'methodLines', DEFAULT_THRESHOLDS.methodLines),
    parameters: getThresholdBucket(partial, 'parameters', DEFAULT_THRESHOLDS.parameters),
    anyDensity: getThresholdBucket(partial, 'anyDensity', DEFAULT_THRESHOLDS.anyDensity),
  };
}

function parseLayers(raw: unknown): ArchitectureLayer[] {
  if (!Array.isArray(raw)) {
    return DEFAULT_ARCHITECTURE.layers.map((layer) => ({ name: layer.name, paths: [...layer.paths] }));
  }
  const layers: ArchitectureLayer[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const name = entry['name'];
    const paths = entry['paths'];
    if (typeof name !== 'string' || !Array.isArray(paths)) continue;
    layers.push({
      name,
      paths: paths.filter((p): p is string => typeof p === 'string'),
    });
  }
  return layers;
}

function parseForbiddenRule(raw: unknown): ArchitectureForbiddenRule | null {
  if (!isRecord(raw)) return null;
  const from = raw['from'];
  const to = raw['to'];
  if (typeof from !== 'string' || typeof to !== 'string') return null;
  const severityValue = raw['severity'];
  const severity: ArchitectureForbiddenRule['severity'] =
    severityValue === 'info' || severityValue === 'warning' || severityValue === 'error' ? severityValue : undefined;
  return severity !== undefined ? { from, to, severity } : { from, to };
}

function parseArchitectureRules(raw: unknown): { forbidden: ArchitectureForbiddenRule }[] {
  if (!Array.isArray(raw)) {
    return DEFAULT_ARCHITECTURE.rules.map((rule) => ({ forbidden: { ...rule.forbidden } }));
  }
  const rules: { forbidden: ArchitectureForbiddenRule }[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const forbidden = parseForbiddenRule(entry['forbidden']);
    if (forbidden) rules.push({ forbidden });
  }
  return rules;
}

function mergeArchitecture(partial: unknown): ArchitectureConfig {
  if (!isRecord(partial)) {
    return {
      layers: DEFAULT_ARCHITECTURE.layers.map((layer) => ({ name: layer.name, paths: [...layer.paths] })),
      rules: DEFAULT_ARCHITECTURE.rules.map((rule) => ({ forbidden: { ...rule.forbidden } })),
    };
  }
  return {
    layers: parseLayers(partial['layers']),
    rules: parseArchitectureRules(partial['rules']),
  };
}

function mergeEslint(
  partial: unknown,
  fallback: AnalysisConfig['eslint']
): AnalysisConfig['eslint'] {
  if (!isRecord(partial)) {
    return { extendsBuiltin: fallback.extendsBuiltin, extraRules: { ...fallback.extraRules } };
  }
  const extendsBuiltin = partial['extendsBuiltin'];
  const extraRules = partial['extraRules'];
  return {
    extendsBuiltin: typeof extendsBuiltin === 'boolean' ? extendsBuiltin : fallback.extendsBuiltin,
    extraRules: isRecord(extraRules) ? { ...extraRules } : { ...fallback.extraRules },
  };
}

function mergeExclusions(
  partial: unknown,
  fallback: AnalysisConfig['exclusions']
): AnalysisConfig['exclusions'] {
  if (!isRecord(partial)) {
    return { paths: [...fallback.paths] };
  }
  const paths = partial['paths'];
  if (!Array.isArray(paths)) {
    return { paths: [...fallback.paths] };
  }
  return { paths: paths.filter((p): p is string => typeof p === 'string') };
}

function mergeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((entry): entry is string => typeof entry === 'string');
}

function mergeConfig(raw: unknown): AnalysisConfig {
  const defaults = createDefaultConfig();
  if (!isRecord(raw)) {
    return defaults;
  }

  const merged: AnalysisConfig = {
    thresholds: mergeThresholds(raw['thresholds']),
    eslint: mergeEslint(raw['eslint'], defaults.eslint),
    architecture: mergeArchitecture(raw['architecture']),
    exclusions: mergeExclusions(raw['exclusions'], defaults.exclusions),
  };

  const enabledAnalyzers = mergeStringArray(raw['enabledAnalyzers']);
  if (enabledAnalyzers !== undefined) {
    merged.enabledAnalyzers = enabledAnalyzers;
  }

  const disabledAnalyzers = mergeStringArray(raw['disabledAnalyzers']);
  if (disabledAnalyzers !== undefined) {
    merged.disabledAnalyzers = disabledAnalyzers;
  }

  const deep = raw['deep'];
  if (typeof deep === 'boolean') {
    merged.deep = deep;
  }

  const maxWorkers = raw['maxWorkers'];
  if (typeof maxWorkers === 'number') {
    merged.maxWorkers = maxWorkers;
  }

  return merged;
}

export async function loadAnalysisConfig(packageRoot: string, overridePath?: string): Promise<AnalysisConfig> {
  const configPath = overridePath ?? join(packageRoot, DEFAULT_CONFIG_FILENAME);
  let fileContents: string;
  try {
    fileContents = await readFile(configPath, 'utf-8');
  } catch (error) {
    const code = isRecord(error) && typeof error['code'] === 'string' ? error['code'] : undefined;
    if (code !== 'ENOENT' && overridePath !== undefined) {
      logger.warn(
        `Could not read analysis config at ${configPath}; using defaults.`,
        error instanceof Error ? error.message : String(error)
      );
    } else if (code !== 'ENOENT') {
      logger.debug(
        `Analysis config not accessible at ${configPath}; using defaults.`,
        error instanceof Error ? error.message : String(error)
      );
    }
    return createDefaultConfig();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fileContents);
  } catch (error) {
    logger.warn(
      `Analysis config at ${configPath} is not valid JSON; falling back to defaults.`,
      error instanceof Error ? error.message : String(error)
    );
    return createDefaultConfig();
  }

  const merged = mergeConfig(parsed);
  logger.info(`Loaded analysis config from ${configPath}`);
  return merged;
}

export function analyzerEnabled(analyzerId: string, config: AnalysisConfig): boolean {
  if (config.disabledAnalyzers?.includes(analyzerId)) {
    return false;
  }
  if (config.enabledAnalyzers && config.enabledAnalyzers.length > 0) {
    return config.enabledAnalyzers.includes(analyzerId);
  }
  return true;
}
