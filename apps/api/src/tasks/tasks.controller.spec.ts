import { HttpStatus } from '@nestjs/common';
import { startTestApp } from '../test-utils/app-test-harness';

jest.setTimeout(60000);

type TaskResponse = {
  createdAt: string;
  id: string;
  isAiGenerated: boolean;
  isCompleted: boolean;
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
      isAiGenerated: false,
      isCompleted: false,
      title: 'Write focused tests',
    });
    expect(createdTask.id).toMatchUuid();

    await expect(readJson<TaskResponse[]>(`${baseUrl}/tasks`)).resolves.toEqual(
      [createdTask],
    );

    const updateResponse = await fetch(`${baseUrl}/tasks/${createdTask.id}`, {
      body: JSON.stringify({
        isCompleted: true,
        title: '  Ship the coverage  ',
      }),
      headers: jsonHeaders(),
      method: 'PATCH',
    });
    const updatedTask = (await updateResponse.json()) as TaskResponse;

    expect(updateResponse.status).toBe(HttpStatus.OK);
    expect(updatedTask).toMatchObject({
      id: createdTask.id,
      isCompleted: true,
      title: 'Ship the coverage',
    });

    const deleteResponse = await fetch(`${baseUrl}/tasks/${createdTask.id}`, {
      method: 'DELETE',
    });

    expect(deleteResponse.status).toBe(HttpStatus.NO_CONTENT);
    await expect(readJson<TaskResponse[]>(`${baseUrl}/tasks`)).resolves.toEqual(
      [],
    );
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
      fetch(`${baseUrl}/tasks/ai-generate`, {
        body: JSON.stringify({ apiKey: '', goal: 'go' }),
        headers: jsonHeaders(),
        method: 'POST',
      }),
      HttpStatus.BAD_REQUEST,
    );
  });

  it('generates AI tasks without returning or storing the API key', async () => {
    const { baseUrl } = testApp;
    const apiKey = 'sk-secret-controller-test';

    const response = await fetch(`${baseUrl}/tasks/ai-generate`, {
      body: JSON.stringify({
        apiKey,
        goal: 'Launch a deterministic review plan',
      }),
      headers: jsonHeaders(),
      method: 'POST',
    });
    const payload = (await response.json()) as GenerateTasksResponse;

    expect(response.status).toBe(HttpStatus.CREATED);
    expect(payload.tasks).toHaveLength(6);
    expect(payload.tasks.every((task) => task.isAiGenerated)).toBe(true);
    expect(JSON.stringify(payload)).not.toContain(apiKey);

    const persistedTasks = await readJson<TaskResponse[]>(`${baseUrl}/tasks`);

    expect(persistedTasks).toHaveLength(6);
    expect(JSON.stringify(persistedTasks)).not.toContain(apiKey);
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
      body: JSON.stringify({ apiKey: 'demo-key', goal }),
      headers: jsonHeaders(),
      method: 'POST',
    }),
    status,
  );
}
