export const TASK_STATUSES = ['todo', 'doing', 'blocked', 'done'] as const;

// Representa os status aceitos para uma tarefa no quadro.
export type TaskStatus = (typeof TASK_STATUSES)[number];

// Define o contrato completo de uma tarefa retornada pela API.
export type Task = {
  id: string;
  title: string;
  description: string | null;
  label: string | null;
  parentId: string | null;
  rootId: string | null;
  position: number;
  status: TaskStatus;
  isCompleted: boolean;
  isAiGenerated: boolean;
  createdAt: string;
  updatedAt: string;
};

// Define a resposta dos endpoints que retornam tarefas geradas por IA.
export type GenerateTasksResponse = {
  tasks: Task[];
};

// Define os campos editáveis de uma tarefa dentro de um rascunho de IA.
export type AiDraftTask = {
  title: string;
  description: string | null;
  label: string | null;
};

// Define o contrato de um plano de IA com história principal e subtarefas.
export type AiDraftPlan = {
  story: AiDraftTask;
  subtasks: AiDraftTask[];
};
