import { defineConfig } from 'vitest/config';

import type { ViteUserConfigExport } from 'vitest/config';

const config: ViteUserConfigExport = defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./src/server/__tests__/setup.ts'],
    include: ['src/**/*.{test,spec}.{js,ts,jsx,tsx}'],
    exclude: ['node_modules/**', 'dist/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: [
        'src/server/**/*.ts',
        'src/client/composables/useSpringAnimation.ts',
        'src/client/composables/useCollisionResolution.ts',
        'src/client/layout/collisionResolver.ts',
      ],
      exclude: [
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/*.d.ts',
        'src/server/**/__tests__/**',
      ],
      thresholds: {
        lines: 35,
        branches: 25,
        functions: 35,
        statements: 35,
      },
    },
  },
});

export default config;
