export const TASK_STATUSES = ['todo', 'doing', 'blocked', 'done'] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export type Task = {
  id: string;
  title: string;
  description: string | null;
  label: string | null;
  position: number;
  status: TaskStatus;
  isCompleted: boolean;
  isAiGenerated: boolean;
  createdAt: string;
  updatedAt: string;
};

export type GenerateTasksResponse = {
  tasks: Task[];
};
