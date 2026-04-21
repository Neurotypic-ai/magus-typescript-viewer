/**
 * DependencyCruiserAnalyzer
 *
 * Runs `dependency-cruiser` as a subprocess against the package under analysis
 * and maps its JSON output to two kinds of analyzer results:
 *
 *   - Dependency cycles        → `IDependencyCycleCreateDTO[]`
 *   - Architectural violations → `IArchitecturalViolationCreateDTO[]`
 *
 * dep-cruiser needs a config file, so we synthesise one on-the-fly based on
 * `ctx.config.architecture` (layers + forbidden rules), write it to a temp
 * `.cjs` file, invoke the CLI, parse the result, and clean up.
 *
 * Known limitations (Phase 1):
 *   - Path matching between dep-cruiser's reported paths and our
 *     `module.source.filename` uses a simple `endsWith` check because
 *     dep-cruiser emits package-root-relative paths while we track absolute
 *     filenames.
 *   - Layer matching uses substring matching on the path pattern with `/**`
 *     stripped — minimatch is intentionally not pulled in as a dep yet.
 *   - If the `depcruise` binary isn't present, the analyzer logs a warning
 *     and returns an empty result instead of throwing.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import type { IArchitecturalViolationCreateDTO } from '../../../shared/types/dto/ArchitecturalViolationDTO';
import type { IDependencyCycleCreateDTO } from '../../../shared/types/dto/DependencyCycleDTO';
import type { IModuleCreateDTO } from '../../../shared/types/dto/ModuleDTO';
import type {
  AnalysisConfig,
  Analyzer,
  AnalyzerCapability,
  AnalyzerCategory,
  AnalyzerContext,
  AnalyzerResult,
  ArchitectureConfig,
  ArchitectureLayer,
} from '../types';
import {
  generateArchitecturalViolationUUID,
  generateDependencyCycleUUID,
} from '../../utils/uuid';

// ---------------------------------------------------------------------------
// dep-cruiser JSON shapes (narrow subset we actually read)
// ---------------------------------------------------------------------------

interface DepCruiserRule {
  name?: string;
  severity?: string;
  comment?: string;
}

interface DepCruiserViolation {
  type?: string;
  from?: string;
  to?: string;
  rule?: DepCruiserRule;
  /** Present only when type === 'cycle'. */
  cycle?: string[];
}

interface DepCruiserSummary {
  violations?: DepCruiserViolation[];
}

interface DepCruiserResult {
  summary?: DepCruiserSummary;
}

// ---------------------------------------------------------------------------
// Internal hook for tests: lets us swap the spawn implementation without
// touching the Node child_process module directly.
// ---------------------------------------------------------------------------

/**
 * Runs dep-cruiser and returns its stdout as a UTF-8 string. The default
 * implementation shells out to `npx depcruise`; tests can replace it.
 */
export type DepCruiserRunner = (args: {
  configPath: string;
  cwd: string;
  target: string;
}) => Promise<{ stdout: string; stderr: string; exitCode: number | null }>;

const defaultRunner: DepCruiserRunner = async ({ configPath, cwd, target }) => {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'npx',
      ['--no-install', 'depcruise', '--config', configPath, '--output-type', 'json', target],
      { cwd, stdio: ['ignore', 'pipe', 'pipe'] }
    );

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf-8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf-8');
    });
    child.on('error', (err) => {
      reject(err);
    });
    child.on('close', (code) => {
      resolve({ stdout, stderr, exitCode: code });
    });
  });
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Strip trailing glob wildcards so we can do a simple substring match later.
 * e.g. `src/client/**` → `src/client`
 *      `src/server/**\/*.ts` → `src/server`
 */
function normalizeLayerPattern(pattern: string): string {
  // Remove anything from the first `*` onward, then trim trailing slashes.
  const firstStar = pattern.indexOf('*');
  const trimmed = firstStar === -1 ? pattern : pattern.slice(0, firstStar);
  return trimmed.replace(/\/+$/, '');
}

