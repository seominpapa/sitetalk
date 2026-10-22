import { defineConfig } from '@playwright/test';

if (!process.env.DOCKER_E2E_BASE_URL || !process.env.DOCKER_E2E_CREDENTIALS_FILE || !process.env.DOCKER_E2E_STATE_FILE) {
  throw new Error('Run Docker browser checks through npm run test:docker to create an isolated environment');
}

export default defineConfig({
  testDir: './tests', testMatch: 'docker.spec.ts', timeout: 90_000, workers: 1, retries: 0,
  reporter: [['list']], outputDir: process.env.DOCKER_E2E_OUTPUT_DIR || '.wrangler/docker-results',
  use: {
    baseURL: process.env.DOCKER_E2E_BASE_URL,
    actionTimeout: 15_000, navigationTimeout: 15_000,
    channel: process.env.CI ? undefined : 'chrome',
    screenshot: 'off', trace: 'off', video: 'off',
  },
});
