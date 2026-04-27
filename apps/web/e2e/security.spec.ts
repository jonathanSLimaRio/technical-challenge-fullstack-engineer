import { expect, test } from '@playwright/test';
import { apiUrl } from './helpers';

test('serves the web app with expected security headers', async ({ request }) => {
  const response = await request.get('/');
  const headers = response.headers();

  expect(response.ok()).toBe(true);
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['x-frame-options']).toBe('DENY');
  expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  expect(headers['strict-transport-security']).toContain('max-age=63072000');
  expect(headers['content-security-policy']).toContain("default-src 'self'");
  expect(headers['content-security-policy']).toContain(apiUrl);
  expect(headers['content-security-policy']).toContain('ws://127.0.0.1:3101');
});
