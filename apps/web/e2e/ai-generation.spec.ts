import { expect, test } from '@playwright/test';
import {
  deleteTasksMatching,
  type TaskResponse,
  waitForAppReady,
} from './helpers';

const staticMockTaskTitles = new Set([
  'List the smallest actionable next steps',
  'Identify dependencies, blockers and required inputs',
  'Prioritize the tasks by impact and urgency',
  'Schedule the first focused execution block',
  'Review progress and adjust the plan',
]);

test('generates AI tasks from the UI without storing the provider key', async ({
  page,
  request,
}) => {
  const goal = `E2E AI review plan ${Date.now()}`;
  const apiKey = `sk-e2e-secret-${Date.now()}`;

  await deleteTasksMatching(request, (task) => task.title.includes(goal));

  try {
    await page.goto('/');
    await waitForAppReady(page);
    await page.getByLabel('Goal').fill(goal);
    await page.getByLabel('Provider API key').fill(apiKey);
    await page.getByRole('button', { name: 'Generate tasks' }).click();

    await expect(page.getByRole('status')).toContainText('6 AI tasks created.');

    const uniqueGeneratedTask = page
      .locator('.task-card')
      .filter({ hasText: `Clarify the desired outcome for ${goal}` });

    await expect(uniqueGeneratedTask).toBeVisible();

    await page.getByRole('button', { name: /^AI/ }).click();
    await expect(uniqueGeneratedTask).toBeVisible();
    await expect(uniqueGeneratedTask).toContainText('AI generated');

    const browserStorage = await page.evaluate(() => ({
      localStorage: Object.entries(localStorage),
      sessionStorage: Object.entries(sessionStorage),
    }));
    const cookies = await page.context().cookies();

    expect(JSON.stringify({ browserStorage, cookies })).not.toContain(apiKey);
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