/** Find the first layer whose normalized path is a substring of `filePath`. */
function findLayer(filePath: string, layers: ArchitectureLayer[]): ArchitectureLayer | undefined {
  for (const layer of layers) {
    for (const pattern of layer.paths) {
      const normalized = normalizeLayerPattern(pattern);
      if (normalized !== '' && filePath.includes(normalized)) {
        return layer;
      }
    }
  }
  return undefined;
}

/**
 * Resolve a dep-cruiser-reported file path to one of our module IDs.
 * dep-cruiser emits paths relative to the package root, whereas our modules
 * store absolute filenames, so we match by `endsWith` on a normalized path.
 */
function resolveModuleId(
  reportedPath: string,
  modules: readonly IModuleCreateDTO[]
): string | undefined {
  const needle = reportedPath.replace(/^\.\//, '').replace(/\\/g, '/');
  for (const mod of modules) {
    const abs = mod.source.filename.replace(/\\/g, '/');
    const rel = mod.source.relativePath.replace(/\\/g, '/');
    if (abs.endsWith(needle) || rel === needle || rel.endsWith(needle)) {
      return mod.id;
    }
  }
  return undefined;
}

/**
 * Build a dep-cruiser `.cjs` config from our `ArchitectureConfig`. Each layer
 * becomes a scope definition (regex-ish path pattern), each forbidden rule
 * becomes a dep-cruiser `forbidden` entry, and `no-circular` is always on.
 */
function buildDepCruiserConfig(architecture: ArchitectureConfig): string {
  const { layers, rules } = architecture;

  const forbidden: Array<Record<string, unknown>> = [
    {
      name: 'no-circular',
      severity: 'warn',
      comment: 'Circular dependencies are not allowed.',
      from: {},
      to: { circular: true },
    },
  ];

  // Build a regex alternation for each layer so we can reference it by name.
  const layerPathPattern = new Map<string, string>();
  for (const layer of layers) {
    const patterns = layer.paths
      .map((path) => normalizeLayerPattern(path))
      .filter((p) => p !== '')
      .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    if (patterns.length > 0) {
      layerPathPattern.set(layer.name, `^(?:${patterns.join('|')})`);
    }
  }

  for (const { forbidden: rule } of rules) {
    const fromPattern = layerPathPattern.get(rule.from);
    const toPattern = layerPathPattern.get(rule.to);
    if (fromPattern === undefined || toPattern === undefined) continue;
    const severity = rule.severity === 'error' ? 'error' : rule.severity === 'info' ? 'info' : 'warn';
    forbidden.push({
      name: `no-${rule.from}-to-${rule.to}`,
      severity,
      comment: `'${rule.from}' layer must not depend on '${rule.to}' layer.`,
      from: { path: fromPattern },
      to: { path: toPattern },
    });
  }

  const config = {
    forbidden,
    options: {
      doNotFollow: { path: 'node_modules' },
      tsPreCompilationDeps: true,
      combinedDependencies: true,
      exclude: { path: '(node_modules|dist|build|\\.d\\.ts$)' },
    },
  };

  return `module.exports = ${JSON.stringify(config, null, 2)};\n`;
}

function mapSeverity(
  type: string | undefined
): IArchitecturalViolationCreateDTO['severity'] {
  if (type === 'error') return 'error';
  if (type === 'info') return 'info';
  return 'warning';
}

// ---------------------------------------------------------------------------
// Analyzer
// ---------------------------------------------------------------------------

export class DependencyCruiserAnalyzer implements Analyzer {
  public id = 'dep-cruiser';
  public category: AnalyzerCategory = 'architecture';
  public requires: AnalyzerCapability[] = ['subprocess'];

  /** Internal hook so tests can inject a fake runner. */
  private readonly runner: DepCruiserRunner;

  public constructor(runner: DepCruiserRunner = defaultRunner) {
    this.runner = runner;
  }

  public enabled(_config: AnalysisConfig): boolean {
    return true;
  }

  public async run(ctx: AnalyzerContext): Promise<AnalyzerResult> {
    const { parseResult, packageId, snapshotId, packageRoot, logger, config } = ctx;

    const tempDir = await mkdtemp(join(tmpdir(), 'dep-cruiser-'));
    const configPath = join(tempDir, `dep-cruiser-${randomUUID()}.cjs`);

    try {
      await writeFile(configPath, buildDepCruiserConfig(config.architecture), 'utf-8');

      let stdout: string;
      try {
        const invocation = await this.runner({
          configPath,
          cwd: packageRoot,
          target: 'src',
        });
        stdout = invocation.stdout;
        // dep-cruiser exits non-zero when violations are found; that's fine.
        if (invocation.stderr !== '' && invocation.exitCode !== 0 && invocation.stdout === '') {
          logger.warn(`dep-cruiser stderr: ${invocation.stderr}`);
        }
      } catch (err) {
        logger.warn(
          'dependency-cruiser binary is unavailable; returning empty result.',
          err instanceof Error ? err.message : String(err)
        );
        return {};
      }

      if (stdout.trim() === '') {
        logger.debug('dep-cruiser produced no output; nothing to analyze.');
        return {};
      }

      let parsed: DepCruiserResult;
      try {
        parsed = JSON.parse(stdout) as DepCruiserResult;
      } catch (err) {
        logger.warn(
          'Failed to parse dep-cruiser JSON output; returning empty result.',
          err instanceof Error ? err.message : String(err)
        );
        return {};
      }

      const violations = parsed.summary?.violations ?? [];
      const cycles: IDependencyCycleCreateDTO[] = [];
      const architecturalViolations: IArchitecturalViolationCreateDTO[] = [];

      for (const violation of violations) {
        if (violation.type === 'cycle') {
          const cyclePaths = violation.cycle ?? [];
          if (cyclePaths.length === 0) continue;
          const moduleIds: string[] = [];
          let allResolved = true;
          for (const cyclePath of cyclePaths) {
            const moduleId = resolveModuleId(cyclePath, parseResult.modules);
            if (moduleId === undefined) {
              allResolved = false;
              break;
            }
            moduleIds.push(moduleId);
          }
          if (!allResolved) continue;

          const participantsKey = cyclePaths.join('->');
          cycles.push({
            id: generateDependencyCycleUUID(packageId, participantsKey),
            package_id: packageId,
            length: moduleIds.length,
            participants_json: JSON.stringify(moduleIds),
            severity: 'warning',
          });
          continue;
        }

        // Architectural violation: skip cycle rule entries and anything lacking rule metadata.
        const ruleName = violation.rule?.name;
        if (ruleName === undefined || ruleName === 'no-circular') continue;
        if (violation.type !== 'error' && violation.type !== 'warn') continue;
        if (violation.from === undefined || violation.to === undefined) continue;

        const sourceModuleId = resolveModuleId(violation.from, parseResult.modules);
        const targetModuleId = resolveModuleId(violation.to, parseResult.modules);
        if (sourceModuleId === undefined || targetModuleId === undefined) continue;

        const sourceLayer = findLayer(violation.from, config.architecture.layers);
        const targetLayer = findLayer(violation.to, config.architecture.layers);

        const message =
          violation.rule?.comment !== undefined && violation.rule.comment !== ''
            ? violation.rule.comment
            : `Illegal dependency from '${violation.from}' to '${violation.to}' (rule: ${ruleName}).`;

        const dto: IArchitecturalViolationCreateDTO = {
          id: generateArchitecturalViolationUUID(snapshotId, ruleName, sourceModuleId, targetModuleId),
          snapshot_id: snapshotId,
          package_id: packageId,
          rule_name: ruleName,
          source_module_id: sourceModuleId,
          target_module_id: targetModuleId,
          severity: mapSeverity(violation.type),
          message,
        };
        if (sourceLayer !== undefined) {
          dto.source_layer = sourceLayer.name;
        }
        if (targetLayer !== undefined) {
          dto.target_layer = targetLayer.name;
        }
        architecturalViolations.push(dto);
      }

      const result: AnalyzerResult = {};
      if (cycles.length > 0) result.cycles = cycles;
      if (architecturalViolations.length > 0) result.architecturalViolations = architecturalViolations;
      return result;
    } finally {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {
        // Best-effort cleanup; ignore failures.
      });
    }
  }
}
