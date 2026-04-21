import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/**
 * Opaque handle to a ts-morph `Project` instance. We intentionally do not
 * `import type { Project } from 'ts-morph'` here — this helper must compile
 * even when ts-morph isn't installed (bootstrap phases and environments that
 * opt out of the heavier analyzers). Analyzers that consume it cast
 * `ctx.project` to the real `Project` type at their own call site, which is
 * where a hard ts-morph dependency is acceptable.
 */
export type TsMorphProject = object;

/**
 * Create a shared ts-morph Project rooted at the given package directory.
 * Loads tsconfig.json if present; otherwise falls back to an empty project
 * that allows adding files manually.
 *
 * Analyzers that consume this (ComplexityAnalyzer, TypeSafetyAnalyzer,
 * CallGraphAnalyzer, DocumentationAnalyzer) cast `ctx.project` to Project.
 *
 * ts-morph is imported dynamically through a computed specifier so this
 * module compiles and loads even when ts-morph itself is not installed —
 * callers receive `null` in that case and gracefully skip analyzers that
 * require it.
 */
export async function createTsMorphProject(packageRoot: string): Promise<TsMorphProject | null> {
  // Compute the specifier via a variable so TypeScript doesn't try to
  // statically resolve the `ts-morph` module. Matches the pattern used by
  // AnalyzerPipeline.tryCreateTsMorphProject for consistency.
  const specifier = 'ts-morph';
  try {
    // eslint-disable-next-line dollarwise/no-dynamic-imports -- lazy load so ts-morph stays optional
    const mod = (await import(/* @vite-ignore */ specifier)) as {
      Project?: new (options?: Record<string, unknown>) => TsMorphProject;
    };

    if (typeof mod.Project !== 'function') {
      return null;
    }

    const tsconfigPath = path.join(packageRoot, 'tsconfig.json');
    const exists = await fs
      .stat(tsconfigPath)
      .then(() => true)
      .catch(() => false);

    const project = new mod.Project({
      ...(exists ? { tsConfigFilePath: tsconfigPath } : {}),
      skipAddingFilesFromTsConfig: false,
      skipFileDependencyResolution: true, // speeds up loading significantly
      compilerOptions: {
        allowJs: true,
        jsx: 2, // Preserve — fine for static analysis purposes.
      },
    });
    return project;
  } catch {
    // ts-morph not installed or failed to load — caller handles null.
    return null;
  }
}
