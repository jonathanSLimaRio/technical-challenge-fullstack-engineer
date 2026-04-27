import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiTaskGeneratorService } from '../ai/ai-task-generator.service';
import {
  AI_DRAFT_MAX_SUBTASKS,
  AiDraftPlanDto,
  AiDraftTaskDto,
} from './dto/ai-draft-plan.dto';
import { CreateTaskDto } from './dto/create-task.dto';
import { GenerateTasksDto } from './dto/generate-tasks.dto';
import { MoveTaskDto } from './dto/move-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { Task } from './task.entity';
import {
  DEFAULT_TASK_STATUS,
  isCompletedStatus,
  resolveTaskStatus,
  type TaskStatus,
} from './task-status';
import {
  TasksEventsGateway,
  type TaskChangeAction,
} from './tasks-events.gateway';

type NormalizedAiDraftTask = {
  description: string | null;
  label: string | null;
  title: string;
};

type NormalizedAiDraftPlan = {
  story: NormalizedAiDraftTask;
  subtasks: NormalizedAiDraftTask[];
};

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    @InjectRepository(Task)
    private readonly tasksRepository: Repository<Task>,
    private readonly aiTaskGenerator: AiTaskGeneratorService,
    private readonly tasksEventsGateway: TasksEventsGateway,
  ) {}

  async findAll(): Promise<Task[]> {
    return this.tasksRepository.find({
      order: { position: 'ASC', createdAt: 'DESC' },
    });
  }

  async create(
    dto: CreateTaskDto,
    options: { isAiGenerated?: boolean } = {},
  ): Promise<Task> {
    const [position] = await this.resolveTopPositions(1);
    const title = this.normalizeTitle(dto.title);
    const task = this.tasksRepository.create({
      title,
      description:
        dto.description === undefined
          ? null
          : this.normalizeDescription(dto.description),
      label: dto.label === undefined ? null : this.normalizeLabel(dto.label),
      parentId: null,
      rootId: null,
      position,
      status: DEFAULT_TASK_STATUS,
      isCompleted: false,
      isAiGenerated: options.isAiGenerated ?? false,
    });

    const savedTask = await this.tasksRepository.save(task);
    this.logEvent('task_created', {
      isAiGenerated: savedTask.isAiGenerated,
      taskId: savedTask.id,
    });
    this.tasksEventsGateway.emitTasksChanged('created');

    return savedTask;
  }

  async update(id: string, dto: UpdateTaskDto): Promise<Task> {
    const task = await this.findOneOrFail(id);

    if (dto.title !== undefined) {
      task.title = this.normalizeTitle(dto.title);
    }

    if (dto.description !== undefined) {
      task.description = this.normalizeDescription(dto.description);
    }

    if (dto.label !== undefined) {
      task.label = this.normalizeLabel(dto.label);
    }

    if (dto.isCompleted !== undefined) {
      this.applyCompletionStatus(task, dto.isCompleted);
    }

    if (dto.status !== undefined) {
      this.applyTaskStatus(task, dto.status);
    }

    const savedTask = await this.tasksRepository.save(task);
    this.logEvent('task_updated', {
      isCompleted: savedTask.isCompleted,
      taskId: savedTask.id,
    });
    this.tasksEventsGateway.emitTasksChanged('updated');

    return savedTask;
  }

  async reorder(orderedIds: string[]): Promise<Task[]> {
    const tasks = await this.tasksRepository.find();
    const orderedTasks = this.resolveOrderedRootTasks(orderedIds, tasks);

    await this.tasksRepository.manager.transaction((manager) =>
      manager.save(Task, orderedTasks),
    );

    this.logEvent('tasks_reordered', { count: orderedTasks.length });
    this.tasksEventsGateway.emitTasksChanged('reordered');

    return this.findAll();
  }

  async move(id: string, dto: MoveTaskDto): Promise<Task[]> {
    const tasks = await this.tasksRepository.find();
    const movingTask = tasks.find((task) => task.id === id);

    if (!movingTask) {
      throw new NotFoundException(`Tarefa ${id} nao foi encontrada.`);
    }

    if (movingTask.parentId) {
      throw new BadRequestException(
        'Apenas tarefas raiz podem ser movidas no quadro.',
      );
    }

    const orderedTasks = this.resolveOrderedRootTasks(dto.orderedIds, tasks);

    if (!dto.orderedIds.includes(id)) {
      throw new BadRequestException(
        'A tarefa movida deve estar presente na ordenacao.',
      );
    }

    this.applyTaskStatus(movingTask, dto.status);
    const orderedTaskById = new Map(orderedTasks.map((task) => [task.id, task]));
    orderedTaskById.set(id, movingTask);

    const movedTasks = dto.orderedIds.map((taskId, position) => {
      const task = orderedTaskById.get(taskId)!;
      task.position = position;
      return task;
    });

    const savedTasks = await this.tasksRepository.manager.transaction((manager) =>
      manager.save(Task, movedTasks),
    );

    this.logEvent('task_moved', {
      count: savedTasks.length,
      status: dto.status,
      taskId: id,
    });
    this.tasksEventsGateway.emitTasksChanged('moved');

    return this.findAll();
  }

  async remove(id: string): Promise<void> {
    const tasks = await this.tasksRepository.find();
    const task = tasks.find((item) => item.id === id);

    if (!task) {
      throw new NotFoundException(`Tarefa ${id} nao foi encontrada.`);
    }

    const idsToDelete = this.resolveDescendantIds(id, tasks);
    await this.tasksRepository.delete(idsToDelete);

    this.logEvent('task_deleted', { count: idsToDelete.length, taskId: id });
    this.tasksEventsGateway.emitTasksChanged('deleted');
  }

  async generateFromGoal(dto: GenerateTasksDto): Promise<Task[]> {
    const generatedPlan = await this.aiTaskGenerator.generateTasks({
      goal: dto.goal,
    });
    return this.persistGeneratedPlan(generatedPlan, {
      eventReason: 'generated',
      logEventName: 'ai_tasks_generated',
    });
  }

  async previewFromGoal(dto: GenerateTasksDto): Promise<AiDraftPlanDto> {
    const generatedPlan = await this.aiTaskGenerator.generateTasks({
      goal: dto.goal,
    });

    return this.normalizeDraftPlan(generatedPlan);
  }

  async confirmGeneratedPlan(dto: AiDraftPlanDto): Promise<Task[]> {
    return this.persistGeneratedPlan(dto, {
      eventReason: 'confirmed',
      logEventName: 'ai_tasks_confirmed',
    });
  }

  private async persistGeneratedPlan(
    plan: AiDraftPlanDto,
    options: {
      eventReason: Extract<TaskChangeAction, 'confirmed' | 'generated'>;
      logEventName: 'ai_tasks_confirmed' | 'ai_tasks_generated';
    },
  ): Promise<Task[]> {
    const generatedPlan = this.normalizeDraftPlan(plan);
    const [storyPosition] = await this.resolveTopPositions(1);

    const tasks = await this.tasksRepository.manager.transaction(async (manager) => {
      const story = await manager.save(
        Task,
        this.tasksRepository.create({
          title: generatedPlan.story.title,
          description: generatedPlan.story.description,
          label: generatedPlan.story.label,
          parentId: null,
          rootId: null,
          position: storyPosition,
          status: DEFAULT_TASK_STATUS,
          isCompleted: false,
          isAiGenerated: true,
        }),
      );

      story.rootId = story.id;

      const subtasks = generatedPlan.subtasks.map((generatedTask, index) =>
        this.tasksRepository.create({
          title: generatedTask.title,
          description: generatedTask.description,
          label: generatedTask.label,
          parentId: story.id,
          rootId: story.id,
          position: index,
          status: DEFAULT_TASK_STATUS,
          isCompleted: false,
          isAiGenerated: true,
        }),
      );

      return manager.save(Task, [story, ...subtasks]);
    });

    this.logEvent(options.logEventName, { count: tasks.length });
    this.tasksEventsGateway.emitTasksChanged(options.eventReason);

    return tasks;
  }

  private async findOneOrFail(id: string): Promise<Task> {
    const task = await this.tasksRepository.findOne({ where: { id } });

    if (!task) {
      throw new NotFoundException(`Tarefa ${id} nao foi encontrada.`);
    }

    return task;
  }

  private normalizeTitle(title: string): string {
    const normalizedTitle = title.trim().replace(/\s+/g, ' ');

    if (!normalizedTitle) {
      throw new BadRequestException('O titulo da tarefa nao pode ficar vazio.');
    }

    return normalizedTitle;
  }

  private normalizeDescription(description: string): string | null {
    const normalizedDescription = description.trim();
    return normalizedDescription || null;
  }

  private normalizeLabel(label: string): string | null {
    const normalizedLabel = label.trim().replace(/\s+/g, ' ');
    return normalizedLabel || null;
  }

  private normalizeDraftPlan(plan: AiDraftPlanDto): NormalizedAiDraftPlan {
    if (!plan.story) {
      throw new BadRequestException('O plano precisa ter uma historia.');
    }

    if (!Array.isArray(plan.subtasks) || plan.subtasks.length === 0) {
      throw new BadRequestException('O plano precisa ter ao menos uma subtarefa.');
    }

    if (plan.subtasks.length > AI_DRAFT_MAX_SUBTASKS) {
      throw new BadRequestException(
        `O plano pode ter no maximo ${AI_DRAFT_MAX_SUBTASKS} subtarefas.`,
      );
    }

    return {
      story: this.normalizeDraftTask(plan.story),
      subtasks: plan.subtasks.map((subtask) => this.normalizeDraftTask(subtask)),
    };
  }

  private normalizeDraftTask(task: AiDraftTaskDto): NormalizedAiDraftTask {
    return {
      description: this.normalizeOptionalDescription(task.description),
      label: this.normalizeOptionalLabel(task.label),
      title: this.normalizeTitle(task.title),
    };
  }

  private normalizeOptionalDescription(
    description: string | null | undefined,
  ): string | null {
    return description === null || description === undefined
      ? null
      : this.normalizeDescription(description);
  }

  private normalizeOptionalLabel(label: string | null | undefined): string | null {
    return label === null || label === undefined ? null : this.normalizeLabel(label);
  }

  private resolveOrderedRootTasks(orderedIds: string[], tasks: Task[]): Task[] {
    if (new Set(orderedIds).size !== orderedIds.length) {
      throw new BadRequestException(
        'A lista de tarefas nao pode conter duplicatas.',
      );
    }

    const rootTasks = tasks.filter((task) => !task.parentId);

    if (orderedIds.length !== rootTasks.length) {
      throw new BadRequestException(
        'A ordenacao deve conter todas as tarefas raiz salvas.',
      );
    }

    const taskById = new Map(rootTasks.map((task) => [task.id, task]));
    const invalidId = orderedIds.find((id) => !taskById.has(id));

    if (invalidId) {
      throw new BadRequestException(`Tarefa ${invalidId} nao foi encontrada.`);
    }

    return orderedIds.map((id, position) => {
      const task = taskById.get(id)!;
      task.position = position;
      task.status = resolveTaskStatus(task.status, task.isCompleted);
      task.isCompleted = isCompletedStatus(task.status);
      return task;
    });
  }

  private resolveDescendantIds(id: string, tasks: Task[]): string[] {
    const idsToDelete = new Set<string>([id]);
    let changed = true;

    while (changed) {
      changed = false;

      for (const task of tasks) {
        if (
          task.parentId &&
          idsToDelete.has(task.parentId) &&
          !idsToDelete.has(task.id)
        ) {
          idsToDelete.add(task.id);
          changed = true;
        }
      }
    }

    return [...idsToDelete];
  }

  private applyCompletionStatus(task: Task, isCompleted: boolean): void {
    task.status = isCompleted
      ? 'done'
      : task.status === 'done'
        ? DEFAULT_TASK_STATUS
        : resolveTaskStatus(task.status, false);
    task.isCompleted = isCompletedStatus(task.status);
  }

  private applyTaskStatus(task: Task, status: TaskStatus): void {
    task.status = status;
    task.isCompleted = isCompletedStatus(status);
  }

  private async resolveTopPositions(count: number): Promise<number[]> {
    if (count <= 0) {
      return [];
    }

    const [firstTask] = await this.tasksRepository.find({
      order: { position: 'ASC' },
      select: { position: true },
      take: 1,
    });

    const startPosition =
      firstTask?.position === undefined ? 0 : firstTask.position - count;

    return Array.from(
      { length: count },
      (_value, index) => startPosition + index,
    );
  }

  private logEvent(event: string, metadata: Record<string, unknown>): void {
    this.logger.log(JSON.stringify({ event, ...metadata }));
  }
}
