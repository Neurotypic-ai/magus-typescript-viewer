import importXPlugin from 'eslint-plugin-import-x';
import jsxA11yPlugin from 'eslint-plugin-jsx-a11y';
import reactPlugin from 'eslint-plugin-react';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

// TypeScript base configuration
const tsStrictTypeChecked = tseslint.configs.strictTypeChecked[2] ?? undefined; // Get the actual recommended rules
const tsStylisticTypeChecked = tseslint.configs.stylisticTypeChecked[2] ?? undefined; // Get the actual stylistic rules

/** @type {import('@typescript-eslint/utils').TSESLint.FlatConfig.Config} */
export const tsConfig = {
  files: ['**/*.{ts,tsx}'],
  plugins: {
    '@typescript-eslint': tseslint.plugin,
    react: reactPlugin,
    'jsx-a11y': jsxA11yPlugin,
    'react-hooks': reactHooksPlugin,
    'import-x': importXPlugin,
  },
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: {
      // projectService: true automatically discovers tsconfig files from the workspace root
      // No need to set tsconfigRootDir - it will be inferred from where ESLint is run
      projectService: true,
    },
  },
  settings: {
    react: {
      version: '19',
    },
    'import-x/resolver': {
      typescript: true,
      node: true,
    },
  },
  rules: {
    ...importXPlugin.configs.recommended.rules,
    ...importXPlugin.configs.typescript.rules,

    // React and JSX rules
    ...(reactPlugin.configs.flat?.['recommended']?.rules || {}),
    ...(reactPlugin.configs.flat?.['jsx-runtime']?.rules || {}),
    ...reactHooksPlugin.configs.recommended.rules,
    ...jsxA11yPlugin.flatConfigs.recommended.rules,

    ...(tsStrictTypeChecked?.rules || {}),
    ...(tsStylisticTypeChecked?.rules || {}),

    'import-x/order': 'off',

    // Custom TypeScript rules
    'react/prop-types': 'off',
    'react/jsx-no-leaked-render': ['warn', { validStrategies: ['ternary'] }],
    '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
    '@typescript-eslint/no-import-type-side-effects': 'error',

    // Strict type safety rules
    '@typescript-eslint/no-explicit-any': [
      'error',
      {
        fixToUnknown: false,
        ignoreRestArgs: false,
      },
    ],
    '@typescript-eslint/no-unsafe-assignment': 'error',
    '@typescript-eslint/no-unsafe-argument': 'error',
    '@typescript-eslint/no-unsafe-call': 'error',
    '@typescript-eslint/no-unsafe-member-access': 'error',
    '@typescript-eslint/no-unsafe-return': 'error',

    // Prefer safer operators
    '@typescript-eslint/prefer-nullish-coalescing': 'error',
    '@typescript-eslint/no-unnecessary-type-conversion': 'error',
    '@typescript-eslint/no-unnecessary-condition': 'error',

    // Unused variables and parameters
    '@typescript-eslint/no-unused-vars': [
      'error',
      {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      },
    ],

    '@typescript-eslint/only-throw-error': [
      'error',
      {
        allow: [
          { from: 'lib', name: 'Response' },
          { from: 'package', name: 'redirect', package: 'react-router' },
          { from: 'package', name: 'redirect', package: 'react-router-dom' },
        ],
        allowThrowingAny: false,
        allowThrowingUnknown: false,
      },
    ],
  },
};
