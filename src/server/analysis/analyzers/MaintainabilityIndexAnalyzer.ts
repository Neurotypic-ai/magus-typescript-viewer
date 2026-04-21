/**
 * MaintainabilityIndexAnalyzer
 *
 * Derived-metric analyzer: computes a per-module Maintainability Index (MI)
 * approximation using the classic formula:
 *
 *   MI = max(0, min(100, 171 - 5.2*ln(V) - 0.23*CC - 16.2*ln(LOC)))
 *
 * where
 *   V   = Halstead volume (naive approximation from a simple tokenizer)
 *   CC  = cyclomatic complexity (approximated via regex token counting)
 *   LOC = logical (non-empty, non-line-comment) lines
 *
 * ## Intentionally duplicative computation
 *
 * The analyzer pipeline aggregates results at the end — DB persistence and
 * `EntityStatsPatch` application both happen AFTER every analyzer runs. That
 * means this analyzer cannot read prior analyzers' emitted metrics in-memory
 * or from the database when `run()` is called. Rather than introduce a
 * cross-analyzer dependency mechanism for Phase 3, we recompute the inputs
 * inline from `ctx.parseResult` + source files. The numbers are deliberately
 * rough and are not expected to match SizeAnalyzer / ComplexityAnalyzer byte
 * for byte.
 *
 * Defensive behavior:
 *   - Modules whose source file cannot be read are silently skipped.
 *   - `Math.log` inputs are clamped to >= 1 to guard the LOC=0 / V=0 edge.
 *   - The final MI is clamped to the [0, 100] range.
 */
import { readFile } from 'node:fs/promises';

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

const analyzerLogger = consola.withTag('MaintainabilityIndexAnalyzer');

/**
 * Count logical lines as raw lines that are non-blank after trimming and do
 * not begin with `//`. This is a simpler heuristic than SizeAnalyzer's full
 * block-comment-aware pass, in line with the "approximation" contract above.
 */
function computeLogicalLines(source: string): number {
  let count = 0;
  for (const rawLine of source.split('\n')) {
    const trimmed = rawLine.trim();
    if (trimmed === '') continue;
    if (trimmed.startsWith('//')) continue;
    count += 1;
  }
  return count;
}

/**
 * Approximate cyclomatic complexity across the whole file by counting
 * occurrences of the standard decision-point tokens and adding 1 for the
 * baseline path. Strings/comments are not filtered — this is intentionally
 * a rough count (APPROXIMATION).
 */
function computeApproxCyclomatic(source: string): number {
  const patterns: RegExp[] = [
    /\bif\b/g,
    /\belse\s+if\b/g,
    /\bfor\b/g,
    /\bwhile\b/g,
    /\bcase\b/g,
    /\bcatch\b/g,
    /&&/g,
    /\|\|/g,
    /\?\?/g,
  ];

  let decisionPoints = 0;
  for (const pattern of patterns) {
    const matches = source.match(pattern);
    if (matches) decisionPoints += matches.length;
  }

  return decisionPoints + 1;
}

/**
 * Halstead volume approximation: V = N * log2(n).
 *   n = distinct operators + distinct operands
 *   N = total operators + operands
 * Same naive tokenizer shape as SizeAnalyzer.
 */
function computeHalsteadVolume(source: string): number {
  const tokenRegex = /[a-zA-Z_$][\w$]*|[+\-*/%=<>!&|^~?:,;]/g;
  const operandSet = new Set<string>();
  const operatorSet = new Set<string>();
  let totalOperands = 0;
  let totalOperators = 0;

  const matches = source.match(tokenRegex);
  if (!matches) return 0;

  for (const token of matches) {
    if (/^[a-zA-Z_$]/.test(token)) {
      operandSet.add(token);
      totalOperands += 1;
    } else {
      operatorSet.add(token);
      totalOperators += 1;
    }
  }

  const n = operandSet.size + operatorSet.size;
  const N = totalOperands + totalOperators;
  if (n <= 1 || N === 0) return 0;
  return N * Math.log2(n);
}

/** log(max(value, 1)) — guards against log(0) and negative inputs. */
function safeLn(value: number): number {
  return Math.log(Math.max(value, 1));
}

function computeMaintainabilityIndex(
  halsteadVolume: number,
  cyclomatic: number,
  logicalLines: number
): number {
  const raw = 171 - 5.2 * safeLn(halsteadVolume) - 0.23 * cyclomatic - 16.2 * safeLn(logicalLines);
  return Math.max(0, Math.min(100, raw));
}

export class MaintainabilityIndexAnalyzer implements Analyzer {
  public id = 'maintainability';
  public category: AnalyzerCategory = 'composite';
  public requires: AnalyzerCapability[] = [];
  /**
   * Ordering hints — the pipeline aggregates at the end so we can't actually
   * read prior analyzer output, but keeping these in place preserves intent
   * for future cross-analyzer wiring.
   */
  public dependsOn: string[] = ['size', 'complexity'];

  public enabled(_config: AnalysisConfig): boolean {
    return true;
  }

  public async run(ctx: AnalyzerContext): Promise<AnalyzerResult> {
    const { parseResult, packageId, snapshotId, logger } = ctx;
    const metrics: IEntityMetricCreateDTO[] = [];

    for (const mod of parseResult.modules) {
      let source: string;
      try {
        source = await readFile(mod.source.filename, 'utf-8');
      } catch (err) {
        logger.debug(
          `[MaintainabilityIndexAnalyzer] skipping unreadable module: ${mod.source.filename}`,
          err
        );
        continue;
      }

      const logicalLines = computeLogicalLines(source);
      const cyclomatic = computeApproxCyclomatic(source);
      const halsteadVolume = computeHalsteadVolume(source);
      const mi = computeMaintainabilityIndex(halsteadVolume, cyclomatic, logicalLines);

      const key = 'composite.maintainabilityIndex';
      metrics.push({
        id: generateEntityMetricUUID(snapshotId, mod.id, 'module', key),
        snapshot_id: snapshotId,
        package_id: packageId,
        module_id: mod.id,
        entity_id: mod.id,
        entity_type: 'module',
        metric_key: key,
        metric_value: mi,
        metric_category: 'composite',
      });
    }

    analyzerLogger.debug(
      `Computed maintainability index for ${String(metrics.length)} / ${String(
        parseResult.modules.length
      )} modules.`
    );

    return { metrics };
  }
}
