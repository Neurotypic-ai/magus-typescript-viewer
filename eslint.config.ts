import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createESLintConfig } from '@neurotypic-ai/eslint-config';

import type { TSESLint } from '@typescript-eslint/utils';

const __dirname = dirname(fileURLToPath(import.meta.url));

const config: TSESLint.FlatConfig.Config[] = createESLintConfig(
  [
    {
      files: ['src/**/*.{ts,tsx,vue}'],
      rules: {
        'no-console': 'warn',
      },
    },
  ],
  {
    tsconfigRootDir: __dirname,
  }
);

export default config;
