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

  await expect(page.getByLabel('Carregando tarefas')).toBeVisible();

  releaseTasksResponse();

  await expect(
    page.getByRole('heading', { name: 'Sua fila está pronta' }),
  ).toBeVisible();
});

test('shows API errors and retries the task list request', async ({ page }) => {
  let shouldFail = true;

  await page.route('**/socket.io/**', async (route) => {
    await route.abort();
  });

  await page.route(`${apiUrl}/tasks`, async (route) => {
    if (shouldFail) {
      await route.fulfill({
        json: { message: 'Banco de dados temporariamente indisponível' },
        status: 503,
      });
      return;
    }

    await route.fulfill({ json: [] });
  });

  await page.goto('/');

  const errorBanner = page.locator('.feedback.error');

  await expect(errorBanner).toContainText(
    'Banco de dados temporariamente indisponível',
  );

  shouldFail = false;

  const retryButton = errorBanner.getByRole('button', {
    name: 'Tentar novamente',
  });

  await expect(retryButton).toBeVisible();
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url() === `${apiUrl}/tasks` && response.status() === 200,
    ),
    retryButton.click(),
  ]);

  await expect(
    page.getByRole('heading', { name: 'Sua fila está pronta' }),
  ).toBeVisible();
});

test('switches and persists the selected theme', async ({ page }) => {
  await page.route(`${apiUrl}/tasks`, async (route) => {
    await route.fulfill({ json: [] });
  });

  await page.goto('/');

  const html = page.locator('html');
  const lightButton = page.getByRole('button', {
    exact: true,
    name: 'Light',
  });
  const darkButton = page.getByRole('button', { exact: true, name: 'Dark' });

  await expect(html).toHaveAttribute('data-theme', 'light');
  await expect(lightButton).toHaveAttribute('aria-pressed', 'true');

  await darkButton.click();

  await expect(html).toHaveAttribute('data-theme', 'dark');
  await expect(darkButton).toHaveAttribute('aria-pressed', 'true');

  await page.reload();

  await expect(html).toHaveAttribute('data-theme', 'dark');
  await expect(darkButton).toHaveAttribute('aria-pressed', 'true');

  await lightButton.click();

  await expect(html).toHaveAttribute('data-theme', 'light');
  await expect(lightButton).toHaveAttribute('aria-pressed', 'true');
});
