import { spawn } from 'node:child_process';
import { basename, isAbsolute, relative, resolve } from 'node:path';

import { generateCodeIssueUUID, generateEntityMetricUUID } from '../../utils/uuid';

import type {
  AnalysisConfig,
  Analyzer,
  AnalyzerCapability,
  AnalyzerCategory,
  AnalyzerContext,
  AnalyzerResult,
} from '../types';
import type { IModuleCreateDTO } from '../../../shared/types/dto/ModuleDTO';
import type { ICodeIssueCreateDTO } from '../../../shared/types/dto/CodeIssueDTO';
import type { IEntityMetricCreateDTO } from '../../../shared/types/dto/EntityMetricDTO';

/** The default subprocess timeout (ms) used when invoking knip. */
const KNIP_TIMEOUT_MS = 60_000;

/** A single nested issue entry within a knip per-file issue record. */
interface KnipIssueEntry {
  name?: string;
  line?: number;
  col?: number;
  pos?: number;
}

/** Per-file knip issue record. Fields are optional because schemas vary across knip versions. */
interface KnipFileIssues {
  file?: string;
  files?: KnipIssueEntry[] | boolean;
  unlisted?: KnipIssueEntry[];
  unresolved?: KnipIssueEntry[];
  exports?: KnipIssueEntry[];
  nsExports?: KnipIssueEntry[];
  types?: KnipIssueEntry[];
  nsTypes?: KnipIssueEntry[];
  duplicates?: KnipIssueEntry[];
  enumMembers?: KnipIssueEntry[];
  classMembers?: KnipIssueEntry[];
  namespaceMembers?: KnipIssueEntry[];
  dependencies?: KnipIssueEntry[];
  devDependencies?: KnipIssueEntry[];
  optionalPeerDependencies?: KnipIssueEntry[];
  unusedDependencies?: KnipIssueEntry[];
  unusedDevDependencies?: KnipIssueEntry[];
  binaries?: KnipIssueEntry[];
  catalog?: KnipIssueEntry[];
}

/** Top-level shape of knip's JSON report. */
interface KnipJsonReport {
  issues?: KnipFileIssues[];
  files?: (string | KnipIssueEntry)[];
}

/** Maps a knip field name to a `rule_code` plus a severity. */
interface IssueTypeMeta {
  ruleCode: string;
  severity: 'warning' | 'info';
  messageTemplate: (name: string) => string;
}

/** Issue types knip reports in its per-file `issues` records. */
const ISSUE_TYPE_META: Record<string, IssueTypeMeta> = {
  exports: {
    ruleCode: 'knip.unusedExport',
    severity: 'warning',
    messageTemplate: (name) => `Unused export: ${name}`,
  },
  nsExports: {
    ruleCode: 'knip.unusedNamespaceExport',
    severity: 'warning',
    messageTemplate: (name) => `Unused namespace export: ${name}`,
  },
  types: {
    ruleCode: 'knip.unusedType',
    severity: 'info',
    messageTemplate: (name) => `Unused type export: ${name}`,
  },
  nsTypes: {
    ruleCode: 'knip.unusedNamespaceType',
    severity: 'info',
    messageTemplate: (name) => `Unused namespace type export: ${name}`,
  },
  duplicates: {
    ruleCode: 'knip.duplicateExport',
    severity: 'warning',
    messageTemplate: (name) => `Duplicate export: ${name}`,
  },
  enumMembers: {
    ruleCode: 'knip.unusedEnumMember',
    severity: 'info',
    messageTemplate: (name) => `Unused enum member: ${name}`,
  },
  classMembers: {
    ruleCode: 'knip.unusedClassMember',
    severity: 'warning',
    messageTemplate: (name) => `Unused class member: ${name}`,
  },
  namespaceMembers: {
    ruleCode: 'knip.unusedNamespaceMember',
    severity: 'info',
    messageTemplate: (name) => `Unused namespace member: ${name}`,
  },
  unlisted: {
    ruleCode: 'knip.unlistedDependency',
    severity: 'warning',
    messageTemplate: (name) => `Unlisted dependency: ${name}`,
  },
  unresolved: {
    ruleCode: 'knip.unresolvedImport',
    severity: 'warning',
    messageTemplate: (name) => `Unresolved import: ${name}`,
  },
  dependencies: {
    ruleCode: 'knip.unusedDependency',
    severity: 'warning',
    messageTemplate: (name) => `Unused dependency: ${name}`,
  },
  devDependencies: {
    ruleCode: 'knip.unusedDevDependency',
    severity: 'info',
    messageTemplate: (name) => `Unused devDependency: ${name}`,
  },
  optionalPeerDependencies: {
    ruleCode: 'knip.unusedOptionalPeerDependency',
    severity: 'info',
    messageTemplate: (name) => `Unused optional peer dependency: ${name}`,
  },
  binaries: {
    ruleCode: 'knip.unusedBinary',
    severity: 'info',
    messageTemplate: (name) => `Unused binary: ${name}`,
  },
  catalog: {
    ruleCode: 'knip.unusedCatalogEntry',
    severity: 'info',
    messageTemplate: (name) => `Unused catalog entry: ${name}`,
  },
};

