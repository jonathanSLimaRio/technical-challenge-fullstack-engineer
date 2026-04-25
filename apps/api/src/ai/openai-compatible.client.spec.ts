import {
  BadGatewayException,
  GatewayTimeoutException,
  HttpStatus,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { OpenAiCompatibleClient } from './openai-compatible.client';

describe(OpenAiCompatibleClient.name, () => {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.LLM_API_KEY;
  const originalBaseUrl = process.env.LLM_BASE_URL;
  const originalModel = process.env.LLM_MODEL;
  const originalTimeout = process.env.LLM_TIMEOUT_MS;
  let client: OpenAiCompatibleClient;

  beforeEach(() => {
    process.env.LLM_API_KEY = 'sk-server-test';
    process.env.LLM_BASE_URL = 'https://provider.test/v1';
    process.env.LLM_MODEL = 'test-model';
    process.env.LLM_TIMEOUT_MS = '1000';
    client = new OpenAiCompatibleClient();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    restoreEnv('LLM_API_KEY', originalApiKey);
    restoreEnv('LLM_BASE_URL', originalBaseUrl);
    restoreEnv('LLM_MODEL', originalModel);
    restoreEnv('LLM_TIMEOUT_MS', originalTimeout);
    jest.restoreAllMocks();
  });

  it('sends an OpenAI-compatible chat completion request', async () => {
    const fetchMock = global.fetch as jest.Mock;
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"tasks":[]}' } }],
        }),
        { status: HttpStatus.OK },
      ),
    );

    await expect(
      client.createJsonCompletion({
        messages: [{ role: 'user', content: 'Goal: Plan a trip' }],
      }),
    ).resolves.toBe('{"tasks":[]}');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://provider.test/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer sk-server-test',
          'Content-Type': 'application/json',
        }),
        body: expect.stringContaining('"model":"test-model"'),
      }),
    );
  });

  it('maps provider unauthorized responses without retrying', async () => {
    const fetchMock = global.fetch as jest.Mock;
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'bad key' } }), {
        status: HttpStatus.UNAUTHORIZED,
      }),
    );

    await expect(
      client.createJsonCompletion({
        messages: [{ role: 'user', content: 'Goal: Plan a trip' }],
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('maps provider rate limits and retries once', async () => {
    const fetchMock = global.fetch as jest.Mock;
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'too many requests' } }), {
        status: HttpStatus.TOO_MANY_REQUESTS,
      }),
    );

    await expect(
      client.createJsonCompletion({
        messages: [{ role: 'user', content: 'Goal: Plan a trip' }],
      }),
    ).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('maps aborted requests to a timeout error after retrying once', async () => {
    const abortError = new Error('aborted');
    abortError.name = 'AbortError';
    const fetchMock = global.fetch as jest.Mock;
    fetchMock.mockRejectedValue(abortError);

    await expect(
      client.createJsonCompletion({
        messages: [{ role: 'user', content: 'Goal: Plan a trip' }],
      }),
    ).rejects.toBeInstanceOf(GatewayTimeoutException);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries a transient provider status once', async () => {
    const fetchMock = global.fetch as jest.Mock;
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'try later' } }), {
          status: HttpStatus.SERVICE_UNAVAILABLE,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: '{"tasks":[]}' } }],
          }),
          { status: HttpStatus.OK },
        ),
      );

    await expect(
      client.createJsonCompletion({
        messages: [{ role: 'user', content: 'Goal: test' }],
      }),
    ).resolves.toBe('{"tasks":[]}');

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry invalid provider payloads', async () => {
    const fetchMock = global.fetch as jest.Mock;
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ choices: [] }), { status: HttpStatus.OK }),
    );

    await expect(
      client.createJsonCompletion({
        messages: [{ role: 'user', content: 'Goal: test' }],
      }),
    ).rejects.toThrow('resposta vazia');

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects empty provider response content', async () => {
    const fetchMock = global.fetch as jest.Mock;
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: {} }] }), {
        status: HttpStatus.OK,
      }),
    );

    await expect(
      client.createJsonCompletion({
        messages: [{ role: 'user', content: 'Goal: Plan a trip' }],
      }),
    ).rejects.toBeInstanceOf(BadGatewayException);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects real provider usage when the server API key is missing', async () => {
    delete process.env.LLM_API_KEY;

    await expect(
      client.createJsonCompletion({
        messages: [{ role: 'user', content: 'Goal: Plan a trip' }],
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
