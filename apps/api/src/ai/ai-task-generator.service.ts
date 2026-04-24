import {
  BadGatewayException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  ChatMessage,
  OpenAiCompatibleClient,
} from './openai-compatible.client';

const MAX_GENERATED_TASKS = 10;

type GenerateTasksInput = {
  apiKey: string;
  goal: string;
};

type AiTasksPayload = {
  tasks?: Array<{ title?: unknown } | string>;
};

@Injectable()
export class AiTaskGeneratorService {
  constructor(private readonly client: OpenAiCompatibleClient) {}

  async generateTasks(input: GenerateTasksInput): Promise<string[]> {
    const messages = this.buildMessages(input.goal);
    const rawContent = await this.client.createJsonCompletion({
      apiKey: input.apiKey,
      messages,
    });

    const payload = this.parsePayload(rawContent);
    const titles = this.extractTitles(payload);

    if (titles.length === 0) {
      throw new UnprocessableEntityException(
        'The AI response did not include actionable tasks.',
      );
    }

    return titles;
  }

  private buildMessages(goal: string): ChatMessage[] {
    const normalizedGoal = goal.trim().replace(/\s+/g, ' ');

    return [
      {
        role: 'system',
        content:
          'You are a precise planning assistant. Break a user goal into concrete, actionable to-do items. Return only valid JSON with the shape {"tasks":[{"title":"..."}]}. Use 4 to 8 tasks. Keep each title under 120 characters. Do not include markdown.',
      },
      {
        role: 'user',
        content: `Goal: ${normalizedGoal}`,
      },
    ];
  }

  private parsePayload(rawContent: string): AiTasksPayload {
    const normalizedContent = rawContent
      .trim()
      .replace(/^```(?:json)?/i, '')
      .replace(/```$/i, '')
      .trim();

    try {
      return JSON.parse(normalizedContent) as AiTasksPayload;
    } catch {
      const jsonMatch = normalizedContent.match(/\{[\s\S]*\}/);

      if (!jsonMatch) {
        throw new BadGatewayException(
          'The AI provider returned invalid JSON. Please try again.',
        );
      }

      try {
        return JSON.parse(jsonMatch[0]) as AiTasksPayload;
      } catch {
        throw new BadGatewayException(
          'The AI provider returned invalid JSON. Please try again.',
        );
      }
    }
  }

  private extractTitles(payload: AiTasksPayload): string[] {
    if (!Array.isArray(payload.tasks)) {
      throw new BadGatewayException(
        'The AI provider returned JSON without a tasks array.',
      );
    }

    const seen = new Set<string>();
    const titles: string[] = [];

    for (const item of payload.tasks) {
      const rawTitle = typeof item === 'string' ? item : item.title;

      if (typeof rawTitle !== 'string') {
        continue;
      }

      const title = rawTitle.trim().replace(/\s+/g, ' ');
      const key = title.toLocaleLowerCase();

      if (title && title.length <= 160 && !seen.has(key)) {
        seen.add(key);
        titles.push(title);
      }

      if (titles.length === MAX_GENERATED_TASKS) {
        break;
      }
    }

    return titles;
  }
}
