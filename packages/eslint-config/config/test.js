import testingLibraryPlugin from 'eslint-plugin-testing-library';
import globals from 'globals';

/** @type {import('@typescript-eslint/utils').TSESLint.FlatConfig.Config} */
export const testConfig = {
  files: ['**/*.test.{js,jsx,ts,tsx}', '**/__mocks__/**/*.{js,jsx,ts,tsx}', '**/testing/**/*.{js,jsx,ts,tsx}'],
  languageOptions: {
    globals: {
      ...globals.jest,
    },
  },
  plugins: {
    'testing-library': testingLibraryPlugin,
  },
  settings: {},
  rules: {
    ...testingLibraryPlugin.configs['flat/react'].rules,
    '@typescript-eslint/unbound-method': 'off',
    
    // Allow some flexibility in test files for mocking purposes
    '@typescript-eslint/no-explicit-any': ['warn', { 
      fixToUnknown: true,
      ignoreRestArgs: true
    }],
    '@typescript-eslint/no-unsafe-assignment': 'warn',
    '@typescript-eslint/no-unsafe-argument': 'warn',
    '@typescript-eslint/no-unsafe-call': 'warn',
    '@typescript-eslint/no-unsafe-member-access': 'warn',
    '@typescript-eslint/no-unsafe-return': 'warn',
  },
};
