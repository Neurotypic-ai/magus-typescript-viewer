/**
 * EslintAnalyzer
 *
 * Runs ESLint programmatically over every `.ts` / `.tsx` module in the
 * current package using the curated ruleset from {@link buildAnalysisEslintConfig}.
 * Emits one `ICodeIssueCreateDTO` per ESLint message.
 *
 * Implementation notes:
 *   - The `eslint` package and plugin set are resolved via dynamic `import()`
 *     so the analyzer degrades gracefully (warn + empty result) when they
 *     are missing from the environment.
 *   - `.vue` and `.d.ts` files are skipped: type-aware typescript-eslint rules
 *     misbehave on Vue SFC virtual files and ambient declaration files.
 *   - Files are linted in batches to bound memory; ESLint internally
 *     parallelizes within a batch.
 */
import { access } from 'node:fs/promises';
import { join } from 'node:path';

import { buildAnalysisEslintConfig } from '../eslint/analysis.config';
import { generateCodeIssueUUID } from '../../utils/uuid';

import type { ICodeIssueCreateDTO } from '../../../shared/types/dto/CodeIssueDTO';
import type {
  AnalysisConfig,
  Analyzer,
  AnalyzerCapability,
  AnalyzerCategory,
  AnalyzerContext,
  AnalyzerResult,
} from '../types';

/** Batch size for `eslint.lintFiles()` calls — bounds peak memory. */
const FILE_BATCH_SIZE = 10;

/** Map ESLint's numeric severity to our severity string. */
function mapSeverity(severity: number): string {
  if (severity === 2) return 'error';
  if (severity === 1) return 'warning';
  return 'info';
}

async function tsconfigPathOrTrue(packageRoot: string): Promise<string | undefined> {
  const candidate = join(packageRoot, 'tsconfig.json');
  try {
    await access(candidate);
    return candidate;
  } catch {
    return undefined;
  }
}

export class EslintAnalyzer implements Analyzer {
  public id = 'eslint';
  public category: AnalyzerCategory = 'quality';
  public requires: AnalyzerCapability[] = ['eslint'];

  public enabled(_config: AnalysisConfig): boolean {
    return true;
  }

  public async run(ctx: AnalyzerContext): Promise<AnalyzerResult> {
    const { parseResult, packageId, packageRoot, logger } = ctx;
    const findings: ICodeIssueCreateDTO[] = [];

    // 1. Dynamically import ESLint — gracefully skip if unavailable.
    let ESLintCtor: typeof import('eslint').ESLint;
    try {
      const eslintModule = await import('eslint');
      ESLintCtor = eslintModule.ESLint;
    } catch (err) {
      logger.warn(
        '[EslintAnalyzer] `eslint` could not be imported; skipping ESLint analysis.',
        err instanceof Error ? err.message : String(err)
      );
      return { findings };
    }

    // 2. Resolve tsconfig path (falls back to `project: true` inside the config builder).
    const resolvedTsconfig = await tsconfigPathOrTrue(packageRoot);
    const buildOptions: { projectTsconfig?: string } =
      resolvedTsconfig !== undefined ? { projectTsconfig: resolvedTsconfig } : {};

    // 3. Build the curated config. If this throws, any plugin is missing — warn + bail.
    let overrideConfig: Awaited<ReturnType<typeof buildAnalysisEslintConfig>>;
    try {
      overrideConfig = await buildAnalysisEslintConfig(buildOptions);
    } catch (err) {
      logger.warn(
        '[EslintAnalyzer] Failed to build ESLint config (plugin missing?); skipping.',
        err instanceof Error ? err.message : String(err)
      );
      return { findings };
    }

    // 4. Construct the ESLint instance.
    const eslint = new ESLintCtor({
      overrideConfigFile: true,
      overrideConfig,
      cwd: packageRoot,
    });

    // 5. Collect eligible files.
    const moduleByFile = new Map<string, (typeof parseResult.modules)[number]>();
    const eligible: string[] = [];
    for (const mod of parseResult.modules) {
      const file = mod.source.filename;
      if (file.endsWith('.d.ts')) continue;
      if (!file.endsWith('.ts') && !file.endsWith('.tsx')) continue;
      moduleByFile.set(file, mod);
      eligible.push(file);
    }

    if (eligible.length === 0) {
      return { findings };
    }

    // 6. Lint in bounded batches.
    for (let i = 0; i < eligible.length; i += FILE_BATCH_SIZE) {
      const batch = eligible.slice(i, i + FILE_BATCH_SIZE);
      let results: Awaited<ReturnType<typeof eslint.lintFiles>>;
      try {
        results = await eslint.lintFiles(batch);
      } catch (err) {
        logger.warn(
          `[EslintAnalyzer] lintFiles failed for batch starting at ${batch[0] ?? '<empty>'}; continuing.`,
          err instanceof Error ? err.message : String(err)
        );
        continue;
      }

      for (const result of results) {
        const mod = moduleByFile.get(result.filePath);
        if (!mod) continue;

        for (const message of result.messages) {
          const ruleCode = `eslint.${message.ruleId ?? 'unknown'}`;
          const line = message.line;
          const column = message.column;
          const entityKey = `${String(line)}:${String(column)}:${String(message.ruleId ?? 'unknown')}`;

          findings.push({
            id: generateCodeIssueUUID(mod.id, ruleCode, entityKey),
            rule_code: ruleCode,
            severity: mapSeverity(message.severity),
            message: message.message,
            package_id: packageId,
            module_id: mod.id,
            file_path: result.filePath,
            line,
            column,
          });
        }
      }
    }

    return { findings };
  }
}
