export type Task = {
  id: string;
  title: string;
  isCompleted: boolean;
  isAiGenerated: boolean;
  createdAt: string;
  updatedAt: string;
};

export type GenerateTasksResponse = {
  tasks: Task[];
};
