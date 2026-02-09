import js from '@eslint/js';
import jsxA11yPlugin from 'eslint-plugin-jsx-a11y';
import reactPlugin from 'eslint-plugin-react';
import reactHooksPlugin from 'eslint-plugin-react-hooks';

/** @type {import('@typescript-eslint/utils').TSESLint.FlatConfig.Config} */
export const jsConfig = {
  files: ['**/*.{js,jsx}'],
  plugins: {
    react: reactPlugin,
    'jsx-a11y': jsxA11yPlugin,
    'react-hooks': reactHooksPlugin,
  },
  rules: {
    ...js.configs.recommended.rules,
    ...(reactPlugin.configs.flat?.['recommended']?.rules || {}),
    ...(reactPlugin.configs.flat?.['jsx-runtime']?.rules || {}),
    ...reactHooksPlugin.configs.recommended.rules,
    ...jsxA11yPlugin.flatConfigs.recommended.rules,
    'react/jsx-no-leaked-render': ['warn', { validStrategies: ['ternary'] }],
  },
  settings: {
    react: {
      version: '19',
    },
    formComponents: ['Form'],
    linkComponents: [
      { name: 'Link', linkAttribute: 'to' },
      { name: 'NavLink', linkAttribute: 'to' },
    ],
  },
};