/** Fields considered "unused export" style issues — used for the module metric. */
const UNUSED_EXPORT_FIELDS: readonly string[] = [
  'exports',
  'nsExports',
  'types',
  'nsTypes',
  'enumMembers',
  'classMembers',
  'namespaceMembers',
];

/** Capture from `spawn` — collected stdout + stderr + exit code (never throws). */
interface SpawnCapture {
  stdout: string;
  stderr: string;
  code: number | null;
  timedOut: boolean;
}

/**
 * Spawn knip and capture its output. Never throws on non-zero exit — knip returns
 * non-zero when issues are present, and we want the stdout either way.
 */
function spawnKnip(cwd: string, timeoutMs: number): Promise<SpawnCapture> {
  return new Promise<SpawnCapture>((resolveP) => {
    const child = spawn('pnpm', ['knip', '--reporter', 'json', '--no-progress'], {
      cwd,
      env: process.env,
      shell: false,
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolveP({
        stdout,
        stderr: stderr + `\nspawn error: ${err.message}`,
        code: null,
        timedOut,
      });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      resolveP({ stdout, stderr, code, timedOut });
    });
  });
}

/**
 * Extract the leading JSON object from knip's stdout. Knip prefixes its output
 * with pnpm banner lines and may append trailing text, so we find the outermost
 * `{...}` block by bracket matching.
 */
function extractJsonBlob(raw: string): string | null {
  const start = raw.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === '\\') {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return raw.slice(start, i + 1);
    }
  }
  return null;
}

/** Safely parse knip's JSON report; returns null on failure. */
function parseReport(raw: string): KnipJsonReport | null {
  const blob = extractJsonBlob(raw);
  if (blob === null) return null;
  try {
    return JSON.parse(blob) as KnipJsonReport;
  } catch {
    return null;
  }
}

/** Build a lookup from potential file-path keys to modules for fast resolution. */
function buildModuleIndex(
  modules: readonly IModuleCreateDTO[],
  packageRoot: string
): {
  byAbsolute: Map<string, IModuleCreateDTO>;
  byRelative: Map<string, IModuleCreateDTO>;
  byBasename: Map<string, IModuleCreateDTO>;
} {
  const byAbsolute = new Map<string, IModuleCreateDTO>();
  const byRelative = new Map<string, IModuleCreateDTO>();
  const byBasename = new Map<string, IModuleCreateDTO>();

  for (const m of modules) {
    const filename = m.source.filename;
    if (filename) {
      byAbsolute.set(filename, m);
      if (isAbsolute(filename)) {
        byRelative.set(relative(packageRoot, filename), m);
      } else {
        byRelative.set(filename, m);
      }
      byBasename.set(basename(filename), m);
    }
    const rel = m.source.relativePath;
    if (rel) byRelative.set(rel, m);
  }
  return { byAbsolute, byRelative, byBasename };
}

/** Resolve a knip-reported file path to a module, tolerating abs/relative/basename forms. */
function resolveModule(
  filePath: string,
  packageRoot: string,
  index: ReturnType<typeof buildModuleIndex>
): IModuleCreateDTO | undefined {
  if (!filePath) return undefined;
  if (index.byAbsolute.has(filePath)) return index.byAbsolute.get(filePath);
  if (index.byRelative.has(filePath)) return index.byRelative.get(filePath);

  const asAbsolute = isAbsolute(filePath) ? filePath : resolve(packageRoot, filePath);
  if (index.byAbsolute.has(asAbsolute)) return index.byAbsolute.get(asAbsolute);

  const relFromAbs = relative(packageRoot, asAbsolute);
  if (index.byRelative.has(relFromAbs)) return index.byRelative.get(relFromAbs);

  return index.byBasename.get(basename(filePath));
}

/** Convert knip's per-field issue entries to a common iteration shape. */
function collectEntries(value: KnipIssueEntry[] | boolean | undefined): KnipIssueEntry[] {
  if (Array.isArray(value)) return value;
  return [];
}

export class KnipAnalyzer implements Analyzer {
  public readonly id = 'knip';
  public readonly category: AnalyzerCategory = 'deadCode';
  public readonly requires: AnalyzerCapability[] = ['subprocess'];

  public enabled(config: AnalysisConfig): boolean {
    const disabled = config.disabledAnalyzers ?? [];
    if (disabled.includes(this.id)) return false;
    const enabledList = config.enabledAnalyzers;
    if (enabledList && enabledList.length > 0 && !enabledList.includes(this.id)) {
      return false;
    }
    return true;
  }

