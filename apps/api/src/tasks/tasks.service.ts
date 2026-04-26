import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiTaskGeneratorService } from '../ai/ai-task-generator.service';
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
import { TasksEventsGateway } from './tasks-events.gateway';

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
    const orderedTasks = this.resolveOrderedTasks(orderedIds, tasks);

    const savedTasks = await this.tasksRepository.manager.transaction((manager) =>
      manager.save(Task, orderedTasks),
    );

    this.logEvent('tasks_reordered', { count: savedTasks.length });
    this.tasksEventsGateway.emitTasksChanged('reordered');

    return savedTasks.sort((left, right) => left.position - right.position);
  }

  async move(id: string, dto: MoveTaskDto): Promise<Task[]> {
    const tasks = await this.tasksRepository.find();
    const movingTask = tasks.find((task) => task.id === id);

    if (!movingTask) {
      throw new NotFoundException(`Tarefa ${id} nao foi encontrada.`);
    }

    const orderedTasks = this.resolveOrderedTasks(dto.orderedIds, tasks);

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

    return savedTasks.sort((left, right) => left.position - right.position);
  }

  async remove(id: string): Promise<void> {
    const result = await this.tasksRepository.delete(id);

    if (!result.affected) {
      throw new NotFoundException(`Tarefa ${id} nao foi encontrada.`);
    }

    this.logEvent('task_deleted', { taskId: id });
    this.tasksEventsGateway.emitTasksChanged('deleted');
  }

  async generateFromGoal(dto: GenerateTasksDto): Promise<Task[]> {
    const generatedTasks = await this.aiTaskGenerator.generateTasks({
      goal: dto.goal,
    });
    const positions = await this.resolveTopPositions(generatedTasks.length);

    const taskEntities = generatedTasks.map((generatedTask, index) =>
      this.tasksRepository.create({
        title: this.normalizeTitle(generatedTask.title),
        description:
          generatedTask.description === null
            ? null
            : this.normalizeDescription(generatedTask.description),
        label:
          generatedTask.label === null
            ? null
            : this.normalizeLabel(generatedTask.label),
        position: positions[index],
        status: DEFAULT_TASK_STATUS,
        isCompleted: false,
        isAiGenerated: true,
      }),
    );

    const tasks = await this.tasksRepository.manager.transaction((manager) =>
      manager.save(Task, taskEntities),
    );

    this.logEvent('ai_tasks_generated', { count: tasks.length });
    this.tasksEventsGateway.emitTasksChanged('generated');

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

  private resolveOrderedTasks(orderedIds: string[], tasks: Task[]): Task[] {
    if (new Set(orderedIds).size !== orderedIds.length) {
      throw new BadRequestException(
        'A lista de tarefas nao pode conter duplicatas.',
      );
    }

    if (orderedIds.length !== tasks.length) {
      throw new BadRequestException(
        'A ordenacao deve conter todas as tarefas salvas.',
      );
    }

    const taskById = new Map(tasks.map((task) => [task.id, task]));
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
