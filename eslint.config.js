import { createESLintConfig } from '@magus-mark/eslint-config';

/** @type {import('@typescript-eslint/utils').TSESLint.FlatConfig.Config[]} */
export default createESLintConfig([
  {
    ignores: ['src/server/parsers/__tests__/fixtures/**'],
  },
]);
