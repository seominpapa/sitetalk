import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e', timeout: 90_000, workers: 1, retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: process.env.E2E_BASE_URL || 'http://127.0.0.1:8787', channel: process.env.CI ? undefined : 'chrome', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: process.env.E2E_BASE_URL ? undefined : { command:'npm run dev:api -- --test-scheduled', url:'http://127.0.0.1:8787/api/health', reuseExistingServer:!process.env.CI, timeout:60_000 },
});
