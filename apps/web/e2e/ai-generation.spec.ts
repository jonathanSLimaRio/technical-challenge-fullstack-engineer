import { expect, test } from '@playwright/test';
import {
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

test('generates structured AI tasks from the UI without asking for the provider key', async ({
  page,
  request,
}) => {
  const goal = `E2E plano de revisao de IA ${Date.now()}`;
  await deleteTasksMatching(request, (task) => task.title.includes(goal));

  try {
    await page.goto('/');
    await waitForAppReady(page);
    await expect(page.getByLabel('Chave da API do provedor')).toHaveCount(0);
    await page.getByLabel('Objetivo').fill(goal);
    await page.getByRole('button', { name: 'Gerar plano' }).click();

    await expect(page.locator('.toast-viewport')).toContainText(
      'Plano criado com 1 historia e 6 subtarefas.',
    );

    const generatedStory = page
      .locator('.task-card')
      .filter({ hasText: goal });

    await expect(generatedStory).toBeVisible();
    await expect(generatedStory).toContainText('0/6 subtarefas');
    await generatedStory.getByRole('button', { name: 'Subtarefas' }).click();
    await expect(generatedStory).toContainText(
      `Esclarecer o resultado desejado para ${goal}`,
    );
    await expect(generatedStory).toContainText('Planejamento');

    await generatedStory.locator('.subtask-check').first().click();
    await expect(generatedStory).toContainText('1/6 subtarefas');

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

function isGeneratedByThisTest(task: TaskResponse, goal: string): boolean {
  return (
    task.isAiGenerated &&
    (task.title.includes(goal) || staticMockTaskTitles.has(task.title))
  );
}
