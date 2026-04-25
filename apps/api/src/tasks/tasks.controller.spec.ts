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
  position: number;
  title: string;
  updatedAt: string;
};

type GenerateTasksResponse = {
  tasks: TaskResponse[];
};

describe('TasksController HTTP', () => {
  let testApp: Awaited<ReturnType<typeof startTestApp>>;

  beforeAll(async () => {
    testApp = await startTestApp();
  });

  afterAll(async () => {
    await testApp.close();
  });

  it('handles task CRUD through HTTP', async () => {
    const { baseUrl } = testApp;

    await expect(readJson<TaskResponse[]>(`${baseUrl}/tasks`)).resolves.toEqual(
      [],
    );

    const createResponse = await fetch(`${baseUrl}/tasks`, {
      body: JSON.stringify({ title: '  Write    focused tests  ' }),
      headers: jsonHeaders(),
      method: 'POST',
    });
    const createdTask = (await createResponse.json()) as TaskResponse;

    expect(createResponse.status).toBe(HttpStatus.CREATED);
    expect(createdTask).toMatchObject({
      description: null,
      isAiGenerated: false,
      isCompleted: false,
      label: null,
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
      fetch(`${baseUrl}/tasks/ai-generate`, {
        body: JSON.stringify({
          apiKey: 'sk-not-accepted',
          goal: 'Generate a valid plan',
        }),
        headers: jsonHeaders(),
        method: 'POST',
      }),
      HttpStatus.BAD_REQUEST,
    );
  });

  it('generates AI tasks without accepting a request API key', async () => {
    const { baseUrl } = testApp;

    const response = await fetch(`${baseUrl}/tasks/ai-generate`, {
      body: JSON.stringify({
        goal: 'Launch a deterministic review plan',
      }),
      headers: jsonHeaders(),
      method: 'POST',
    });
    const payload = (await response.json()) as GenerateTasksResponse;

    expect(response.status).toBe(HttpStatus.CREATED);
    expect(payload.tasks).toHaveLength(6);
    expect(payload.tasks.every((task) => task.isAiGenerated)).toBe(true);

    const persistedTasks = await readJson<TaskResponse[]>(`${baseUrl}/tasks`);

    expect(persistedTasks).toHaveLength(6);
  });

  it('returns service unavailable when the server API key is missing in real provider mode', async () => {
    const { baseUrl, close } = await startTestApp({
      env: {
        LLM_API_KEY: '',
        LLM_PROVIDER: 'openai-compatible',
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
