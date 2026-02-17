import { defineConfig } from 'vitest/config';

import type { ViteUserConfigExport } from 'vitest/config';

const config: ViteUserConfigExport = defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: [],
    include: ['src/**/*.{test,spec}.{js,ts,jsx,tsx}'],
    exclude: ['node_modules/**', 'dist/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: [
        'src/client/composables/useSpringAnimation.ts',
        'src/client/composables/useCollisionResolution.ts',
        'src/client/layout/collisionResolver.ts',
      ],
      exclude: ['**/*.test.ts', '**/*.spec.ts', '**/*.d.ts'],
      thresholds: {
        lines: 60,
        branches: 55,
        functions: 60,
        statements: 60,
      },
    },
  },
});

export default config;
