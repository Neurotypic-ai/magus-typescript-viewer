import markdownPlugin from '@eslint/markdown';
import tseslint from 'typescript-eslint';

/** @type {import('@typescript-eslint/utils').TSESLint.FlatConfig.Config} */
export const markdownConfig = {
  files: ['**/*.md'],
  plugins: {
    markdown: markdownPlugin,
  },
  processor: 'markdown/markdown',
};

/** @type {import('@typescript-eslint/utils').TSESLint.FlatConfig.Config} */
export const markdownTsConfig = {
  files: ['**/*.md/**/*.{ts,tsx}'],
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: {
      // Explicitly disable project for markdown code blocks
      project: null,
      projectService: false,
    },
  },
  rules: {
    ...tseslint.configs.base.rules,
    ...tseslint.configs.disableTypeChecked.rules,
    '@typescript-eslint/no-unused-vars': 'off',
    'import-x/no-unresolved': 'off',
  },
};
