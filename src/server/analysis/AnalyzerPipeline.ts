import { consola } from 'consola';

import { analyzerEnabled } from './AnalysisConfig';

import type {
  Analyzer,
  AnalyzerContext,
  AnalyzerResult,
} from './types';

const logger = consola.withTag('AnalyzerPipeline');

/** Deterministically order analyzers so each one runs after its declared `dependsOn`. */
function topologicalOrder(analyzers: Analyzer[]): Analyzer[] {
  const byId = new Map<string, Analyzer>();
  for (const analyzer of analyzers) {
    byId.set(analyzer.id, analyzer);
  }

  const indegree = new Map<string, number>();
  const edges = new Map<string, string[]>();

  for (const analyzer of analyzers) {
    indegree.set(analyzer.id, 0);
    edges.set(analyzer.id, []);
  }

  for (const analyzer of analyzers) {
    const deps = analyzer.dependsOn ?? [];
    for (const dep of deps) {
      if (!byId.has(dep)) {
        // Missing dep is not a hard error — warn and proceed with the analyzer still ordered.
        logger.warn(
          `Analyzer '${analyzer.id}' depends on unknown analyzer '${dep}'; dependency will be ignored.`
        );
        continue;
      }
      const children = edges.get(dep);
      if (children) {
        children.push(analyzer.id);
      }
      indegree.set(analyzer.id, (indegree.get(analyzer.id) ?? 0) + 1);
    }
  }

  const queue: string[] = [];
  for (const analyzer of analyzers) {
    if ((indegree.get(analyzer.id) ?? 0) === 0) {
      queue.push(analyzer.id);
    }
  }

  const ordered: Analyzer[] = [];
  while (queue.length > 0) {
    const id = queue.shift();
    if (id === undefined) break;
    const analyzer = byId.get(id);
    if (analyzer) {
      ordered.push(analyzer);
    }
    const children = edges.get(id) ?? [];
    for (const child of children) {
      const next = (indegree.get(child) ?? 0) - 1;
      indegree.set(child, next);
      if (next === 0) {
        queue.push(child);
      }
    }
  }

  if (ordered.length !== analyzers.length) {
    // Cycle detected — emit any remaining analyzers in their original order so we never silently drop work.
    const emittedIds = new Set(ordered.map((entry) => entry.id));
    const missing = analyzers.filter((entry) => !emittedIds.has(entry.id));
    logger.warn(
      `Detected circular dependsOn among analyzers: ${missing.map((entry) => entry.id).join(', ')}. Running them in declaration order after resolved analyzers.`
    );
    ordered.push(...missing);
  }

  return ordered;
}

function mergeResults(target: AnalyzerResult, patch: AnalyzerResult): void {
  if (patch.metrics && patch.metrics.length > 0) {
    target.metrics = (target.metrics ?? []).concat(patch.metrics);
  }
  if (patch.findings && patch.findings.length > 0) {
    target.findings = (target.findings ?? []).concat(patch.findings);
  }
  if (patch.callEdges && patch.callEdges.length > 0) {
    target.callEdges = (target.callEdges ?? []).concat(patch.callEdges);
  }
  if (patch.cycles && patch.cycles.length > 0) {
    target.cycles = (target.cycles ?? []).concat(patch.cycles);
  }
  if (patch.duplications && patch.duplications.length > 0) {
    target.duplications = (target.duplications ?? []).concat(patch.duplications);
  }
  if (patch.architecturalViolations && patch.architecturalViolations.length > 0) {
    target.architecturalViolations = (target.architecturalViolations ?? []).concat(patch.architecturalViolations);
  }
  if (patch.moduleStats && patch.moduleStats.length > 0) {
    target.moduleStats = (target.moduleStats ?? []).concat(patch.moduleStats);
  }
  if (patch.entityStats && patch.entityStats.length > 0) {
    target.entityStats = (target.entityStats ?? []).concat(patch.entityStats);
  }
}

/**
 * Lazily try to instantiate a shared ts-morph Project. If the helper module is missing
 * (Phase 1 bootstrap) or ts-morph itself isn't installed, return `null` so the pipeline
 * can mark dependent analyzers as skipped.
 */
