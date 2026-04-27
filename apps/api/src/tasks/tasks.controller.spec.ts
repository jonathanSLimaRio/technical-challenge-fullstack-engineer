import { HttpStatus } from '@nestjs/common';
import { startTestApp } from '../test-utils/app-test-harness';

jest.setTimeout(60000);

type TaskResponse = {
  createdAt: string;
  description: string | null;
  id: string;
  isAiGenerated: boolean;
  isCompleted: boolean;
  label: string | null;
  parentId: string | null;
  position: number;
  rootId: string | null;
  status: string;
  title: string;
  updatedAt: string;
};

type GenerateTasksResponse = {
  tasks: TaskResponse[];
};

type AiDraftPlanResponse = {
  story: {
    description: string | null;
    label: string | null;
    title: string;
  };
  subtasks: Array<{
    description: string | null;
    label: string | null;
    title: string;
  }>;
};

describe('TasksController HTTP', () => {
  let testApp!: Awaited<ReturnType<typeof startTestApp>>;

  beforeAll(async () => {
    testApp = await startTestApp();
  });

  afterAll(async () => {
    await testApp?.close();
  });

  it('handles task CRUD through HTTP', async () => {
    const { baseUrl } = testApp;

    await expect(readJson<TaskResponse[]>(`${baseUrl}/tasks`)).resolves.toEqual(
      [],
    );

    const createResponse = await fetch(`${baseUrl}/tasks`, {
      body: JSON.stringify({
        description: '  Cover the happy path  ',
        label: '  QA   Review ',
        title: '  Write    focused tests  ',
      }),
      headers: jsonHeaders(),
      method: 'POST',
    });
    const createdTask = (await createResponse.json()) as TaskResponse;

    expect(createResponse.status).toBe(HttpStatus.CREATED);
    expect(createdTask).toMatchObject({
      description: 'Cover the happy path',
      isAiGenerated: false,
      isCompleted: false,
      label: 'QA Review',
      parentId: null,
      rootId: null,
      status: 'todo',
      title: 'Write focused tests',
    });
    expect(createdTask.position).toEqual(expect.any(Number));
    expect(createdTask.id).toMatchUuid();

    await expect(readJson<TaskResponse[]>(`${baseUrl}/tasks`)).resolves.toEqual(
      [createdTask],
    );

    const updateResponse = await fetch(`${baseUrl}/tasks/${createdTask.id}`, {
      body: JSON.stringify({
        description: '  Add regression checks before merging  ',
        isCompleted: true,
        label: '  QA   Review ',
        title: '  Ship the coverage  ',
      }),
      headers: jsonHeaders(),
      method: 'PATCH',
    });
    const updatedTask = (await updateResponse.json()) as TaskResponse;

    expect(updateResponse.status).toBe(HttpStatus.OK);
    expect(updatedTask).toMatchObject({
      id: createdTask.id,
      description: 'Add regression checks before merging',
      isCompleted: true,
      label: 'QA Review',
      status: 'done',
      title: 'Ship the coverage',
    });

    const secondCreateResponse = await fetch(`${baseUrl}/tasks`, {
      body: JSON.stringify({ title: 'Review task order' }),
      headers: jsonHeaders(),
      method: 'POST',
    });
    const secondTask = (await secondCreateResponse.json()) as TaskResponse;

    const reorderResponse = await fetch(`${baseUrl}/tasks/reorder`, {
      body: JSON.stringify({
        orderedIds: [updatedTask.id, secondTask.id],
      }),
      headers: jsonHeaders(),
      method: 'PATCH',
    });
    const reorderedTasks = (await reorderResponse.json()) as TaskResponse[];

    expect(reorderResponse.status).toBe(HttpStatus.OK);
    expect(reorderedTasks.map((task) => task.id)).toEqual([
      updatedTask.id,
      secondTask.id,
    ]);
    expect(reorderedTasks.map((task) => task.position)).toEqual([0, 1]);

    const moveResponse = await fetch(`${baseUrl}/tasks/${secondTask.id}/move`, {
      body: JSON.stringify({
        orderedIds: [secondTask.id, updatedTask.id],
        status: 'doing',
      }),
      headers: jsonHeaders(),
      method: 'PATCH',
    });
    const movedTasks = (await moveResponse.json()) as TaskResponse[];

    expect(moveResponse.status).toBe(HttpStatus.OK);
    expect(movedTasks.map((task) => task.id)).toEqual([
      secondTask.id,
      updatedTask.id,
    ]);
    expect(movedTasks[0]).toMatchObject({
      id: secondTask.id,
      isCompleted: false,
      position: 0,
      status: 'doing',
    });

    const deleteResponse = await fetch(`${baseUrl}/tasks/${createdTask.id}`, {
      method: 'DELETE',
    });

    expect(deleteResponse.status).toBe(HttpStatus.NO_CONTENT);
    const secondDeleteResponse = await fetch(`${baseUrl}/tasks/${secondTask.id}`, {
      method: 'DELETE',
    });

    expect(secondDeleteResponse.status).toBe(HttpStatus.NO_CONTENT);
    await expect(readJson<TaskResponse[]>(`${baseUrl}/tasks`)).resolves.toEqual([]);
  });

  it('validates DTO payloads and route params', async () => {
    const { baseUrl } = testApp;

    await expectStatus(
      fetch(`${baseUrl}/tasks`, {
        body: JSON.stringify({ title: '', unexpected: true }),
        headers: jsonHeaders(),
        method: 'POST',
      }),
      HttpStatus.BAD_REQUEST,
    );
    await expectStatus(
      fetch(`${baseUrl}/tasks/not-a-uuid`, {
        body: JSON.stringify({ isCompleted: true }),
        headers: jsonHeaders(),
        method: 'PATCH',
      }),
      HttpStatus.BAD_REQUEST,
    );
    await expectStatus(
      fetch(`${baseUrl}/tasks/8cc9aa74-476d-459e-aab0-462fbe32efea`, {
        body: JSON.stringify({ isCompleted: 'yes' }),
        headers: jsonHeaders(),
        method: 'PATCH',
      }),
      HttpStatus.BAD_REQUEST,
    );
    await expectStatus(
      fetch(`${baseUrl}/tasks/reorder`, {
        body: JSON.stringify({ orderedIds: ['not-a-uuid'] }),
        headers: jsonHeaders(),
        method: 'PATCH',
      }),
      HttpStatus.BAD_REQUEST,
    );
    await expectStatus(
      fetch(`${baseUrl}/tasks/8cc9aa74-476d-459e-aab0-462fbe32efea/move`, {
        body: JSON.stringify({
          orderedIds: ['8cc9aa74-476d-459e-aab0-462fbe32efea'],
          status: 'invalid',
        }),
        headers: jsonHeaders(),
        method: 'PATCH',
      }),
      HttpStatus.BAD_REQUEST,
    );
    await expectStatus(
      fetch(`${baseUrl}/tasks/ai-generate`, {
        body: JSON.stringify({
          apiKey: ['sk-not-valid'],
          goal: 'Generate a valid plan',
        }),
        headers: jsonHeaders(),
        method: 'POST',
      }),
      HttpStatus.BAD_REQUEST,
    );
    await expectStatus(
      fetch(`${baseUrl}/tasks/ai-preview`, {
        body: JSON.stringify({
          apiKey: { value: 'sk-not-valid' },
          goal: 'Generate a valid plan',
        }),
        headers: jsonHeaders(),
        method: 'POST',
      }),
      HttpStatus.BAD_REQUEST,
    );
    await expectStatus(
      fetch(`${baseUrl}/tasks/ai-confirm`, {
        body: JSON.stringify({
          story: { description: null, label: null, title: '' },
          subtasks: [{ description: null, label: null, title: 'Valid step' }],
        }),
        headers: jsonHeaders(),
        method: 'POST',
      }),
      HttpStatus.BAD_REQUEST,
    );
    await expectStatus(
      fetch(`${baseUrl}/tasks/ai-confirm`, {
        body: JSON.stringify({
          story: { description: null, label: null, title: 'Valid story' },
          subtasks: [],
        }),
        headers: jsonHeaders(),
        method: 'POST',
      }),
      HttpStatus.BAD_REQUEST,
    );
    await expectStatus(
      fetch(`${baseUrl}/tasks/ai-confirm`, {
        body: JSON.stringify({
          story: { description: null, label: null, title: 'Valid story' },
          subtasks: Array.from({ length: 11 }, (_value, index) => ({
            description: null,
            label: null,
            title: `Step ${index}`,
          })),
        }),
        headers: jsonHeaders(),
        method: 'POST',
      }),
      HttpStatus.BAD_REQUEST,
    );
  });

  it('previews AI tasks without persisting them', async () => {
    const { baseUrl } = testApp;
    const existingTasks = await readJson<TaskResponse[]>(`${baseUrl}/tasks`);

    const response = await fetch(`${baseUrl}/tasks/ai-preview`, {
      body: JSON.stringify({
        goal: 'Draft a deterministic review plan',
      }),
      headers: jsonHeaders(),
      method: 'POST',
    });
    const payload = (await response.json()) as AiDraftPlanResponse;

    expect(response.status).toBe(HttpStatus.CREATED);
    expect(payload.story).toMatchObject({
      description:
        'Plano gerado para organizar o objetivo em uma historia central e proximos passos claros.',
      label: 'Plano',
      title: 'Draft a deterministic review plan',
    });
    expect(payload.subtasks).toHaveLength(6);
    expect(payload.subtasks[0]).toMatchObject({
      description:
        'Definir o resultado esperado, os criterios de pronto e o que ficara fora deste plano.',
      label: 'Planejamento',
      title:
        'Esclarecer o resultado desejado para Draft a deterministic review plan',
    });

    await expect(readJson<TaskResponse[]>(`${baseUrl}/tasks`)).resolves.toHaveLength(
      existingTasks.length,
    );
  });

  it('generates AI tasks while accepting an optional request API key', async () => {
    const { baseUrl } = testApp;

    const response = await fetch(`${baseUrl}/tasks/ai-generate`, {
      body: JSON.stringify({
        apiKey: 'hf-request-key',
        goal: 'Launch a deterministic review plan',
      }),
      headers: jsonHeaders(),
      method: 'POST',
    });
    const payload = (await response.json()) as GenerateTasksResponse;

    expect(response.status).toBe(HttpStatus.CREATED);
    expect(payload.tasks).toHaveLength(7);
    expect(payload.tasks.every((task) => task.isAiGenerated)).toBe(true);
    expect(
      payload.tasks.every((task) => task.description && task.label),
    ).toBe(true);
    expect(payload.tasks[0]).toMatchObject({
      description:
        'Plano gerado para organizar o objetivo em uma historia central e proximos passos claros.',
      label: 'Plano',
      parentId: null,
      title: 'Launch a deterministic review plan',
    });
    expect(payload.tasks[0].rootId).toBe(payload.tasks[0].id);
    expect(payload.tasks[1]).toMatchObject({
      description:
        'Definir o resultado esperado, os criterios de pronto e o que ficara fora deste plano.',
      label: 'Planejamento',
      parentId: payload.tasks[0].id,
      rootId: payload.tasks[0].id,
      title:
        'Esclarecer o resultado desejado para Launch a deterministic review plan',
    });

    const persistedTasks = await readJson<TaskResponse[]>(`${baseUrl}/tasks`);

    expect(persistedTasks).toHaveLength(7);
    expect(
      persistedTasks.every((task) => task.isAiGenerated && task.description && task.label),
    ).toBe(true);
  });

  it('confirms an edited AI draft and persists generated tasks', async () => {
    const { baseUrl } = testApp;

    const response = await fetch(`${baseUrl}/tasks/ai-confirm`, {
      body: JSON.stringify({
        story: {
          description: '  Edited story description  ',
          label: '  Edited   label ',
          title: '  Edited   story ',
        },
        subtasks: [
          {
            description: '  Edited subtask description  ',
            label: '  Delivery ',
            title: '  Edited   subtask ',
          },
        ],
      }),
      headers: jsonHeaders(),
      method: 'POST',
    });
    const payload = (await response.json()) as GenerateTasksResponse;

    expect(response.status).toBe(HttpStatus.CREATED);
    expect(payload.tasks).toHaveLength(2);
    expect(payload.tasks.every((task) => task.isAiGenerated)).toBe(true);
    expect(payload.tasks[0]).toMatchObject({
      description: 'Edited story description',
      label: 'Edited label',
      parentId: null,
      title: 'Edited story',
    });
    expect(payload.tasks[1]).toMatchObject({
      description: 'Edited subtask description',
      label: 'Delivery',
      parentId: payload.tasks[0].id,
      rootId: payload.tasks[0].id,
      title: 'Edited subtask',
    });

    const persistedTasks = await readJson<TaskResponse[]>(`${baseUrl}/tasks`);
    expect(persistedTasks).toEqual(expect.arrayContaining(payload.tasks));
  });

  it('returns service unavailable when the server API key is missing in real provider mode', async () => {
    const { baseUrl, close } = await startTestApp({
      env: {
        LLM_API_KEY: '',
        LLM_PROVIDER: 'huggingface',
      },
    });

    try {
      await expectAiGenerateStatus(
        baseUrl,
        'Goal that needs a real provider',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    } finally {
      await close();
    }
  });

  it('uses the route-specific throttle limit for AI generation', async () => {
    const { baseUrl, close } = await startTestApp({
      env: {
        AI_THROTTLE_LIMIT: '2',
        AI_THROTTLE_TTL_MS: '60000',
        THROTTLE_LIMIT: '1000',
      },
    });

    try {
      await expectAiGenerateStatus(baseUrl, 'First throttled goal', HttpStatus.CREATED);
      await expectAiGenerateStatus(
        baseUrl,
        'Second throttled goal',
        HttpStatus.CREATED,
      );
      await expectAiGenerateStatus(
        baseUrl,
        'Third throttled goal',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    } finally {
      await close();
    }
  });
});

expect.extend({
  toMatchUuid(received: unknown) {
    const pass =
      typeof received === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        received,
      );

    return {
      message: () => `expected ${String(received)} to be a UUID`,
      pass,
    };
  },
});

declare global {
  namespace jest {
    interface Matchers<R> {
      toMatchUuid(): R;
    }
  }
}

function jsonHeaders(): HeadersInit {
  return { 'Content-Type': 'application/json' };
}

async function readJson<T>(url: string): Promise<T> {
  const response = await fetch(url);

  expect(response.status).toBe(HttpStatus.OK);

  return (await response.json()) as T;
}

async function expectStatus(
  responsePromise: Promise<Response>,
  status: HttpStatus,
): Promise<void> {
  await expect(responsePromise.then((response) => response.status)).resolves.toBe(
    status,
  );
}

async function expectAiGenerateStatus(
  baseUrl: string,
  goal: string,
  status: HttpStatus,
): Promise<void> {
  await expectStatus(
    fetch(`${baseUrl}/tasks/ai-generate`, {
      body: JSON.stringify({ goal }),
      headers: jsonHeaders(),
      method: 'POST',
    }),
    status,
  );
}
