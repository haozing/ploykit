import { defineConfig, devices } from '@playwright/test';
import { resolve } from 'path';
import { loadDockerDbEnv } from './scripts/docker-db-env';

const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:3100';
const parsedBaseUrl = new URL(baseURL);
const testBlobRoot = resolve(process.cwd(), '.data', 'test-blobs');
const browserMatrixEnabled = process.env.PLAYWRIGHT_BROWSER_MATRIX === '1';

function webServerEnv(): Record<string, string> {
  const env = loadDockerDbEnv();

  return {
    NODE_ENV: 'production',
    PORT: parsedBaseUrl.port || '3100',
    HOSTNAME: parsedBaseUrl.hostname,
    DB_PROVIDER: env.DB_PROVIDER || 'postgres',
    DATABASE_URL: env.DATABASE_URL || 'postgresql://ploykit:ploykit@localhost:55432/ploykit',
    BETTER_AUTH_URL: baseURL,
    NEXT_PUBLIC_APP_URL: baseURL,
    BETTER_AUTH_SECRET: 'local-docker-dev-secret-change-me-32-chars',
    AUTH_PASSWORD_RESET_DELIVERY: 'log',
    PLUGIN_SECRET_ENCRYPTION_KEY: 'local-plugin-secret-change-me-32-chars',
    PLUGIN_FILE_SIGNING_SECRET: 'local-plugin-file-signing-secret-change-me-32-chars',
    BILLING_ENABLED: 'false',
    BILLING_DEMO_API_ENABLED: 'true',
    FILE_STORAGE_ENABLED: 'true',
    FILE_STORAGE_DRIVER: 'local',
    FILE_STORAGE_LOCAL_ROOT: testBlobRoot,
  };
}

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },
  reporter: [['list'], ['html', { outputFolder: 'test-results/playwright-report', open: 'never' }]],
  outputDir: 'test-results/playwright',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
  },
  webServer: process.env.PLAYWRIGHT_SKIP_WEBSERVER
    ? undefined
    : {
        command: 'npm run start',
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
        env: webServerEnv(),
      },
  projects: browserMatrixEnabled
    ? [
        {
          name: 'chromium-desktop',
          use: { ...devices['Desktop Chrome'] },
        },
        {
          name: 'chromium-mobile',
          use: { ...devices['Pixel 5'] },
        },
        {
          name: 'firefox-desktop',
          use: { ...devices['Desktop Firefox'] },
        },
        {
          name: 'webkit-desktop',
          use: { ...devices['Desktop Safari'] },
        },
      ]
    : [
        {
          name: 'chromium-desktop',
          use: { ...devices['Desktop Chrome'] },
        },
        {
          name: 'chromium-mobile',
          use: { ...devices['Pixel 5'] },
        },
      ],
});
