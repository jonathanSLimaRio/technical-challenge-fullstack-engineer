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
  await createManualTaskFromModal(page, title);

  const taskCard = page.locator('.task-card').filter({ hasText: title });
  await expect(taskCard).toBeVisible();
  await expect(page.getByRole('region', { name: 'Raia A Fazer' })).toContainText(
    title,
  );

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

  await createManualTaskFromModal(firstPage, title);

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
    await createManualTaskFromModal(page, title);

    const taskCard = page.locator('.task-card').filter({ hasText: title });
    await expect(taskCard).toBeVisible();
    await taskCard
      .getByRole('button', { name: `Editar detalhes de ${title}` })
      .click();

    const dialog = page.getByRole('dialog', { name: 'Editar tarefa' });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Conteúdo').fill(description);
    await dialog.getByLabel('Etiqueta').fill(label);
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

test('creates a detailed quick capture and moves it across kanban lanes', async ({
  page,
  request,
}) => {
  const title = `E2E kanban task ${Date.now()}`;
  const description = 'Mapear os passos principais antes de executar.';
  const label = 'Kanban';
  await deleteTasksByTitle(request, title);

  try {
    await page.goto('/');
    await waitForAppReady(page);
    await createManualTaskFromModal(page, title, description, label);

    const taskCard = page.locator('.task-card').filter({ hasText: title });
    await expect(taskCard).toContainText(description);
    await expect(taskCard).toContainText(label);
    await expectMetricsFromApi(page, request);

    await dragTaskToLane(page, taskCard, 'Fazendo');
    await expect(
      page.getByRole('region', { name: 'Raia Fazendo' }),
    ).toContainText(title);
    await expectMetricsFromApi(page, request);

    await dragTaskToLane(page, taskCard, 'Block');
    await expect(page.getByRole('region', { name: 'Raia Block' })).toContainText(
      title,
    );
    await expectMetricsFromApi(page, request);

    await dragTaskToLane(page, taskCard, 'Concluído');
    await expect(
      page.getByRole('region', { name: 'Raia Concluído' }),
    ).toContainText(title);
    await expectMetricsFromApi(page, request);

    await page.reload();
    await waitForAppReady(page);
    await expect(
      page.getByRole('region', { name: 'Raia Concluído' }),
    ).toContainText(title);
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

async function createManualTaskFromModal(
  page: Page,
  title: string,
  description = '',
  label = '',
): Promise<void> {
  await page.getByRole('button', { name: 'Abrir captura rápida' }).click();

  const dialog = page.getByRole('dialog', { name: 'Captura rápida' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Título').fill(title);

  if (description) {
    await dialog.getByLabel('Conteúdo').fill(description);
  }

  if (label) {
    await dialog.getByLabel('Etiqueta').fill(label);
  }

  const createButton = dialog.getByRole('button', { name: 'Criar tarefa' });
  await expect(createButton).toBeEnabled();
  await createButton.click();
  await expect(dialog).toHaveCount(0);
}

async function expectMetricsFromApi(
  page: Page,
  request: APIRequestContext,
): Promise<void> {
  const response = await request.get(`${apiUrl}/tasks`);

  expect(response.ok()).toBe(true);

  const tasks = (await response.json()) as TaskResponse[];
  const completed = tasks.filter((task) => getTaskStatus(task) === 'done').length;
  const total = tasks.length;
  const pending = total - completed;
  const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;

  await expect(page.getByRole('group', { name: `Total: ${total}` })).toBeVisible();
  await expect(
    page.getByRole('group', { name: `Pendentes: ${pending}` }),
  ).toBeVisible();
  await expect(
    page.getByRole('group', { name: `Concluídas: ${completed}` }),
  ).toBeVisible();
  await expect(
    page.getByRole('group', { name: `Conclusão: ${completionRate}%` }),
  ).toBeVisible();
}

function getTaskStatus(task: TaskResponse): string {
  return task.status ?? (task.isCompleted ? 'done' : 'todo');
}

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

async function dragTaskToLane(
  page: Page,
  sourceCard: Locator,
  laneLabel: string,
): Promise<void> {
  await sourceCard.scrollIntoViewIfNeeded();

  const lane = page.getByRole('region', { name: `Raia ${laneLabel}` });
  await lane.scrollIntoViewIfNeeded();

  const handle = sourceCard.getByRole('button', { name: /Arrastar tarefa/ });
  const handleBox = await handle.boundingBox();
  const laneBox = await lane.boundingBox();

  if (!handleBox || !laneBox) {
    throw new Error('Task card or target lane was not visible enough to drag.');
  }

  await page.mouse.move(
    handleBox.x + handleBox.width / 2,
    handleBox.y + handleBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    laneBox.x + laneBox.width / 2,
    laneBox.y + Math.min(laneBox.height - 24, 150),
    { steps: 10 },
  );
  await page.mouse.up();
}

async function expectTaskOrder(page: Page, titles: string[]): Promise<void> {
  for (const [index, title] of titles.entries()) {
    await expect(page.locator('.task-card').nth(index)).toContainText(title);
  }
}
