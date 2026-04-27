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

test('shows a modal skeleton while generating the AI draft', async ({ page }) => {
  let markPreviewRequested!: () => void;
  let releasePreview!: () => void;
  const previewRequested = new Promise<void>((resolve) => {
    markPreviewRequested = resolve;
  });
  const previewRelease = new Promise<void>((resolve) => {
    releasePreview = resolve;
  });

  await page.route(`${apiUrl}/tasks/ai-preview`, async (route) => {
    markPreviewRequested();
    await previewRelease;
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

  await page.goto('/');
  await waitForAppReady(page);
  await page.getByLabel('Objetivo').fill(`E2E skeleton ${Date.now()}`);
  await page.getByRole('button', { name: 'Gerar rascunho' }).click();
  await previewRequested;

  const loadingDialog = page.getByRole('dialog', {
    name: 'Gerando rascunho',
  });
  await expect(loadingDialog).toBeVisible();
  await expect(
    loadingDialog.getByRole('status', { name: 'Carregando rascunho' }),
  ).toBeVisible();

  releasePreview();

  const readyDialog = page.getByRole('dialog', {
    name: 'Revise antes de salvar',
  });
  await expect(readyDialog.getByLabel('Rascunho do plano')).toBeVisible();
  await expect(readyDialog.getByLabel('Titulo da historia')).toHaveValue(
    'Draft story',
  );
});

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

    const dialog = page.getByRole('dialog', {
      name: 'Revise antes de salvar',
    });
    const draft = dialog.getByLabel('Rascunho do plano');
    await expect(draft).toBeVisible();
    await draft.getByLabel('Titulo da historia').fill(editedStoryTitle);
    await draft
      .getByRole('region', { name: 'Subtarefa 1' })
      .getByLabel('Titulo')
      .fill(editedSubtaskTitle);
    await draft.getByRole('button', { name: 'Remover subtarefa 6' }).click();
    await draft.getByRole('button', { name: 'Salvar plano' }).click();

    await expect(dialog).toHaveCount(0);
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

test('cancels an AI draft while loading without persisting tasks', async ({
  page,
  request,
}) => {
  const goal = `E2E rascunho cancelado ${Date.now()}`;
  let releasePreview!: () => void;
  const previewRelease = new Promise<void>((resolve) => {
    releasePreview = resolve;
  });
  await page.route(`${apiUrl}/tasks/ai-preview`, async (route) => {
    await previewRelease;
    try {
      await route.fulfill({
        json: {
          story: {
            description: 'Cancelled draft',
            label: 'Plano',
            title: goal,
          },
          subtasks: [
            {
              description: 'Cancelled subtask',
              label: 'Planejamento',
              title: `Subtask ${goal}`,
            },
          ],
        },
        status: 201,
      });
    } catch {
      // The browser can abort the request before this mocked response resolves.
    }
  });
  await deleteTasksMatching(request, (task) => task.title.includes(goal));

  try {
    await page.goto('/');
    await waitForAppReady(page);
    await page.getByLabel('Objetivo').fill(goal);
    await page.getByRole('button', { name: 'Gerar rascunho' }).click();

    const dialog = page.getByRole('dialog', { name: 'Gerando rascunho' });
    await expect(
      dialog.getByRole('status', { name: 'Carregando rascunho' }),
    ).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancelar' }).click();

    await expect(dialog).toHaveCount(0);
    releasePreview();
    await expect(page.getByRole('dialog')).toHaveCount(0);
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

  const errorDialog = page.getByRole('dialog', {
    name: 'Nao foi possivel gerar',
  });
  await expect(errorDialog.getByRole('alert')).toContainText(
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

  await errorDialog.getByRole('button', { name: 'Tentar novamente' }).click();
  const draftDialog = page.getByRole('dialog', {
    name: 'Revise antes de salvar',
  });
  await expect(draftDialog.getByLabel('Rascunho do plano')).toBeVisible();
  await draftDialog.getByRole('button', { name: 'Salvar plano' }).click();

  await expect(page.locator('.toast-viewport')).toContainText(
    'Falha ao salvar plano',
  );
  await expect(draftDialog.getByLabel('Rascunho do plano')).toBeVisible();
});

function isGeneratedByThisTest(task: TaskResponse, goal: string): boolean {
  return (
    task.isAiGenerated &&
    (task.title.includes(goal) || staticMockTaskTitles.has(task.title))
  );
}
