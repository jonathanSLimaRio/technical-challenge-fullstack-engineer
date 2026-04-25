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
      messages,
    });

    const payload = this.parsePayload(rawContent);
    const titles = this.extractTitles(payload);

    if (titles.length === 0) {
      throw new UnprocessableEntityException(
        'A resposta da IA não incluiu tarefas acionáveis.',
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
          'Você é um assistente de planejamento preciso. Divida o objetivo do usuário em tarefas concretas e acionáveis. Retorne apenas JSON válido no formato {"tasks":[{"title":"..."}]}. Use de 4 a 8 tarefas. Mantenha cada título com menos de 120 caracteres. Não inclua markdown.',
      },
      {
        role: 'user',
        content: `Objetivo: ${normalizedGoal}`,
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
          'O provedor de IA retornou JSON inválido. Tente novamente.',
        );
      }

      try {
        return JSON.parse(jsonMatch[0]) as AiTasksPayload;
      } catch {
        this.logInvalidResponse('invalid_json');
        throw new BadGatewayException(
          'O provedor de IA retornou JSON inválido. Tente novamente.',
        );
      }
    }
  }

  private extractTitles(payload: AiTasksPayload): string[] {
    if (!Array.isArray(payload.tasks)) {
      this.logInvalidResponse('missing_tasks_array');
      throw new BadGatewayException(
        'O provedor de IA retornou JSON sem um array de tarefas.',
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
    const subject =
      goal.trim().replace(/\s+/g, ' ').slice(0, 80) || 'o objetivo';
    return [
      `Esclarecer o resultado desejado para ${subject}`,
      'Listar os menores próximos passos acionáveis',
      'Identificar dependências, bloqueios e entradas necessárias',
      'Priorizar as tarefas por impacto e urgência',
      'Agendar o primeiro bloco de execução focada',
      'Revisar o progresso e ajustar o plano',
    ];
  }

  private logInvalidResponse(reason: string): void {
    this.logger.warn(JSON.stringify({ event: 'llm_invalid_response', reason }));
  }
}
