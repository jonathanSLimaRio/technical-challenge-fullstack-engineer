import type { GenerateTasksResponse, Task, TaskStatus } from '../types/task';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

type ApiErrorPayload = {
  message?: string | string[];
  error?: string;
};

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

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

export function fetchTasks(): Promise<Task[]> {
  return request<Task[]>('/tasks');
}

export function getApiOrigin(): string {
  try {
    return new URL(API_URL).origin;
  } catch {
    return API_URL;
  }
}

type CreateTaskPayload = {
  description?: string;
  label?: string;
  title: string;
};

export function createTask(payload: CreateTaskPayload | string): Promise<Task> {
  const body = typeof payload === 'string' ? { title: payload } : payload;

  return request<Task>('/tasks', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

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

export function deleteTask(id: string): Promise<void> {
  return request<void>(`/tasks/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export async function generateTasks(goal: string): Promise<Task[]> {
  const response = await request<GenerateTasksResponse>('/tasks/ai-generate', {
    method: 'POST',
    body: JSON.stringify({ goal }),
  });

  return response.tasks;
}
