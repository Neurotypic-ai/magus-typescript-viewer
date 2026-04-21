/**
 * CouplingAnalyzer
 *
 * Derived-metric analyzer: computes per-module coupling metrics from
 * `ctx.parseResult.importsWithModules` without running its own AST pass.
 *
 * For each module it emits:
 *   - coupling.afferent   (Ca) — distinct OTHER modules that import this one
 *   - coupling.efferent   (Ce) — distinct OTHER modules this one imports from
 *   - coupling.instability (I) — Ce / (Ce + Ca), in [0..1]. 0 if both are zero.
 *
 * Path resolution is intentionally simple:
 *   - Relative import specifiers (starting with '.' or '..') are joined against
 *     the source module's directory and matched against a filename index that
 *     tries a few conventional extensions and index-file fallbacks.
 *   - Non-relative imports (e.g. 'react', '@org/pkg', bare paths) are treated
 *     as external and excluded from the coupling graph.
 *
 * LCOM4 (class cohesion) is intentionally skipped for this phase — TODO.
 */
import { resolve as resolvePath } from 'node:path';

import { consola } from 'consola';

import type { IEntityMetricCreateDTO } from '../../../shared/types/dto/EntityMetricDTO';
import type {
  AnalysisConfig,
  Analyzer,
  AnalyzerCapability,
  AnalyzerCategory,
  AnalyzerContext,
  AnalyzerResult,
} from '../types';
import { generateEntityMetricUUID } from '../../utils/uuid';

const analyzerLogger = consola.withTag('CouplingAnalyzer');

/** File extensions we try (in order) when resolving a relative import. */
const RESOLUTION_EXTENSIONS: readonly string[] = [
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.vue',
];

/** Index filenames we try when a relative import resolves to a directory. */
const INDEX_BASENAMES: readonly string[] = [
  'index.ts',
  'index.tsx',
  'index.js',
  'index.jsx',
  'index.mjs',
  'index.cjs',
  'index.vue',
];

/**
 * Resolve a relative import specifier (e.g. './foo', '../bar/baz') against the
 * source module's directory and return a matching module id, or undefined.
 *
 * We try:
 *   1. Exact absolute path.
 *   2. Absolute path + each RESOLUTION_EXTENSIONS entry.
 *   3. Absolute path + '/' + each INDEX_BASENAMES entry.
 */
function resolveRelativeImport(
  sourceDir: string,
  specifier: string,
  moduleIdByFilename: Map<string, string>
): string | undefined {
  const joined = resolvePath(sourceDir, specifier);

  const directHit = moduleIdByFilename.get(joined);
  if (directHit !== undefined) return directHit;

  for (const ext of RESOLUTION_EXTENSIONS) {
    const candidate = `${joined}${ext}`;
    const hit = moduleIdByFilename.get(candidate);
    if (hit !== undefined) return hit;
  }

  for (const basename of INDEX_BASENAMES) {
    const candidate = `${joined}/${basename}`;
    const hit = moduleIdByFilename.get(candidate);
    if (hit !== undefined) return hit;
  }

  return undefined;
}

export class CouplingAnalyzer implements Analyzer {
  public id = 'coupling';
  public category: AnalyzerCategory = 'coupling';
  public requires: AnalyzerCapability[] = [];
  /** Benign ordering hint — coupling depends on nothing, but runs after size. */
  public dependsOn: string[] = ['size'];

  public enabled(_config: AnalysisConfig): boolean {
    return true;
  }

  public async run(ctx: AnalyzerContext): Promise<AnalyzerResult> {
    const { parseResult, packageId, snapshotId, logger } = ctx;

    // Index modules by absolute filename so we can resolve relative imports.
    const moduleIdByFilename = new Map<string, string>();
    const moduleDirById = new Map<string, string>();
    for (const mod of parseResult.modules) {
      moduleIdByFilename.set(mod.source.filename, mod.id);
      moduleDirById.set(mod.id, mod.source.directory);
    }

    // Build edges: sourceId -> Set<targetId> (distinct target modules).
    const efferentTargets = new Map<string, Set<string>>();
    const afferentSources = new Map<string, Set<string>>();

    const seedForModule = (id: string): void => {
      if (!efferentTargets.has(id)) efferentTargets.set(id, new Set());
      if (!afferentSources.has(id)) afferentSources.set(id, new Set());
    };

    // Seed all modules so every known module gets Ca=Ce=0 rows even when
    // uninvolved in the import graph.
    for (const mod of parseResult.modules) {
      seedForModule(mod.id);
    }

    const importEntries = parseResult.importsWithModules ?? [];
    for (const entry of importEntries) {
      const sourceModuleId = entry.moduleId;
      const specifier = entry.import.relativePath;
      if (typeof specifier !== 'string' || specifier.length === 0) continue;

      const isRelative = specifier.startsWith('.');
      if (!isRelative) continue; // skip external / bare specifiers

      const sourceDir = moduleDirById.get(sourceModuleId);
      if (sourceDir === undefined) {
        logger.debug(
          `[CouplingAnalyzer] no source dir for module ${sourceModuleId}; skipping import '${specifier}'`
        );
        continue;
      }

      const targetId = resolveRelativeImport(sourceDir, specifier, moduleIdByFilename);
      if (targetId === undefined) continue;
      if (targetId === sourceModuleId) continue; // don't count self-imports

      seedForModule(sourceModuleId);
      seedForModule(targetId);

      efferentTargets.get(sourceModuleId)?.add(targetId);
      afferentSources.get(targetId)?.add(sourceModuleId);
    }

    const metrics: IEntityMetricCreateDTO[] = [];
    for (const mod of parseResult.modules) {
      const ce = efferentTargets.get(mod.id)?.size ?? 0;
      const ca = afferentSources.get(mod.id)?.size ?? 0;
      const denominator = ce + ca;
      const instability = denominator === 0 ? 0 : ce / denominator;

      const entries: { key: string; value: number }[] = [
        { key: 'coupling.afferent', value: ca },
        { key: 'coupling.efferent', value: ce },
        { key: 'coupling.instability', value: instability },
      ];

      for (const entry of entries) {
        metrics.push({
          id: generateEntityMetricUUID(snapshotId, mod.id, 'module', entry.key),
          snapshot_id: snapshotId,
          package_id: packageId,
          module_id: mod.id,
          entity_id: mod.id,
          entity_type: 'module',
          metric_key: entry.key,
          metric_value: entry.value,
          metric_category: 'coupling',
        });
      }
    }

    analyzerLogger.debug(
      `Computed coupling metrics for ${String(parseResult.modules.length)} modules` +
        ` (${String(metrics.length)} metric rows).`
    );

    return { metrics };
  }
}
