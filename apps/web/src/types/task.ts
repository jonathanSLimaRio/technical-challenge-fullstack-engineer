export type Task = {
  id: string;
  title: string;
  description: string | null;
  label: string | null;
  position: number;
  isCompleted: boolean;
  isAiGenerated: boolean;
  createdAt: string;
  updatedAt: string;
};

export type GenerateTasksResponse = {
  tasks: Task[];
};
