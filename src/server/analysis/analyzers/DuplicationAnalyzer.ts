/**
 * DuplicationAnalyzer
 *
 * Runs `jscpd` as a subprocess to detect copy/paste duplication within the
 * package source tree. Each duplicate pair reported by jscpd becomes a
 * 2-fragment `IDuplicationClusterCreateDTO`.
 *
 * Known limitations:
 *   - jscpd emits duplicates as *pairs*. In reality a single copy/paste cluster
 *     can have N (>2) fragments, but we treat each pair as an independent
 *     2-fragment cluster. This over-counts cluster counts for wide-spread
 *     duplication but keeps the implementation simple and each individual
 *     cluster correct. A future refactor could group pairs sharing a common
 *     `fragment` hash into single N-fragment clusters.
 *   - Files not ending in `.ts`, `.tsx`, or `.js` (notably `.vue`) cannot be
 *     matched back to a module via `parseResult.modules` and are skipped from
 *     the emitted clusters.
 *   - If jscpd is not yet installed (parallel install race) the subprocess
 *     spawn fails; we log a warning and return an empty result rather than
 *     blowing up the pipeline.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import type {
  DuplicationFragment,
  IDuplicationClusterCreateDTO,
} from '../../../shared/types/dto/DuplicationClusterDTO';
import type { IEntityMetricCreateDTO } from '../../../shared/types/dto/EntityMetricDTO';
import type { IModuleCreateDTO } from '../../../shared/types/dto/ModuleDTO';
import type {
  AnalysisConfig,
  Analyzer,
  AnalyzerCapability,
  AnalyzerCategory,
  AnalyzerContext,
  AnalyzerResult,
} from '../types';
import {
  generateDuplicationClusterUUID,
  generateEntityMetricUUID,
} from '../../utils/uuid';

/** Shape of one entry in jscpd's `duplicates` array (subset we rely on). */
interface JscpdDuplicateLocation {
  name?: string;
  start?: number;
  end?: number;
  startLoc?: { line?: number };
  endLoc?: { line?: number };
}

interface JscpdDuplicate {
  format?: string;
  lines?: number;
  tokens?: number;
  fragment?: string;
  firstFile?: JscpdDuplicateLocation;
  secondFile?: JscpdDuplicateLocation;
}

interface JscpdReport {
  duplicates?: JscpdDuplicate[];
}

/** Runs the `npx jscpd` CLI. Resolves with the (possibly non-zero) exit code. */
function runJscpd(cwd: string, outDir: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const args = [
      'jscpd',
      '--reporters',
      'json',
      '--output',
      outDir,
      '--ignore',
      '**/node_modules/**',
      '--ignore',
      '**/dist/**',
      '--ignore',
      '**/*.test.ts',
      '--min-lines',
      '10',
      '--min-tokens',
      '70',
      'src',
    ];

    const child = spawn('npx', args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });

    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf-8');
    });
    // Drain stdout to avoid the pipe filling up.
    child.stdout.on('data', () => {
      /* ignored — we read the report file instead */
    });

    child.on('error', (err: Error) => {
      reject(err);
    });

    child.on('close', (code) => {
      // Any non-zero exit is accepted — jscpd exits non-zero when duplicates
      // exceed a threshold but the JSON report is still written. We'll decide
      // based on whether the report file is readable.
      const exit = code ?? 0;
      if (exit !== 0 && stderr !== '') {
        // Keep the warning but do not throw.
        // The caller logs this via ctx.logger if needed.
      }
      resolve(exit);
    });
  });
}

/**
 * Resolve a jscpd-reported file path (absolute or relative to `packageRoot`)
 * to a module in the parse result. Matches via endsWith on a normalized,
 * forward-slashed representation.
 */
function findModuleIdByFilename(
  modules: IModuleCreateDTO[],
  reportedFile: string
): string | null {
  if (reportedFile === '') return null;
  const normalized = reportedFile.replace(/\\/g, '/');
  for (const mod of modules) {
    const filename = mod.source.filename.replace(/\\/g, '/');
    if (filename === normalized) return mod.id;
    if (filename.endsWith(normalized) || normalized.endsWith(filename)) return mod.id;
  }
  return null;
}

/** SHA1 hash of an arbitrary string — used as a fallback fingerprint. */
function sha1(input: string): string {
  return createHash('sha1').update(input).digest('hex');
}

/** Extract a start line from a jscpd location entry; defaults to 0. */
function startLineOf(loc: JscpdDuplicateLocation | undefined): number {
  if (!loc) return 0;
  const fromStartLoc = loc.startLoc?.line;
  if (typeof fromStartLoc === 'number') return fromStartLoc;
  if (typeof loc.start === 'number') return loc.start;
  return 0;
}

/** Extract an end line from a jscpd location entry; defaults to 0. */
function endLineOf(loc: JscpdDuplicateLocation | undefined): number {
  if (!loc) return 0;
  const fromEndLoc = loc.endLoc?.line;
  if (typeof fromEndLoc === 'number') return fromEndLoc;
  if (typeof loc.end === 'number') return loc.end;
  return 0;
}

