import type { INestApplication } from '@nestjs/common';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

type TestAppOptions = {
  env?: Record<string, string | undefined>;
};

type TestApp = {
  app: INestApplication;
  baseUrl: string;
  close: () => Promise<void>;
};

const managedEnvKeys = [
  'AI_THROTTLE_LIMIT',
  'AI_THROTTLE_TTL_MS',
  'CORS_ORIGIN',
  'ENABLE_SWAGGER',
  'LLM_API_KEY',
  'LLM_PROVIDER',
  'NODE_ENV',
  'SQLITE_PATH',
  'THROTTLE_LIMIT',
  'THROTTLE_TTL_MS',
  'TYPEORM_SYNCHRONIZE',
] as const;

export async function startTestApp(
  options: TestAppOptions = {},
): Promise<TestApp> {
  const databaseDirectory = mkdtempSync(join(tmpdir(), 'smart-todo-api-'));
  const previousEnv = snapshotEnv();

  setEnv({
    AI_THROTTLE_LIMIT: '20',
    AI_THROTTLE_TTL_MS: '60000',
    CORS_ORIGIN: 'http://allowed.test',
    ENABLE_SWAGGER: 'true',
    LLM_PROVIDER: 'mock',
    NODE_ENV: 'test',
    SQLITE_PATH: join(databaseDirectory, 'tasks.sqlite'),
    THROTTLE_LIMIT: '1000',
    THROTTLE_TTL_MS: '60000',
    TYPEORM_SYNCHRONIZE: 'true',
    ...options.env,
  });

  jest.resetModules();
  const { Test } = await import('@nestjs/testing');
  const { AppModule } = await import('../app.module');
  const { configureApp } = await import('../bootstrap');
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleRef.createNestApplication();

  configureApp(app);
  await app.listen(0);

  return {
    app,
    baseUrl: await app.getUrl(),
    close: async () => {
      await app.close();
      restoreEnv(previousEnv);
      rmSync(databaseDirectory, { force: true, recursive: true });
    },
  };
}

function snapshotEnv(): Map<string, string | undefined> {
  return new Map(
    managedEnvKeys.map((key) => [key, process.env[key]] as const),
  );
}

function setEnv(values: Record<string, string | undefined>): void {
  for (const key of managedEnvKeys) {
    const value = values[key];

    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function restoreEnv(previousEnv: Map<string, string | undefined>): void {
  for (const [key, value] of previousEnv) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}
