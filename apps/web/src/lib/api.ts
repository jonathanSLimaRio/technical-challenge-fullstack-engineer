import type {
  AiDraftPlan,
  GenerateTasksResponse,
  Task,
  TaskStatus,
} from '../types/task';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

// Define o formato esperado para mensagens de erro devolvidas pela API.
type ApiErrorPayload = {
  message?: string | string[];
  error?: string;
};

// Representa uma falha HTTP retornada pela API com seu status.
export class ApiError extends Error {
  // Guarda a mensagem amigável e o código HTTP associado à falha.
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// Executa uma requisição JSON contra a API e padroniza erros de resposta.
async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    throw new ApiError(await readErrorMessage(response), response.status);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

// Extrai a melhor mensagem de erro disponível no corpo da resposta.
async function readErrorMessage(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as ApiErrorPayload;
    const message = payload.message;

    if (Array.isArray(message)) {
      return message.join(' ');
    }

    if (typeof message === 'string') {
      return message;
    }

    if (typeof payload.error === 'string') {
      return payload.error;
    }
  } catch {
    return 'Não foi possível concluir a solicitação.';
  }

  return 'Não foi possível concluir a solicitação.';
}

// Busca todas as tarefas persistidas na API.
export function fetchTasks(): Promise<Task[]> {
  return request<Task[]>('/tasks');
}

// Retorna a origem configurada da API para uso em conexões HTTP e WebSocket.
export function getApiOrigin(): string {
  try {
    return new URL(API_URL).origin;
  } catch {
    return API_URL;
  }
}

// Define os dados aceitos para criar uma tarefa pelo frontend.
type CreateTaskPayload = {
  description?: string;
  label?: string;
  title: string;
};

type AiGenerationOptions = Pick<RequestInit, 'signal'> & {
  apiKey?: string;
};

// Monta o corpo de geracao por IA sem enviar chave vazia.
function buildAiGenerationPayload(goal: string, apiKey: string | undefined) {
  const normalizedApiKey = apiKey?.trim();

  return normalizedApiKey ? { apiKey: normalizedApiKey, goal } : { goal };
}

// Cria uma tarefa manual usando título simples ou payload completo.
export function createTask(payload: CreateTaskPayload | string): Promise<Task> {
  const body = typeof payload === 'string' ? { title: payload } : payload;

  return request<Task>('/tasks', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

// Atualiza campos editáveis ou status de uma tarefa existente.
export function updateTask(
  id: string,
  payload: {
    description?: string;
    isCompleted?: boolean;
    label?: string;
    status?: TaskStatus;
    title?: string;
  },
): Promise<Task> {
  return request<Task>(`/tasks/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

// Move uma tarefa para outro status e envia a nova ordenação da raia.
export function moveTask(
  id: string,
  payload: {
    orderedIds: string[];
    status: TaskStatus;
  },
): Promise<Task[]> {
  return request<Task[]>(`/tasks/${encodeURIComponent(id)}/move`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

// Exclui uma tarefa pelo identificador informado.
export function deleteTask(id: string): Promise<void> {
  return request<void>(`/tasks/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

// Gera tarefas por IA e já retorna a lista persistida pela API.
export async function generateTasks(
  goal: string,
  options: AiGenerationOptions = {},
): Promise<Task[]> {
  const response = await request<GenerateTasksResponse>('/tasks/ai-generate', {
    method: 'POST',
    signal: options.signal,
    body: JSON.stringify(buildAiGenerationPayload(goal, options.apiKey)),
  });

  return response.tasks;
}

// Gera um rascunho editável de IA sem persistir tarefas.
export function previewTasks(
  goal: string,
  options: AiGenerationOptions = {},
): Promise<AiDraftPlan> {
  return request<AiDraftPlan>('/tasks/ai-preview', {
    method: 'POST',
    signal: options.signal,
    body: JSON.stringify(buildAiGenerationPayload(goal, options.apiKey)),
  });
}

// Persiste um plano de IA revisado pelo usuário.
export async function confirmGeneratedTasks(
  plan: AiDraftPlan,
): Promise<Task[]> {
  const response = await request<GenerateTasksResponse>('/tasks/ai-confirm', {
    method: 'POST',
    body: JSON.stringify(plan),
  });

  return response.tasks;
}
