import { expect, test } from '@playwright/test';
import {
  apiUrl,
  deleteTasksMatching,
  type TaskResponse,
  waitForAppReady,
} from './helpers';

const staticMockTaskTitles = new Set([
  'Listar os menores proximos passos acionaveis',
  'Identificar dependencias, bloqueios e entradas necessarias',
  'Priorizar as tarefas por impacto e urgencia',
  'Agendar o primeiro bloco de execucao focada',
  'Revisar o progresso e ajustar o plano',
]);

test('previews, edits and saves structured AI tasks without asking for the provider key', async ({
  page,
  request,
}) => {
  const goal = `E2E plano de revisao de IA ${Date.now()}`;
  const editedStoryTitle = `Plano editado ${goal}`;
  const editedSubtaskTitle = `Subtarefa editada ${goal}`;
  await deleteTasksMatching(request, (task) => task.title.includes(goal));

  try {
    await page.goto('/');
    await waitForAppReady(page);
    await expect(page.getByLabel('Chave da API do provedor')).toHaveCount(0);
    await page.getByLabel('Objetivo').fill(goal);
    await page.getByRole('button', { name: 'Gerar rascunho' }).click();

    const draft = page.getByLabel('Rascunho do plano');
    await expect(draft).toBeVisible();
    await draft.getByLabel('Titulo da historia').fill(editedStoryTitle);
    await draft
      .getByRole('region', { name: 'Subtarefa 1' })
      .getByLabel('Titulo')
      .fill(editedSubtaskTitle);
    await draft.getByRole('button', { name: 'Remover subtarefa 6' }).click();
    await draft.getByRole('button', { name: 'Salvar plano' }).click();

    await expect(page.locator('.toast-viewport')).toContainText(
      'Plano salvo com 1 historia e 5 subtarefas.',
    );

    const generatedStory = page
      .locator('.task-card')
      .filter({ hasText: editedStoryTitle });

    await expect(generatedStory).toBeVisible();
    await expect(generatedStory).toContainText('0/5 subtarefas');
    await generatedStory.getByRole('button', { name: 'Subtarefas' }).click();
    await expect(generatedStory).toContainText(editedSubtaskTitle);
    await expect(generatedStory).not.toContainText(
      'Revisar o progresso e ajustar o plano',
    );
    await expect(generatedStory).toContainText('Planejamento');

    await generatedStory.locator('.subtask-check').first().click();
    await expect(generatedStory).toContainText('1/5 subtarefas');

    await page.getByRole('button', { name: /^IA/ }).click();
    await expect(generatedStory).toBeVisible();
    await expect(generatedStory).toContainText('Gerada por IA');

    const browserStorage = await page.evaluate(() => ({
      localStorage: Object.entries(localStorage),
      sessionStorage: Object.entries(sessionStorage),
    }));
    const cookies = await page.context().cookies();

    expect(JSON.stringify({ browserStorage, cookies })).not.toContain(
      'sk-e2e-secret',
    );
  } finally {
    await deleteTasksMatching(request, (task) => isGeneratedByThisTest(task, goal));
  }
});

test('cancels an AI draft without persisting tasks', async ({ page, request }) => {
  const goal = `E2E rascunho cancelado ${Date.now()}`;
  await deleteTasksMatching(request, (task) => task.title.includes(goal));

  try {
    await page.goto('/');
    await waitForAppReady(page);
    await page.getByLabel('Objetivo').fill(goal);
    await page.getByRole('button', { name: 'Gerar rascunho' }).click();

    const draft = page.getByLabel('Rascunho do plano');
    await expect(draft).toBeVisible();
    await draft.getByRole('button', { name: 'Cancelar' }).click();

    await expect(draft).toHaveCount(0);
    const tasksResponse = await request.get(`${apiUrl}/tasks`);
    expect(tasksResponse.ok()).toBe(true);
    const tasks = (await tasksResponse.json()) as TaskResponse[];
    expect(tasks.some((task) => task.title.includes(goal))).toBe(false);
  } finally {
    await deleteTasksMatching(request, (task) => task.title.includes(goal));
  }
});

test('shows feedback when AI preview and confirm fail', async ({ page }) => {
  await page.route(`${apiUrl}/tasks/ai-preview`, async (route) => {
    await route.fulfill({
      json: { message: 'IA indisponivel para rascunho' },
      status: 502,
    });
  });

  await page.goto('/');
  await waitForAppReady(page);
  await page.getByLabel('Objetivo').fill(`E2E falha preview ${Date.now()}`);
  await page.getByRole('button', { name: 'Gerar rascunho' }).click();

  await expect(page.locator('.toast-viewport')).toContainText(
    'IA indisponivel para rascunho',
  );

  await page.unroute(`${apiUrl}/tasks/ai-preview`);
  await page.route(`${apiUrl}/tasks/ai-preview`, async (route) => {
    await route.fulfill({
      json: {
        story: {
          description: 'Story draft',
          label: 'Plano',
          title: 'Draft story',
        },
        subtasks: [
          {
            description: 'Subtask draft',
            label: 'Planejamento',
            title: 'Draft subtask',
          },
        ],
      },
      status: 201,
    });
  });
  await page.route(`${apiUrl}/tasks/ai-confirm`, async (route) => {
    await route.fulfill({
      json: { message: 'Falha ao salvar plano' },
      status: 503,
    });
  });

  await page.getByLabel('Objetivo').fill(`E2E falha confirm ${Date.now()}`);
  await page.getByRole('button', { name: 'Gerar rascunho' }).click();
  await expect(page.getByLabel('Rascunho do plano')).toBeVisible();
  await page.getByRole('button', { name: 'Salvar plano' }).click();

  await expect(page.locator('.toast-viewport')).toContainText(
    'Falha ao salvar plano',
  );
  await expect(page.getByLabel('Rascunho do plano')).toBeVisible();
});

function isGeneratedByThisTest(task: TaskResponse, goal: string): boolean {
  return (
    task.isAiGenerated &&
    (task.title.includes(goal) || staticMockTaskTitles.has(task.title))
  );
}
