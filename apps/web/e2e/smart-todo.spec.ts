import {
  type APIRequestContext,
  expect,
  type Page,
  test,
} from '@playwright/test';

type TaskResponse = {
  id: string;
  title: string;
};

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:3101';

async function deleteTasksByTitle(
  request: APIRequestContext,
  title: string,
): Promise<void> {
  const response = await request.get(`${apiUrl}/tasks`);
  const tasks = (await response.json()) as TaskResponse[];

  await Promise.all(
    tasks
      .filter((task) => task.title === title)
      .map((task) => request.delete(`${apiUrl}/tasks/${task.id}`)),
  );
}

async function waitForAppReady(page: Page): Promise<void> {
  await expect(page.getByRole('button', { name: 'Refresh tasks' })).toBeEnabled();
}

test('creates, completes, filters and deletes a manual task', async ({
  page,
  request,
}) => {
  const title = `E2E manual task ${Date.now()}`;
  await deleteTasksByTitle(request, title);

  await page.goto('/');
  await waitForAppReady(page);
  await page.getByLabel('Task title').fill(title);

  const addTaskButton = page.getByRole('button', { name: 'Add task' });
  await expect(addTaskButton).toBeEnabled();
  await addTaskButton.click();

  const taskCard = page.locator('.task-card').filter({ hasText: title });
  await expect(taskCard).toBeVisible();

  await taskCard.getByRole('button', { name: 'Mark done' }).click();
  await page.getByRole('button', { name: /Done/ }).click();

  await expect(
    page.locator('.task-card').filter({ hasText: title }),
  ).toBeVisible();

  await taskCard.getByRole('button', { name: 'Delete task' }).click();
  await taskCard.getByRole('button', { name: 'Delete', exact: true }).click();

  await expect(
    page.locator('.task-card').filter({ hasText: title }),
  ).toHaveCount(0);
});

test('syncs task creation across two open pages', async ({ browser, request }) => {
  const title = `E2E live task ${Date.now()}`;
  await deleteTasksByTitle(request, title);

  const context = await browser.newContext();
  const firstPage = await context.newPage();
  const secondPage = await context.newPage();

  await firstPage.goto('/');
  await secondPage.goto('/');
  await waitForAppReady(firstPage);
  await waitForAppReady(secondPage);

  await firstPage.getByLabel('Task title').fill(title);

  const addTaskButton = firstPage.getByRole('button', { name: 'Add task' });
  await expect(addTaskButton).toBeEnabled();
  await addTaskButton.click();

  await expect(
    secondPage.locator('.task-card').filter({ hasText: title }),
  ).toBeVisible();

  await deleteTasksByTitle(request, title);
  await context.close();
});

test('shows refresh tooltip on hover and keyboard focus', async ({ page }) => {
  await page.goto('/');
  await waitForAppReady(page);

  const refreshButton = page.getByRole('button', { name: 'Refresh tasks' });
  const refreshTooltip = page.getByRole('tooltip', {
    name: 'Reload tasks from the API.',
  });

  await refreshButton.hover();
  await expect(refreshTooltip).toBeVisible();

  await page.mouse.move(0, 0);
  await expect(refreshTooltip).toBeHidden();

  await refreshButton.focus();
  await expect(refreshTooltip).toBeVisible();
});
