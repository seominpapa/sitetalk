import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e', timeout: 90_000, workers: 1, retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: process.env.E2E_BASE_URL || 'http://127.0.0.1:8787', channel: process.env.CI ? undefined : 'chrome', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  // Public test fixture encryption key, bound only to the local test Worker (never a deployment).
  webServer: process.env.E2E_BASE_URL ? undefined : { command:`npm run dev:api -- --test-scheduled --var AI_SETTINGS_ENCRYPTION_KEY:${Buffer.alloc(32, 1).toString('base64')}`, url:'http://127.0.0.1:8787/api/health', reuseExistingServer:false, timeout:60_000 },
});
