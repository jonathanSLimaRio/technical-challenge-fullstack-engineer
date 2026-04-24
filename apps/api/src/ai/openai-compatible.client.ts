import {
  BadGatewayException,
  GatewayTimeoutException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

export type ChatMessage = {
  role: 'system' | 'user';
  content: string;
};

type CompletionInput = {
  apiKey: string;
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

@Injectable()
export class OpenAiCompatibleClient {
  async createJsonCompletion(input: CompletionInput): Promise<string> {
    const timeoutMs = Number(process.env.LLM_TIMEOUT_MS ?? 20000);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(this.completionsUrl(), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${input.apiKey}`,
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
          'The AI provider returned an empty response.',
        );
      }

      return content;
    } catch (error) {
      if (this.isAbortError(error)) {
        throw new GatewayTimeoutException(
          'The AI provider took too long to respond.',
        );
      }

      if (error instanceof HttpException) {
        throw error;
      }

      throw new BadGatewayException(
        'Could not reach the AI provider. Please try again.',
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private completionsUrl(): string {
    const baseUrl = process.env.LLM_BASE_URL ?? 'https://openrouter.ai/api/v1';
    return `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
  }

  private async providerError(response: Response): Promise<HttpException> {
    const message = await this.readProviderMessage(response);

    if (response.status === HttpStatus.UNAUTHORIZED || response.status === 403) {
      return new UnauthorizedException(
        message ?? 'The AI provider rejected the API key.',
      );
    }

    if (response.status === HttpStatus.TOO_MANY_REQUESTS) {
      return new HttpException(
        message ?? 'The AI provider rate limit was exceeded.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return new BadGatewayException(
      message ?? `The AI provider returned HTTP ${response.status}.`,
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
}
