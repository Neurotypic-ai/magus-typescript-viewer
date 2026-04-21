// NOTE: This is a user-customizable starting point. Add/remove rules to tune signal-to-noise for your codebase.
/**
 * Curated flat-config ruleset used by {@link EslintAnalyzer}.
 *
 * The config intentionally enables a small, high-signal set of rules from
 * `@typescript-eslint`, `sonarjs`, and `unicorn`. It is separate from the
 * project's own lint config so analysis can evolve independently.
 *
 * Plugins and the TypeScript parser are resolved at call-time via dynamic
 * `import()`. That way this module can be imported even in environments
 * where the plugins are missing — the analyzer itself guards against
 * resolution failures and downgrades to an empty result.
 */
import type { ESLint, Linter } from 'eslint';

export interface BuildAnalysisEslintConfigOptions {
  /**
   * Path to the project's `tsconfig.json`. If omitted, the parser falls back
   * to `project: true` which asks the TS parser to auto-discover the nearest
   * tsconfig from each linted file.
   */
  projectTsconfig?: string;
}

/** Minimal shape we care about for plugin/parser dynamic imports. */
interface ModuleWithDefault<T> {
  default?: T;
}

async function loadDefaultOrNamespace<T>(specifier: string): Promise<T> {
  const mod = (await import(specifier)) as T & ModuleWithDefault<T>;
  // ESM-over-CJS interop: prefer `.default` when present.
  return (mod.default ?? mod) as T;
}

/**
 * Build the flat-config array used by the analyzer.
 *
 * Returns a single-element array because ESLint flat configs are
 * concatenated — callers may prepend/append additional entries.
 */
export async function buildAnalysisEslintConfig(
  options: BuildAnalysisEslintConfigOptions
): Promise<Linter.Config[]> {
  const projectTsconfig: string | true = options.projectTsconfig ?? true;

  const [tsParser, tsPlugin, sonarjsPlugin, unicornPlugin] = await Promise.all([
    loadDefaultOrNamespace<Linter.Parser>('@typescript-eslint/parser'),
    loadDefaultOrNamespace<ESLint.Plugin>('@typescript-eslint/eslint-plugin'),
    loadDefaultOrNamespace<ESLint.Plugin>('eslint-plugin-sonarjs'),
    loadDefaultOrNamespace<ESLint.Plugin>('eslint-plugin-unicorn'),
  ]);

  const config: Linter.Config = {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: projectTsconfig,
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      sonarjs: sonarjsPlugin,
      unicorn: unicornPlugin,
    },
    rules: {
      // --- @typescript-eslint (type-aware + type-free) ---
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-misused-promises': 'warn',
      '@typescript-eslint/require-await': 'warn',
      '@typescript-eslint/switch-exhaustiveness-check': 'warn',

      // --- sonarjs (quality / duplication / complexity) ---
      'sonarjs/cognitive-complexity': ['warn', 15],
      'sonarjs/no-duplicate-string': ['warn', { threshold: 5 }],
      'sonarjs/no-identical-functions': 'warn',
      'sonarjs/no-collapsible-if': 'warn',
      'sonarjs/prefer-immediate-return': 'warn',

      // --- unicorn (modernization / hygiene) ---
      'unicorn/no-array-for-each': 'warn',
      'unicorn/prefer-node-protocol': 'warn',
      'unicorn/no-abusive-eslint-disable': 'warn',
    },
  };

  return [config];
}
