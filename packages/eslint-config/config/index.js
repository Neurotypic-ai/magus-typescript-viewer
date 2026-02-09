import tseslint from 'typescript-eslint';

import { baseConfig } from './base.js';
import { ignoresConfig } from './ignore.js';
import { jsConfig } from './javascript.js';
import { markdownConfig, markdownTsConfig } from './markdown.js';
import { nodeConfig } from './node.js';
import { testConfig } from './test.js';
import { tsConfig } from './typescript.js';

export const DEBUG = process.env['NODE_ENV'] === 'development' && process.env['DEBUG'] === 'true';

/**
 * @param {import('@typescript-eslint/utils').TSESLint.FlatConfig.Config[]} customConfig
 * @returns {import('@typescript-eslint/utils').TSESLint.FlatConfig.Config[]}
 */
export function createESLintConfig(customConfig = []) {
  // Export the complete config using typescript-eslint's config function
  /** @type {import('@typescript-eslint/utils').TSESLint.FlatConfig.Config[]} */
  const configs = [
    baseConfig,
    jsConfig,
    tsConfig,
    markdownTsConfig,
    markdownConfig,
    testConfig,
    nodeConfig,
    ignoresConfig,
    ...customConfig,
  ];

  /** @type {import('@typescript-eslint/utils').TSESLint.FlatConfig.Config[]} */
  const combinedConfig = tseslint.config(...configs);

  if (DEBUG) {
    console.info(combinedConfig);
  }

  return combinedConfig;
}