  public async run(ctx: AnalyzerContext): Promise<AnalyzerResult> {
    const { logger } = ctx;
    let capture: SpawnCapture;
    try {
      capture = await spawnKnip(ctx.packageRoot, KNIP_TIMEOUT_MS);
    } catch (err) {
      logger.warn(`[knip] failed to spawn: ${err instanceof Error ? err.message : String(err)}`);
      return {};
    }

    if (capture.timedOut) {
      logger.warn(`[knip] subprocess timed out after ${String(KNIP_TIMEOUT_MS)}ms`);
      return {};
    }

    const report = parseReport(capture.stdout);
    if (!report) {
      const preview = capture.stderr.slice(0, 500);
      logger.warn(`[knip] no parseable JSON in stdout; stderr preview: ${preview}`);
      return {};
    }

    return this.buildResultFromReport(report, ctx);
  }

  /** Pure conversion step, exposed for testing. */
  public buildResultFromReport(report: KnipJsonReport, ctx: AnalyzerContext): AnalyzerResult {
    const findings: ICodeIssueCreateDTO[] = [];
    const metrics: IEntityMetricCreateDTO[] = [];

    const index = buildModuleIndex(ctx.parseResult.modules, ctx.packageRoot);
    const perModuleUnusedExports = new Map<string, number>();
    const deadModuleIds = new Set<string>();

    const fileIssues = Array.isArray(report.issues) ? report.issues : [];

    for (const entry of fileIssues) {
      const filePath = entry.file ?? '';
      const module = resolveModule(filePath, ctx.packageRoot, index);
      if (!module) continue; // knip may mention config files we don't track

      for (const [field, meta] of Object.entries(ISSUE_TYPE_META)) {
        const raw = (entry as unknown as Record<string, KnipIssueEntry[] | boolean | undefined>)[field];
        const entries = collectEntries(raw);
        for (const item of entries) {
          const name = item.name ?? '(anonymous)';
          const issueKey = `${filePath}:${String(item.line ?? 0)}:${name}`;
          const finding: ICodeIssueCreateDTO = {
            id: generateCodeIssueUUID(module.id, meta.ruleCode, issueKey),
            rule_code: meta.ruleCode,
            severity: meta.severity,
            message: meta.messageTemplate(name),
            package_id: ctx.packageId,
            module_id: module.id,
            file_path: filePath,
          };
          if (typeof item.line === 'number') finding.line = item.line;
          if (typeof item.col === 'number') finding.column = item.col;
          if (item.name) finding.entity_name = item.name;
          findings.push(finding);
        }

        if (UNUSED_EXPORT_FIELDS.includes(field) && entries.length > 0) {
          perModuleUnusedExports.set(
            module.id,
            (perModuleUnusedExports.get(module.id) ?? 0) + entries.length
          );
        }
      }

      // The `files` field marks the whole file as unused. It may be reported as
      // an array of entries or as a boolean flag — handle both shapes.
      const filesField = entry.files;
      const fileMarkedDead =
        (Array.isArray(filesField) && filesField.length > 0) || filesField === true;
      if (fileMarkedDead) {
        deadModuleIds.add(module.id);
        const issueKey = `${filePath}:0:__file__`;
        findings.push({
          id: generateCodeIssueUUID(module.id, 'knip.unusedFile', issueKey),
          rule_code: 'knip.unusedFile',
          severity: 'warning',
          message: `Unused file: ${filePath}`,
          package_id: ctx.packageId,
          module_id: module.id,
          file_path: filePath,
        });
      }
    }

    // Emit per-module metrics for every module we saw at least one signal for,
    // plus every module that's dead. This keeps the metric set tight while
    // still reflecting the analysis results faithfully.
    const touchedModuleIds = new Set<string>([
      ...perModuleUnusedExports.keys(),
      ...deadModuleIds,
    ]);

    for (const moduleId of touchedModuleIds) {
      const unusedCount = perModuleUnusedExports.get(moduleId) ?? 0;
      metrics.push({
        id: generateEntityMetricUUID(ctx.snapshotId, moduleId, 'module', 'deadCode.unusedExportCount'),
        snapshot_id: ctx.snapshotId,
        package_id: ctx.packageId,
        module_id: moduleId,
        entity_id: moduleId,
        entity_type: 'module',
        metric_key: 'deadCode.unusedExportCount',
        metric_value: unusedCount,
        metric_category: 'deadCode',
      });
      metrics.push({
        id: generateEntityMetricUUID(ctx.snapshotId, moduleId, 'module', 'deadCode.isDead'),
        snapshot_id: ctx.snapshotId,
        package_id: ctx.packageId,
        module_id: moduleId,
        entity_id: moduleId,
        entity_type: 'module',
        metric_key: 'deadCode.isDead',
        metric_value: deadModuleIds.has(moduleId) ? 1 : 0,
        metric_category: 'deadCode',
      });
    }

    return { findings, metrics };
  }
}
