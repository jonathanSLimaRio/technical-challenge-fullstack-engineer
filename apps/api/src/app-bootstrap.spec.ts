import { HttpStatus } from '@nestjs/common';
import { startTestApp } from './test-utils/app-test-harness';

jest.setTimeout(60000);

describe('API bootstrap configuration', () => {
  it('serves Swagger docs when enabled outside production', async () => {
    const { baseUrl, close } = await startTestApp();

    try {
      const response = await fetch(`${baseUrl}/docs-json`);
      const payload = (await response.json()) as {
        info: { title: string };
        paths: Record<string, unknown>;
      };

      expect(response.status).toBe(HttpStatus.OK);
      expect(payload.info.title).toBe('Smart To-Do List API');
      expect(payload.paths).toHaveProperty('/tasks');
      expect(payload.paths).toHaveProperty('/tasks/ai-generate');
    } finally {
      await close();
    }
  });

  it('applies CORS and Helmet security headers', async () => {
    const { baseUrl, close } = await startTestApp({
      env: {
        CORS_ORIGIN: 'http://allowed.test,http://other.test',
      },
    });

    try {
      const preflightResponse = await fetch(`${baseUrl}/tasks`, {
        headers: {
          'Access-Control-Request-Method': 'POST',
          Origin: 'http://allowed.test',
        },
        method: 'OPTIONS',
      });
      const healthResponse = await fetch(`${baseUrl}/health`);

      expect(preflightResponse.status).toBe(HttpStatus.NO_CONTENT);
      expect(preflightResponse.headers.get('access-control-allow-origin')).toBe(
        'http://allowed.test',
      );
      expect(
        preflightResponse.headers.get('access-control-allow-methods'),
      ).toContain('PATCH');
      expect(healthResponse.headers.get('x-content-type-options')).toBe(
        'nosniff',
      );
      expect(healthResponse.headers.get('x-frame-options')).toBe('SAMEORIGIN');
    } finally {
      await close();
    }
  });

  it('disables Swagger in production unless explicitly enabled', async () => {
    const { baseUrl, close } = await startTestApp({
      env: {
        ENABLE_SWAGGER: 'false',
        NODE_ENV: 'production',
      },
    });

    try {
      const response = await fetch(`${baseUrl}/docs-json`);
      const healthResponse = await fetch(`${baseUrl}/health`);

      expect(response.status).toBe(HttpStatus.NOT_FOUND);
      expect(healthResponse.headers.get('strict-transport-security')).toContain(
        'max-age=31536000',
      );
    } finally {
      await close();
    }
  });
});
