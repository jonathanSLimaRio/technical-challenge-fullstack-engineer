import {
  BadGatewayException,
  Injectable,
  Logger,
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
  private readonly logger = new Logger(AiTaskGeneratorService.name);

  constructor(private readonly client: OpenAiCompatibleClient) {}

  async generateTasks(input: GenerateTasksInput): Promise<string[]> {
    if (
      (process.env.LLM_PROVIDER ?? 'openai-compatible').toLowerCase() === 'mock'
    ) {
      this.logger.log(
        JSON.stringify({
          event: 'llm_mock_provider_used',
          goalLength: input.goal.trim().length,
        }),
      );
      return this.generateMockTasks(input.goal);
    }

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
        this.logInvalidResponse('invalid_json');
        throw new BadGatewayException(
          'The AI provider returned invalid JSON. Please try again.',
        );
      }

      try {
        return JSON.parse(jsonMatch[0]) as AiTasksPayload;
      } catch {
        this.logInvalidResponse('invalid_json');
        throw new BadGatewayException(
          'The AI provider returned invalid JSON. Please try again.',
        );
      }
    }
  }

  private extractTitles(payload: AiTasksPayload): string[] {
    if (!Array.isArray(payload.tasks)) {
      this.logInvalidResponse('missing_tasks_array');
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

  private generateMockTasks(goal: string): string[] {
    const subject = goal.trim().replace(/\s+/g, ' ').slice(0, 80) || 'the goal';
    return [
      `Clarify the desired outcome for ${subject}`,
      'List the smallest actionable next steps',
      'Identify dependencies, blockers and required inputs',
      'Prioritize the tasks by impact and urgency',
      'Schedule the first focused execution block',
      'Review progress and adjust the plan',
    ];
  }

  private logInvalidResponse(reason: string): void {
    this.logger.warn(JSON.stringify({ event: 'llm_invalid_response', reason }));
  }
}
