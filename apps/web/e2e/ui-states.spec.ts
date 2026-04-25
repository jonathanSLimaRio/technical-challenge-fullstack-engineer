import { expect, test } from '@playwright/test';
import { apiUrl } from './helpers';

test('shows loading and empty states for the task list', async ({ page }) => {
  let releaseTasksResponse: () => void = () => undefined;
  let resolveTaskRequestStarted: () => void = () => undefined;
  const taskRequestStarted = new Promise<void>((resolve) => {
    resolveTaskRequestStarted = resolve;
  });

  await page.route(`${apiUrl}/tasks`, async (route) => {
    resolveTaskRequestStarted();
    await new Promise<void>((release) => {
      releaseTasksResponse = release;
    });
    await route.fulfill({ json: [] });
  });

  await page.goto('/');
  await taskRequestStarted;

  await expect(page.getByLabel('Loading tasks')).toBeVisible();

  releaseTasksResponse();

  await expect(
    page.getByRole('heading', { name: 'Your queue is ready' }),
  ).toBeVisible();
});

test('shows API errors and retries the task list request', async ({ page }) => {
  let shouldFail = true;

  await page.route(`${apiUrl}/tasks`, async (route) => {
    if (shouldFail) {
      await route.fulfill({
        json: { message: 'Database temporarily unavailable' },
        status: 503,
      });
      return;
    }

    await route.fulfill({ json: [] });
  });

  await page.goto('/');

  const errorBanner = page.locator('.feedback.error');

  await expect(errorBanner).toContainText(
    'Database temporarily unavailable',
  );

  shouldFail = false;
  await errorBanner.getByRole('button', { name: 'Retry' }).click();

  await expect(
    page.getByRole('heading', { name: 'Your queue is ready' }),
  ).toBeVisible();
});
