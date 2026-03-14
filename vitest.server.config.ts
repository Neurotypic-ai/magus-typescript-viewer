import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./src/server/__tests__/setup.ts'],
    include: [
      'src/server/**/*.test.{ts,tsx,mts,mtsx}',
      'src/server/**/*.spec.{ts,tsx,mts,mtsx}',
    ],
    exclude: ['node_modules/**', 'dist/**', 'src/client/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/server/**/*.ts'],
      exclude: [
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/*.d.ts',
        'src/server/**/__tests__/**',
        'src/server/bin/**',
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