/** Filename of a jscpd location; empty string if unavailable. */
function fileOf(loc: JscpdDuplicateLocation | undefined): string {
  if (!loc) return '';
  return typeof loc.name === 'string' ? loc.name : '';
}

export class DuplicationAnalyzer implements Analyzer {
  public id = 'duplication';
  public category: AnalyzerCategory = 'duplication';
  public requires: AnalyzerCapability[] = ['subprocess'];

  public enabled(_config: AnalysisConfig): boolean {
    return true;
  }

  public async run(ctx: AnalyzerContext): Promise<AnalyzerResult> {
    const { parseResult, packageId, packageRoot, snapshotId, logger } = ctx;

    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'jscpd-'));
    try {
      try {
        await runJscpd(packageRoot, tempDir);
      } catch (err) {
        logger.warn(
          '[DuplicationAnalyzer] jscpd spawn failed — returning empty result',
          err instanceof Error ? err.message : String(err)
        );
        return {};
      }

      const reportPath = path.join(tempDir, 'jscpd-report.json');
      let raw: string;
      try {
        raw = await readFile(reportPath, 'utf-8');
      } catch (err) {
        logger.warn(
          `[DuplicationAnalyzer] jscpd report not found at ${reportPath} — returning empty result`,
          err instanceof Error ? err.message : String(err)
        );
        return {};
      }

      let report: JscpdReport;
      try {
        report = JSON.parse(raw) as JscpdReport;
      } catch (err) {
        logger.warn(
          '[DuplicationAnalyzer] jscpd report is not valid JSON — returning empty result',
          err instanceof Error ? err.message : String(err)
        );
        return {};
      }

      const duplicates = report.duplicates ?? [];
      const duplications: IDuplicationClusterCreateDTO[] = [];
      const moduleDupLines = new Map<string, number>();

      for (const dup of duplicates) {
        const firstFile = fileOf(dup.firstFile);
        const secondFile = fileOf(dup.secondFile);
        if (firstFile === '' || secondFile === '') continue;

        // Skip .vue files — our matching to modules uses .ts/.tsx/.js names.
        if (firstFile.endsWith('.vue') || secondFile.endsWith('.vue')) continue;

        const firstStart = startLineOf(dup.firstFile);
        const firstEnd = endLineOf(dup.firstFile);
        const secondStart = startLineOf(dup.secondFile);
        const secondEnd = endLineOf(dup.secondFile);

        const lineCount = typeof dup.lines === 'number' ? dup.lines : 0;
        const tokenCount = typeof dup.tokens === 'number' ? dup.tokens : 0;

        const fingerprint =
          typeof dup.fragment === 'string' && dup.fragment !== ''
            ? sha1(dup.fragment)
            : sha1(
                `${firstFile}:${String(firstStart)}:${secondFile}:${String(secondStart)}`
              );

        const firstModuleId = findModuleIdByFilename(parseResult.modules, firstFile);
        const secondModuleId = findModuleIdByFilename(parseResult.modules, secondFile);

        const fragments: DuplicationFragment[] = [
          {
            module_id: firstModuleId,
            file_path: firstFile,
            start_line: firstStart,
            end_line: firstEnd,
          },
          {
            module_id: secondModuleId,
            file_path: secondFile,
            start_line: secondStart,
            end_line: secondEnd,
          },
        ];

        duplications.push({
          id: generateDuplicationClusterUUID(packageId, fingerprint),
          package_id: packageId,
          token_count: tokenCount,
          line_count: lineCount,
          fragment_count: 2,
          fingerprint,
          fragments_json: JSON.stringify(fragments),
        });

        if (firstModuleId !== null) {
          moduleDupLines.set(
            firstModuleId,
            (moduleDupLines.get(firstModuleId) ?? 0) + lineCount
          );
        }
        if (secondModuleId !== null && secondModuleId !== firstModuleId) {
          moduleDupLines.set(
            secondModuleId,
            (moduleDupLines.get(secondModuleId) ?? 0) + lineCount
          );
        }
      }

      const metrics: IEntityMetricCreateDTO[] = [];
      for (const [moduleId, duplicatedLines] of moduleDupLines) {
        metrics.push({
          id: generateEntityMetricUUID(
            snapshotId,
            moduleId,
            'module',
            'duplication.duplicatedLineCount'
          ),
          snapshot_id: snapshotId,
          package_id: packageId,
          module_id: moduleId,
          entity_id: moduleId,
          entity_type: 'module',
          metric_key: 'duplication.duplicatedLineCount',
          metric_value: duplicatedLines,
          metric_category: 'duplication',
        });
      }

      return { duplications, metrics };
    } finally {
      try {
        await rm(tempDir, { recursive: true, force: true });
      } catch (err) {
        logger.debug(
          `[DuplicationAnalyzer] failed to clean up tempdir ${tempDir}`,
          err instanceof Error ? err.message : String(err)
        );
      }
    }
  }
}
