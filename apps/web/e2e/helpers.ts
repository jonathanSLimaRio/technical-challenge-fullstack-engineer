import {
  type APIRequestContext,
  expect,
  type Page,
} from '@playwright/test';

export type TaskResponse = {
  description?: string | null;
  id: string;
  isAiGenerated: boolean;
  isCompleted?: boolean;
  label?: string | null;
  parentId?: string | null;
  position?: number;
  rootId?: string | null;
  status?: string;
  title: string;
};

export const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:3101';

export async function deleteTasksByTitle(
  request: APIRequestContext,
  title: string,
): Promise<void> {
  await deleteTasksMatching(request, (task) => task.title === title);
}

export async function deleteTasksMatching(
  request: APIRequestContext,
  predicate: (task: TaskResponse) => boolean,
): Promise<void> {
  const response = await request.get(`${apiUrl}/tasks`);

  expect(response.ok()).toBe(true);

  const tasks = (await response.json()) as TaskResponse[];

  await Promise.all(
    tasks
      .filter(predicate)
      .map((task) => request.delete(`${apiUrl}/tasks/${task.id}`)),
  );
}

export async function waitForAppReady(page: Page): Promise<void> {
  await expect(
    page.getByRole('button', { name: 'Recarregar tarefas' }),
  ).toBeEnabled();
}
