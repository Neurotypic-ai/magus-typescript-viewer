import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for the TypeScript Dependency Graph Viewer.
 *
 * The dev server must be started manually before running tests:
 *   pnpm dev        (starts both UI on :4000 and API server on :4001)
 *
 * Run tests:
 *   npx playwright test
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env['CI'],
  retries: 0,
  workers: 1,
  reporter: 'html',

  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },

  use: {
    baseURL: 'http://localhost:4000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  /* Do NOT start the web server automatically — the user starts it manually. */
});
