export const TASK_STATUSES = ['todo', 'doing', 'blocked', 'done'] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export const DEFAULT_TASK_STATUS: TaskStatus = 'todo';

export function resolveTaskStatus(
  status: TaskStatus | null | undefined,
  isCompleted: boolean,
): TaskStatus {
  return status ?? (isCompleted ? 'done' : DEFAULT_TASK_STATUS);
}

export function isCompletedStatus(status: TaskStatus): boolean {
  return status === 'done';
}
