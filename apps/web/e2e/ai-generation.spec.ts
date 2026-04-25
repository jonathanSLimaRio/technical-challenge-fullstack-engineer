import { expect, test } from '@playwright/test';
import {
  deleteTasksMatching,
  type TaskResponse,
  waitForAppReady,
} from './helpers';

const staticMockTaskTitles = new Set([
  'Listar os menores próximos passos acionáveis',
  'Identificar dependências, bloqueios e entradas necessárias',
  'Priorizar as tarefas por impacto e urgência',
  'Agendar o primeiro bloco de execução focada',
  'Revisar o progresso e ajustar o plano',
]);

test('generates AI tasks from the UI without asking for the provider key', async ({
  page,
  request,
}) => {
  const goal = `E2E plano de revisão de IA ${Date.now()}`;
  await deleteTasksMatching(request, (task) => task.title.includes(goal));

  try {
    await page.goto('/');
    await waitForAppReady(page);
    await expect(page.getByLabel('Chave da API do provedor')).toHaveCount(0);
    await page.getByLabel('Objetivo').fill(goal);
    await page.getByRole('button', { name: 'Gerar tarefas' }).click();

    await expect(page.locator('.toast-viewport')).toContainText(
      '6 tarefas da IA criadas.',
    );

    const uniqueGeneratedTask = page
      .locator('.task-card')
      .filter({ hasText: `Esclarecer o resultado desejado para ${goal}` });

    await expect(uniqueGeneratedTask).toBeVisible();

    await page.getByRole('button', { name: /^IA/ }).click();
    await expect(uniqueGeneratedTask).toBeVisible();
    await expect(uniqueGeneratedTask).toContainText('Gerada por IA');

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
