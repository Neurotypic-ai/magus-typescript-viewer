/** @type {import('@typescript-eslint/utils').TSESLint.FlatConfig.Config} */
export const ignoresConfig = {
  ignores: [
    '**/.nx/**/*',
    '**/node_modules/**/*', // Ensure all node_modules are ignored
    '**/build/*',
    '**/public/build/*',
    '**/dist/*',
    '**/dist-server/*',
    '**/coverage/*',
    '.specstory/*',
    '**/examples/*',
  ],
};
