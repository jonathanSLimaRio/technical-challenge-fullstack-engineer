import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type ComposeFile = {
  services?: Record<string, ComposeService>;
  volumes?: Record<string, unknown>;
};

type ComposeService = {
  build?: {
    context?: string;
    dockerfile?: string;
  };
  depends_on?: Record<string, { condition?: string }>;
  environment?: Record<string, string | number>;
  healthcheck?: {
    retries?: number;
    test?: string[];
  };
  ports?: string[];
  volumes?: string[];
};

const { load } = require('js-yaml') as {
  load(source: string): unknown;
};

describe('docker-compose.yml', () => {
  it('defines API and web services with healthchecks and SQLite persistence', () => {
    const compose = loadCompose();
    const api = expectService(compose, 'api');
    const web = expectService(compose, 'web');

    expect(api.build).toMatchObject({
      context: '.',
      dockerfile: 'apps/api/Dockerfile',
    });
    expect(web.build).toMatchObject({
      context: '.',
      dockerfile: 'apps/web/Dockerfile',
    });
    expect(api.ports).toContain('3001:3001');
    expect(web.ports).toContain('3000:3000');
    expect(api.environment).toMatchObject({
      PORT: 3001,
      SQLITE_PATH: '/data/smart-todos.sqlite',
    });
    expect(api.environment).toHaveProperty('AI_THROTTLE_LIMIT');
    expect(api.volumes).toContain('sqlite-data:/data');
    expect(compose.volumes).toHaveProperty('sqlite-data');
    expect(web.depends_on).toEqual({
      api: { condition: 'service_healthy' },
    });
  });

  it('keeps both service healthchecks wired to their local endpoints', () => {
    const compose = loadCompose();
    const api = expectService(compose, 'api');
    const web = expectService(compose, 'web');

    expect(api.healthcheck?.test?.join(' ')).toContain(
      'http://localhost:3001/health',
    );
    expect(api.healthcheck?.retries).toBe(5);
    expect(web.healthcheck?.test?.join(' ')).toContain('http://localhost:3000');
    expect(web.healthcheck?.retries).toBe(5);
  });
});

function loadCompose(): ComposeFile {
  const composePath = join(__dirname, '..', '..', '..', '..', 'docker-compose.yml');
  const source = readFileSync(composePath, 'utf8');

  return load(source) as ComposeFile;
}

function expectService(compose: ComposeFile, name: string): ComposeService {
  const service = compose.services?.[name];

  expect(service).toBeDefined();

  return service as ComposeService;
}
