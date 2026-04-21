/**
 * SizeAnalyzer
 *
 * Computes per-module size metrics (physical / logical / comment lines and a
 * rough Halstead volume approximation) as well as per-method and per-function
 * `logical_lines` approximations derived from `start_line`/`end_line`.
 *
 * Known limitations:
 *   - `.vue` files are read as a whole, so `<template>` and `<style>` blocks
 *     contribute to `physical_lines`, `logical_lines`, `comment_lines`, and
 *     the Halstead token tally. This analyzer does not attempt to isolate
 *     `<script>` blocks — the numbers should be treated as file-level, not
 *     script-only. If a future analyzer needs script-only metrics, a
 *     dedicated Vue SFC splitter should be introduced upstream.
 *   - Comment detection is a lightweight regex strip (line and block
 *     comments). String literals containing `//` or `/* ... *\/` are not
 *     considered, so the numbers are approximate.
 *   - Halstead volume uses a naive tokenizer: identifiers/literals are
 *     treated as operands and a small set of ASCII symbols as operators.
 *     The result is deliberately rough.
 */
import { readFile } from 'node:fs/promises';

import type { IEntityMetricCreateDTO } from '../../../shared/types/dto/EntityMetricDTO';
import type {
  AnalysisConfig,
  Analyzer,
  AnalyzerCapability,
  AnalyzerCategory,
  AnalyzerContext,
  AnalyzerResult,
  EntityStatsPatch,
  ModuleStatsPatch,
} from '../types';
import { generateEntityMetricUUID } from '../../utils/uuid';

interface SizeCounts {
  physicalLines: number;
  logicalLines: number;
  blankLines: number;
  commentLines: number;
  halsteadVolume: number;
}

/** Strip `/* ... *\/` block comments and `//` line comments from source. */
function stripComments(source: string): string {
  // Block comments first so a `//` inside `/* ... */` doesn't confuse the line pass.
  const withoutBlocks = source.replace(/\/\*[\s\S]*?\*\//g, (match) => {
    // Preserve newlines so line counts for other passes remain sensible.
    return match.replace(/[^\n]/g, '');
  });
  const withoutLine = withoutBlocks.replace(/\/\/[^\n]*/g, '');
  return withoutLine;
}

/**
 * Compute a rough Halstead volume: V = N * log2(n)
 *   n = distinct operators + distinct operands
 *   N = total operator + operand occurrences
 * Tokens are extracted via a simple regex; identifiers/literals are treated
 * as operands, single punctuation characters as operators.
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

function countSizes(source: string): SizeCounts {
  const rawLines = source.split('\n');
  const physicalLines = rawLines.length;

  const stripped = stripComments(source);
  const strippedLines = stripped.split('\n');

  let logicalLines = 0;
  let blankLines = 0;
  for (let i = 0; i < physicalLines; i += 1) {
    const rawTrim = (rawLines[i] ?? '').trim();
    if (rawTrim === '') {
      blankLines += 1;
      continue;
    }
    const codeTrim = (strippedLines[i] ?? '').trim();
    if (codeTrim !== '') {
      logicalLines += 1;
    }
  }

  // By construction: physical = logical + blank + comment_lines
  // where comment_lines are raw-non-empty lines whose stripped form is empty.
  const commentLines = physicalLines - logicalLines - blankLines;

  const halsteadVolume = computeHalsteadVolume(source);

  return { physicalLines, logicalLines, blankLines, commentLines, halsteadVolume };
}

export class SizeAnalyzer implements Analyzer {
  public id = 'size';
  public category: AnalyzerCategory = 'size';
  public requires: AnalyzerCapability[] = [];

  public enabled(_config: AnalysisConfig): boolean {
    return true;
  }

  public async run(ctx: AnalyzerContext): Promise<AnalyzerResult> {
    const metrics: IEntityMetricCreateDTO[] = [];
    const moduleStats: ModuleStatsPatch[] = [];
    const entityStats: EntityStatsPatch[] = [];

    const { parseResult, packageId, snapshotId, logger } = ctx;

    for (const mod of parseResult.modules) {
      let source: string;
      try {
        source = await readFile(mod.source.filename, 'utf-8');
      } catch (err) {
        logger.debug(`[SizeAnalyzer] skipping unreadable module: ${mod.source.filename}`, err);
        continue;
      }

      const counts = countSizes(source);

      moduleStats.push({
        module_id: mod.id,
        columns: {
          physical_lines: counts.physicalLines,
          logical_lines: counts.logicalLines,
          comment_lines: counts.commentLines,
          halstead_volume: counts.halsteadVolume,
        },
      });

      const moduleMetricEntries: Array<{ key: string; value: number }> = [
        { key: 'size.physicalLines', value: counts.physicalLines },
        { key: 'size.logicalLines', value: counts.logicalLines },
        { key: 'size.commentLines', value: counts.commentLines },
        { key: 'size.halsteadVolume', value: counts.halsteadVolume },
      ];

      for (const entry of moduleMetricEntries) {
        metrics.push({
          id: generateEntityMetricUUID(snapshotId, mod.id, 'module', entry.key),
          snapshot_id: snapshotId,
          package_id: packageId,
          module_id: mod.id,
          entity_id: mod.id,
          entity_type: 'module',
          metric_key: entry.key,
          metric_value: entry.value,
          metric_category: 'size',
        });
      }
    }

    // Per-method metrics
    for (const method of parseResult.methods) {
      const { start_line: startLine, end_line: endLine } = method;
      if (typeof startLine !== 'number' || typeof endLine !== 'number') continue;

      const logicalLines = endLine - startLine + 1;

      entityStats.push({
        entity_id: method.id,
        entity_type: 'method',
        columns: { logical_lines: logicalLines },
      });

      metrics.push({
        id: generateEntityMetricUUID(snapshotId, method.id, 'method', 'size.logicalLines'),
        snapshot_id: snapshotId,
        package_id: packageId,
        module_id: method.module_id,
        entity_id: method.id,
        entity_type: 'method',
        metric_key: 'size.logicalLines',
        metric_value: logicalLines,
        metric_category: 'size',
      });
    }

    // Per-function metrics
    for (const fn of parseResult.functions) {
      const { start_line: startLine, end_line: endLine } = fn;
      if (typeof startLine !== 'number' || typeof endLine !== 'number') continue;

      const logicalLines = endLine - startLine + 1;

      entityStats.push({
        entity_id: fn.id,
        entity_type: 'function',
        columns: { logical_lines: logicalLines },
      });

      metrics.push({
        id: generateEntityMetricUUID(snapshotId, fn.id, 'function', 'size.logicalLines'),
        snapshot_id: snapshotId,
        package_id: packageId,
        module_id: fn.module_id,
        entity_id: fn.id,
        entity_type: 'function',
        metric_key: 'size.logicalLines',
        metric_value: logicalLines,
        metric_category: 'size',
      });
    }

    return { metrics, moduleStats, entityStats };
  }
}
