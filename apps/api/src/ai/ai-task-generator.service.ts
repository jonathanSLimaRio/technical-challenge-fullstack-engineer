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
const TASK_DESCRIPTION_MAX_LENGTH = 1000;
const TASK_LABEL_MAX_LENGTH = 40;
const TASK_TITLE_MAX_LENGTH = 160;

type GeneratedTask = {
  description: string | null;
  label: string | null;
  title: string;
};

type GeneratedPlan = {
  story: GeneratedTask;
  subtasks: GeneratedTask[];
};

type GenerateTasksInput = {
  goal: string;
};

type AiTaskShape =
  | {
      description?: unknown;
      label?: unknown;
      title?: unknown;
    }
  | string;

type AiTasksPayload = {
  story?: AiTaskShape;
  subtasks?: AiTaskShape[];
  tasks?: AiTaskShape[];
};

@Injectable()
export class AiTaskGeneratorService {
  private readonly logger = new Logger(AiTaskGeneratorService.name);

  constructor(private readonly client: OpenAiCompatibleClient) {}

  async generateTasks(input: GenerateTasksInput): Promise<GeneratedPlan> {
    if (
      (process.env.LLM_PROVIDER ?? 'openai-compatible').toLowerCase() === 'mock'
    ) {
      this.logger.log(
        JSON.stringify({
          event: 'llm_mock_provider_used',
          goalLength: input.goal.trim().length,
        }),
      );
      return this.generateMockPlan(input.goal);
    }

    const messages = this.buildMessages(input.goal);
    const rawContent = await this.client.createJsonCompletion({
      messages,
    });

    const payload = this.parsePayload(rawContent);
    const plan = this.extractPlan(payload, input.goal);

    if (plan.subtasks.length === 0) {
      throw new UnprocessableEntityException(
        'A resposta da IA nao incluiu subtarefas acionaveis.',
      );
    }

    return plan;
  }

