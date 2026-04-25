import {
  expect,
  type APIRequestContext,
  type Locator,
  type Page,
  test,
} from '@playwright/test';
import {
  apiUrl,
  deleteTasksByTitle,
  type TaskResponse,
  waitForAppReady,
} from './helpers';

test('creates, completes, filters and deletes a manual task', async ({
  page,
  request,
}) => {
  const title = `E2E manual task ${Date.now()}`;
  await deleteTasksByTitle(request, title);

  await page.goto('/');
  await waitForAppReady(page);
  await page.getByLabel(/T.tulo da tarefa/).fill(title);

  const addTaskButton = page.getByRole('button', { name: 'Adicionar tarefa' });
  await expect(addTaskButton).toBeEnabled();
  await addTaskButton.click();

  const taskCard = page.locator('.task-card').filter({ hasText: title });
  await expect(taskCard).toBeVisible();

  await taskCard.getByRole('button', { name: /Marcar como conclu.da/ }).click();
  await page.getByRole('button', { name: /Conclu.das/ }).click();

  await expect(
    page.locator('.task-card').filter({ hasText: title }),
  ).toBeVisible();

  await taskCard.getByRole('button', { name: 'Excluir tarefa' }).click();
  await taskCard.getByRole('button', { name: 'Excluir', exact: true }).click();

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

  await firstPage.getByLabel(/T.tulo da tarefa/).fill(title);

  const addTaskButton = firstPage.getByRole('button', {
    name: 'Adicionar tarefa',
  });
  await expect(addTaskButton).toBeEnabled();
  await addTaskButton.click();

  await expect(
    secondPage.locator('.task-card').filter({ hasText: title }),
  ).toBeVisible();

  await deleteTasksByTitle(request, title);
  await context.close();
});

test('edits task description and label from the card modal', async ({
  page,
  request,
}) => {
  const title = `E2E detailed task ${Date.now()}`;
  const description = 'Confirmar requisitos, dependencias e criterio de pronto.';
  const label = 'Discovery';
  await deleteTasksByTitle(request, title);

  try {
    await page.goto('/');
    await waitForAppReady(page);
    await page.getByLabel(/T.tulo da tarefa/).fill(title);
    await page.getByRole('button', { name: 'Adicionar tarefa' }).click();

    const taskCard = page.locator('.task-card').filter({ hasText: title });
    await expect(taskCard).toBeVisible();
    await taskCard
      .getByRole('button', { name: `Editar detalhes de ${title}` })
      .click();

    const dialog = page.getByRole('dialog', { name: title });
    await expect(dialog).toBeVisible();
    await dialog.locator('textarea').fill(description);
    await dialog.locator('input[type="text"]').fill(label);
    await dialog.getByRole('button', { name: 'Salvar detalhes' }).click();

    await expect(dialog).toHaveCount(0);
    await expect(taskCard).toContainText(description);
    await expect(taskCard).toContainText(label);

    await page.reload();
    await waitForAppReady(page);
    const reloadedCard = page.locator('.task-card').filter({ hasText: title });

    await expect(reloadedCard).toContainText(description);
    await expect(reloadedCard).toContainText(label);
  } finally {
    await deleteTasksByTitle(request, title);
  }
});

test('persists card order after drag and reload', async ({ page, request }) => {
  const stamp = Date.now();
  const firstTitle = `E2E reorder first ${stamp}`;
  const secondTitle = `E2E reorder second ${stamp}`;
  const thirdTitle = `E2E reorder third ${stamp}`;
  const titles = [firstTitle, secondTitle, thirdTitle];

  for (const title of titles) {
    await deleteTasksByTitle(request, title);
  }

  try {
    const createdTasks: TaskResponse[] = [];

    for (const title of titles) {
      createdTasks.push(await createTaskByApi(request, title));
    }

    await moveTasksToFront(request, createdTasks.map((task) => task.id));
    await page.goto('/');
    await waitForAppReady(page);

    await expectTaskOrder(page, titles);

    const thirdCard = page.locator('.task-card').filter({ hasText: thirdTitle });
    const firstCard = page.locator('.task-card').filter({ hasText: firstTitle });

    await dragTaskCard(page, thirdCard, firstCard);
    await expectTaskOrder(page, [thirdTitle, firstTitle, secondTitle]);

    await page.reload();
    await waitForAppReady(page);
    await expectTaskOrder(page, [thirdTitle, firstTitle, secondTitle]);
  } finally {
    for (const title of titles) {
      await deleteTasksByTitle(request, title);
    }
  }
});

test('shows refresh tooltip on hover and keyboard focus', async ({ page }) => {
  await page.goto('/');
  await waitForAppReady(page);

  const refreshButton = page.getByRole('button', { name: 'Recarregar tarefas' });
  const refreshTooltip = page.getByRole('tooltip', {
    name: 'Recarregar tarefas da API.',
  });

  await refreshButton.hover();
  await expect(refreshTooltip).toBeVisible();

  await page.mouse.move(0, 0);
  await expect(refreshTooltip).toBeHidden();

  await refreshButton.focus();
  await expect(refreshTooltip).toBeVisible();
});

async function createTaskByApi(
  request: APIRequestContext,
  title: string,
): Promise<TaskResponse> {
  const response = await request.post(`${apiUrl}/tasks`, {
    data: { title },
  });

  expect(response.ok()).toBe(true);

  return (await response.json()) as TaskResponse;
}

async function moveTasksToFront(
  request: APIRequestContext,
  taskIds: string[],
): Promise<void> {
  const response = await request.get(`${apiUrl}/tasks`);

  expect(response.ok()).toBe(true);

  const tasks = (await response.json()) as TaskResponse[];
  const taskIdSet = new Set(taskIds);
  const orderedIds = [
    ...taskIds,
    ...tasks.filter((task) => !taskIdSet.has(task.id)).map((task) => task.id),
  ];
  const reorderResponse = await request.patch(`${apiUrl}/tasks/reorder`, {
    data: { orderedIds },
  });

  expect(reorderResponse.ok()).toBe(true);
}

async function dragTaskCard(
  page: Page,
  sourceCard: Locator,
  targetCard: Locator,
): Promise<void> {
  await sourceCard.scrollIntoViewIfNeeded();
  await targetCard.scrollIntoViewIfNeeded();

  const handle = sourceCard.getByRole('button', { name: /Arrastar tarefa/ });
  const handleBox = await handle.boundingBox();
  const targetBox = await targetCard.boundingBox();

  if (!handleBox || !targetBox) {
    throw new Error('Task cards were not visible enough to drag.');
  }

  await page.mouse.move(
    handleBox.x + handleBox.width / 2,
    handleBox.y + handleBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    targetBox.x + targetBox.width / 2,
    targetBox.y + targetBox.height / 2,
    { steps: 8 },
  );
  await page.mouse.up();
}

async function expectTaskOrder(page: Page, titles: string[]): Promise<void> {
  for (const [index, title] of titles.entries()) {
    await expect(page.locator('.task-card').nth(index)).toContainText(title);
  }
}
