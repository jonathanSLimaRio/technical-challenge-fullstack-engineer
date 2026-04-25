import { defineConfig, devices } from '@playwright/test';

const apiUrl = 'http://127.0.0.1:3101';
const webUrl = 'http://127.0.0.1:3100';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: {
    timeout: 7_500,
  },
  use: {
    baseURL: webUrl,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'npm --prefix ../api run start:e2e',
      env: {
        ...process.env,
        AI_THROTTLE_LIMIT: '20',
        AI_THROTTLE_TTL_MS: '60000',
        CORS_ORIGIN: `${webUrl},http://localhost:3100`,
        ENABLE_SWAGGER: 'true',
        LLM_PROVIDER: 'mock',
        PORT: '3101',
        SQLITE_PATH: '../../data/e2e-smart-todos.sqlite',
        THROTTLE_LIMIT: '500',
        THROTTLE_TTL_MS: '60000',
        TYPEORM_SYNCHRONIZE: 'true',
      },
      reuseExistingServer: true,
      timeout: 60_000,
      url: `${apiUrl}/health`,
    },
    {
      command: 'npm run start:e2e',
      env: {
        ...process.env,
        HOSTNAME: '127.0.0.1',
        NEXT_PUBLIC_API_URL: apiUrl,
        PORT: '3100',
      },
      reuseExistingServer: true,
      timeout: 60_000,
      url: webUrl,
    },
  ],
});