  private buildMessages(goal: string): ChatMessage[] {
    const normalizedGoal = goal.trim().replace(/\s+/g, ' ');

    return [
      {
        role: 'system',
        content:
          'Voce e um assistente de planejamento preciso. Transforme o objetivo do usuario em uma historia mae e subtarefas concretas e acionaveis. Retorne apenas JSON valido no formato {"story":{"title":"...","description":"...","label":"..."},"subtasks":[{"title":"...","description":"...","label":"..."}]}. Use de 4 a 8 subtarefas. Mantenha cada title com ate 160 caracteres, cada description com ate 1000 caracteres e cada label com ate 40 caracteres. Nao inclua markdown.',
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
          'O provedor de IA retornou JSON invalido. Tente novamente.',
        );
      }

      try {
        return JSON.parse(jsonMatch[0]) as AiTasksPayload;
      } catch {
        this.logInvalidResponse('invalid_json');
        throw new BadGatewayException(
          'O provedor de IA retornou JSON invalido. Tente novamente.',
        );
      }
    }
  }

  private extractPlan(payload: AiTasksPayload, goal: string): GeneratedPlan {
    const rawSubtasks = Array.isArray(payload.subtasks)
      ? payload.subtasks
      : payload.tasks;

    if (!Array.isArray(rawSubtasks)) {
      this.logInvalidResponse('missing_subtasks_array');
      throw new BadGatewayException(
        'O provedor de IA retornou JSON sem um array de subtarefas.',
      );
    }

    return {
      story: this.extractStory(payload.story, goal),
      subtasks: this.extractTasks(rawSubtasks),
    };
  }

  private extractStory(story: AiTaskShape | undefined, goal: string): GeneratedTask {
    const fallbackTitle =
      this.normalizeTitle(goal).slice(0, TASK_TITLE_MAX_LENGTH) || 'Novo plano';

    if (story === undefined) {
      return {
        description: 'Plano gerado a partir do objetivo informado.',
        label: 'Plano',
        title: fallbackTitle,
      };
    }

    if (typeof story === 'string') {
      const title = this.normalizeTitle(story);

      return {
        description: 'Plano gerado a partir do objetivo informado.',
        label: 'Plano',
        title: title || fallbackTitle,
      };
    }

    const title =
      typeof story.title === 'string'
        ? this.normalizeTitle(story.title).slice(0, TASK_TITLE_MAX_LENGTH)
        : fallbackTitle;

    return {
      description: this.normalizeDescription(story.description),
      label: this.normalizeLabel(story.label) ?? 'Plano',
      title: title || fallbackTitle,
    };
  }

  private extractTasks(rawTasks: AiTaskShape[]): GeneratedTask[] {
    const seen = new Set<string>();
    const tasks: GeneratedTask[] = [];

    for (const item of rawTasks) {
      const rawTitle = typeof item === 'string' ? item : item.title;

      if (typeof rawTitle !== 'string') {
        continue;
      }

      const title = this.normalizeTitle(rawTitle);
      const key = title.toLocaleLowerCase();

      if (title && title.length <= TASK_TITLE_MAX_LENGTH && !seen.has(key)) {
        seen.add(key);
        tasks.push({
          description:
            typeof item === 'string'
              ? null
              : this.normalizeDescription(item.description),
          label:
            typeof item === 'string' ? null : this.normalizeLabel(item.label),
          title,
        });
      }

      if (tasks.length === MAX_GENERATED_TASKS) {
        break;
      }
    }

    return tasks;
  }

  private generateMockPlan(goal: string): GeneratedPlan {
    const subject =
      goal.trim().replace(/\s+/g, ' ').slice(0, 80) || 'o objetivo';

    return {
      story: {
        description:
          'Plano gerado para organizar o objetivo em uma historia central e proximos passos claros.',
        label: 'Plano',
        title: subject,
      },
      subtasks: [
        {
          title: `Esclarecer o resultado desejado para ${subject}`,
          description:
            'Definir o resultado esperado, os criterios de pronto e o que ficara fora deste plano.',
          label: 'Planejamento',
        },
        {
          title: 'Listar os menores proximos passos acionaveis',
          description:
            'Transformar o objetivo em acoes pequenas o suficiente para iniciar sem nova decisao.',
          label: 'Escopo',
        },
        {
          title: 'Identificar dependencias, bloqueios e entradas necessarias',
          description:
            'Mapear recursos, informacoes, acessos e riscos que podem travar a execucao.',
          label: 'Dependencias',
        },
        {
          title: 'Priorizar as tarefas por impacto e urgencia',
          description:
            'Ordenar o trabalho para atacar primeiro o que reduz maior risco ou libera mais progresso.',
          label: 'Prioridade',
        },
        {
          title: 'Agendar o primeiro bloco de execucao focada',
          description:
            'Reservar um intervalo concreto para iniciar a primeira tarefa e registrar o proximo marco.',
          label: 'Execucao',
        },
        {
          title: 'Revisar o progresso e ajustar o plano',
          description:
            'Comparar o andamento com o resultado desejado e atualizar tarefas, ordem e bloqueios.',
          label: 'Revisao',
        },
      ],
    };
  }

  private normalizeTitle(title: string): string {
    return title.trim().replace(/\s+/g, ' ');
  }

  private normalizeDescription(description: unknown): string | null {
    if (typeof description !== 'string') {
      return null;
    }

    const normalizedDescription = description.trim();
    return normalizedDescription
      ? normalizedDescription.slice(0, TASK_DESCRIPTION_MAX_LENGTH).trim() ||
          null
      : null;
  }

  private normalizeLabel(label: unknown): string | null {
    if (typeof label !== 'string') {
      return null;
    }

    const normalizedLabel = label.trim().replace(/\s+/g, ' ');
    return normalizedLabel
      ? normalizedLabel.slice(0, TASK_LABEL_MAX_LENGTH).trim() || null
      : null;
  }

  private logInvalidResponse(reason: string): void {
    this.logger.warn(JSON.stringify({ event: 'llm_invalid_response', reason }));
  }
}
