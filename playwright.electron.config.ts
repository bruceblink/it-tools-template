import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './electron',
  testMatch: /\.e2e\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  reporter: 'line',
  outputDir: process.env.PLAYWRIGHT_OUTPUT_DIR ?? './test-results',
  timeout: 30_000,
  use: {
    testIdAttribute: 'data-test-id',
  },
  // Plugin entrypoints may take up to 15 seconds to load before lifecycle management fails them.
  expect: { timeout: 20_000 },
});
