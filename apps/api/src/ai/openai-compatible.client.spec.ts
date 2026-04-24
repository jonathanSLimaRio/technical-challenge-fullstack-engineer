import {
  BadGatewayException,
  GatewayTimeoutException,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import { OpenAiCompatibleClient } from './openai-compatible.client';

describe(OpenAiCompatibleClient.name, () => {
  const originalEnv = process.env;
  let client: OpenAiCompatibleClient;

  beforeEach(() => {
    jest.restoreAllMocks();
    process.env = {
      ...originalEnv,
      LLM_BASE_URL: 'https://provider.test/v1',
      LLM_MODEL: 'test-model',
      LLM_TIMEOUT_MS: '1000',
    };
    client = new OpenAiCompatibleClient();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.env = originalEnv;
  });

  it('sends an OpenAI-compatible chat completion request', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"tasks":[]}' } }],
        }),
        { status: 200 },
      ),
    );

    await expect(
      client.createJsonCompletion({
        apiKey: 'sk-test',
        messages: [{ role: 'user', content: 'Goal: Plan a trip' }],
      }),
    ).resolves.toBe('{"tasks":[]}');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://provider.test/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer sk-test',
          'Content-Type': 'application/json',
        }),
      }),
    );
  });

  it('maps provider unauthorized responses', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'bad key' } }), {
        status: 401,
      }),
    );

    await expect(
      client.createJsonCompletion({
        apiKey: 'sk-bad',
        messages: [{ role: 'user', content: 'Goal: Plan a trip' }],
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('maps provider rate limits', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'too many requests' } }), {
        status: 429,
      }),
    );

    await expect(
      client.createJsonCompletion({
        apiKey: 'sk-test',
        messages: [{ role: 'user', content: 'Goal: Plan a trip' }],
      }),
    ).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
    });
  });

  it('maps aborted requests to a timeout error', async () => {
    const abortError = new Error('aborted');
    abortError.name = 'AbortError';
    jest.spyOn(global, 'fetch').mockRejectedValue(abortError);

    await expect(
      client.createJsonCompletion({
        apiKey: 'sk-test',
        messages: [{ role: 'user', content: 'Goal: Plan a trip' }],
      }),
    ).rejects.toBeInstanceOf(GatewayTimeoutException);
  });

  it('rejects empty provider response content', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: {} }] }), {
        status: 200,
      }),
    );

    await expect(
      client.createJsonCompletion({
        apiKey: 'sk-test',
        messages: [{ role: 'user', content: 'Goal: Plan a trip' }],
      }),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });
});
