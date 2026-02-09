import globals from 'globals';

/** @type {import('@typescript-eslint/utils').TSESLint.FlatConfig.Config} */
export const nodeConfig = {
  files: ['eslint.config.js', 'mocks/**/*.js'],
  languageOptions: {
    globals: {
      ...globals.node,
    },
  },
};
