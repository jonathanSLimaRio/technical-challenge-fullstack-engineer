export const TASK_STATUSES = ['todo', 'doing', 'blocked', 'done'] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export const DEFAULT_TASK_STATUS: TaskStatus = 'todo';

// Resolve o status salvo ou deriva um status compatível com o booleano legado.
export function resolveTaskStatus(
  status: TaskStatus | null | undefined,
  isCompleted: boolean,
): TaskStatus {
  return status ?? (isCompleted ? 'done' : DEFAULT_TASK_STATUS);
}

// Indica se um status representa uma tarefa concluída.
export function isCompletedStatus(status: TaskStatus): boolean {
  return status === 'done';
}