async function tryCreateTsMorphProject(packageRoot: string): Promise<unknown> {
  // Compute the specifier via a variable so TypeScript doesn't try to statically resolve
  // the module. The SharedProject helper is intentionally introduced in a later phase.
  const specifier = './tsmorph/SharedProject';
  try {
    // eslint-disable-next-line dollarwise/no-dynamic-imports -- lazy load so ts-morph stays optional
    const mod = (await import(/* @vite-ignore */ specifier)) as {
      createTsMorphProject?: (root: string) => Promise<unknown>;
    };
    if (typeof mod.createTsMorphProject !== 'function') {
      logger.warn('SharedProject module does not export createTsMorphProject; skipping ts-morph analyzers.');
      return null;
    }
    return await mod.createTsMorphProject(packageRoot);
  } catch (error) {
    logger.warn(
      'ts-morph project unavailable; analyzers requiring it will be skipped.',
      error instanceof Error ? error.message : String(error)
    );
    return null;
  }
}

/** Status of a single analyzer run, reported via `lastRunTimings`/`lastRunStatus`. */
export type AnalyzerRunStatus = 'ok' | 'skipped' | 'error';

export class AnalyzerPipeline {
  /** Per-analyzer wall-clock duration (ms) from the most recent `.run()` call. */
  public readonly lastRunTimings = new Map<string, number>();

  /** Per-analyzer status from the most recent `.run()` call. */
  public readonly lastRunStatus = new Map<string, AnalyzerRunStatus>();

  constructor(private readonly analyzers: Analyzer[]) {}

  async run(ctx: Omit<AnalyzerContext, 'project'>): Promise<AnalyzerResult> {
    const aggregate: AnalyzerResult = {};

    this.lastRunTimings.clear();
    this.lastRunStatus.clear();

    const enabled = this.analyzers.filter(
      (analyzer) => analyzer.enabled(ctx.config) && analyzerEnabled(analyzer.id, ctx.config)
    );

    if (enabled.length === 0) {
      logger.info('No analyzers enabled; pipeline has nothing to run.');
      return aggregate;
    }

    const needsTsMorph = enabled.some((analyzer) => analyzer.requires.includes('tsMorph'));
    let project: unknown = null;
    if (needsTsMorph) {
      project = await tryCreateTsMorphProject(ctx.packageRoot);
    }

    const ordered = topologicalOrder(enabled);
    logger.info(`Running ${String(ordered.length)} analyzer(s): ${ordered.map((entry) => entry.id).join(', ')}`);

    for (const analyzer of ordered) {
      if (analyzer.requires.includes('tsMorph') && project === null) {
        logger.warn(`Skipping analyzer '${analyzer.id}' — requires ts-morph but shared project is unavailable.`);
        this.lastRunTimings.set(analyzer.id, 0);
        this.lastRunStatus.set(analyzer.id, 'skipped');
        continue;
      }

      const analyzerCtx: AnalyzerContext = {
        ...ctx,
        project,
        logger: ctx.logger.withTag(analyzer.id),
      };

      logger.info(`Running analyzer '${analyzer.id}' (${analyzer.category})`);
      const startedAt = Date.now();
      try {
        const result = await analyzer.run(analyzerCtx);
        mergeResults(aggregate, result);
        const elapsed = Date.now() - startedAt;
        this.lastRunTimings.set(analyzer.id, elapsed);
        this.lastRunStatus.set(analyzer.id, 'ok');
        logger.success(`Analyzer '${analyzer.id}' completed in ${String(elapsed)}ms`);
      } catch (error) {
        const elapsed = Date.now() - startedAt;
        this.lastRunTimings.set(analyzer.id, elapsed);
        this.lastRunStatus.set(analyzer.id, 'error');
        logger.error(
          `Analyzer '${analyzer.id}' failed after ${String(elapsed)}ms:`,
          error instanceof Error ? error.message : String(error)
        );
      }
    }

    return aggregate;
  }
}
