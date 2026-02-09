import prettierConfig from 'eslint-config-prettier';
import globals from 'globals';

/** @type {import('@typescript-eslint/utils').TSESLint.FlatConfig.Config} */
export const baseConfig = {
  files: ['**/*'],
  languageOptions: {
    globals: {
      ...globals.browser,
      ...globals.es2024,
      ...globals.node,
    },
    parserOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      ecmaFeatures: {
        jsx: true,
        impliedStrict: true,
      },
    },
  },
  ...prettierConfig,
};
