import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './electron',
  testMatch: /\.e2e\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  reporter: 'line',
  timeout: 30_000,
  expect: { timeout: 5_000 },
});
