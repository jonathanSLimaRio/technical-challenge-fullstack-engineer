import {
  BadGatewayException,
  GatewayTimeoutException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';

export type ChatMessage = {
  role: 'system' | 'user';
  content: string;
};

type CompletionInput = {
  messages: ChatMessage[];
};

type ProviderChoice = {
  message?: {
    content?: unknown;
  };
};

type ProviderResponse = {
  choices?: ProviderChoice[];
};

const TRANSIENT_PROVIDER_STATUSES = new Set<number>([
  HttpStatus.TOO_MANY_REQUESTS,
  HttpStatus.BAD_GATEWAY,
  HttpStatus.SERVICE_UNAVAILABLE,
  HttpStatus.GATEWAY_TIMEOUT,
]);

@Injectable()
export class OpenAiCompatibleClient {
  private readonly logger = new Logger(OpenAiCompatibleClient.name);

  async createJsonCompletion(input: CompletionInput): Promise<string> {
    const maxAttempts = 2;
    const apiKey = this.providerApiKey();
    let lastError: HttpException | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await this.createJsonCompletionOnce(input, apiKey);
      } catch (error) {
        const exception = this.toHttpException(error);
        lastError = exception;

        this.logProviderFailure(error, exception, attempt);

        if (
          attempt < maxAttempts &&
          this.shouldRetry(error, exception)
        ) {
          continue;
        }

        throw exception;
      }
    }

    throw (
      lastError ??
      new BadGatewayException(
        'Não foi possível acessar o provedor de IA. Tente novamente.',
      )
    );
  }

  private async createJsonCompletionOnce(
    input: CompletionInput,
    apiKey: string,
  ): Promise<string> {
    const timeoutMs = Number(process.env.LLM_TIMEOUT_MS ?? 20000);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(this.completionsUrl(), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'http://localhost:3000',
          'X-Title': 'Smart To-Do List Technical Challenge',
        },
        body: JSON.stringify({
          model: process.env.LLM_MODEL ?? 'openai/gpt-4o-mini',
          temperature: 0.2,
          response_format: { type: 'json_object' },
          messages: input.messages,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw await this.providerError(response);
      }

      const payload = (await response.json()) as ProviderResponse;
      const content = payload.choices?.[0]?.message?.content;

      if (typeof content !== 'string' || !content.trim()) {
        throw new BadGatewayException(
          'O provedor de IA retornou uma resposta vazia.',
        );
      }

      return content;
    } finally {
      clearTimeout(timeout);
    }
  }

  private completionsUrl(): string {
    const baseUrl = process.env.LLM_BASE_URL ?? 'https://api.openai.com/v1';
    return `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
  }

  private providerApiKey(): string {
    const apiKey = process.env.LLM_API_KEY?.trim();

    if (!apiKey) {
      throw new ServiceUnavailableException(
        'A chave da API de IA nao foi configurada no servidor.',
      );
    }

    return apiKey;
  }

  private async providerError(response: Response): Promise<HttpException> {
    const message = await this.readProviderMessage(response);

    if (response.status === HttpStatus.UNAUTHORIZED || response.status === 403) {
      return new UnauthorizedException(
        message ?? 'O provedor de IA rejeitou a chave da API.',
      );
    }

    if (response.status === HttpStatus.TOO_MANY_REQUESTS) {
      return new HttpException(
        message ?? 'O limite de taxa do provedor de IA foi excedido.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    if (TRANSIENT_PROVIDER_STATUSES.has(response.status)) {
      return new HttpException(
        message ?? `O provedor de IA retornou HTTP ${response.status}.`,
        response.status,
      );
    }

    return new BadGatewayException(
      message ?? `O provedor de IA retornou HTTP ${response.status}.`,
    );
  }

  private async readProviderMessage(
    response: Response,
  ): Promise<string | undefined> {
    try {
      const payload = (await response.json()) as {
        error?: { message?: unknown };
        message?: unknown;
      };
      const message = payload.error?.message ?? payload.message;
      return typeof message === 'string' && message.trim()
        ? message
        : undefined;
    } catch {
      return undefined;
    }
  }

  private isAbortError(error: unknown): boolean {
    return (
      error instanceof Error &&
      (error.name === 'AbortError' || error.message.includes('aborted'))
    );
  }

  private toHttpException(error: unknown): HttpException {
    if (this.isAbortError(error)) {
      return new GatewayTimeoutException(
        'O provedor de IA demorou demais para responder.',
      );
    }

    if (error instanceof HttpException) {
      return error;
    }

    return new BadGatewayException(
      'Não foi possível acessar o provedor de IA. Tente novamente.',
    );
  }

  private shouldRetry(error: unknown, exception: HttpException): boolean {
    if (this.isAbortError(error)) {
      return true;
    }

    if (!(error instanceof HttpException)) {
      return true;
    }

    return (
      error.constructor === HttpException &&
      TRANSIENT_PROVIDER_STATUSES.has(exception.getStatus())
    );
  }

  private logProviderFailure(
    error: unknown,
    exception: HttpException,
    attempt: number,
  ): void {
    const status = exception.getStatus();
    const event = this.isAbortError(error)
      ? 'llm_provider_timeout'
      : 'llm_provider_failure';

    this.logger.warn(
      JSON.stringify({
        event,
        attempt,
        retryable: this.shouldRetry(error, exception),
        status,
      }),
    );
  }
}
