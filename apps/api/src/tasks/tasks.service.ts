import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiTaskGeneratorService } from '../ai/ai-task-generator.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { GenerateTasksDto } from './dto/generate-tasks.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { Task } from './task.entity';
import { TasksEventsGateway } from './tasks-events.gateway';

@Injectable()
export class TasksService {
  constructor(
    @InjectRepository(Task)
    private readonly tasksRepository: Repository<Task>,
    private readonly aiTaskGenerator: AiTaskGeneratorService,
    private readonly tasksEventsGateway: TasksEventsGateway,
  ) {}

  async findAll(): Promise<Task[]> {
    return this.tasksRepository.find({
      order: { createdAt: 'DESC' },
    });
  }

  async create(
    dto: CreateTaskDto,
    options: { isAiGenerated?: boolean } = {},
  ): Promise<Task> {
    const title = this.normalizeTitle(dto.title);
    const task = this.tasksRepository.create({
      title,
      isCompleted: false,
      isAiGenerated: options.isAiGenerated ?? false,
    });

    const savedTask = await this.tasksRepository.save(task);
    this.tasksEventsGateway.emitTasksChanged('created');

    return savedTask;
  }

  async update(id: string, dto: UpdateTaskDto): Promise<Task> {
    const task = await this.findOneOrFail(id);

    if (dto.title !== undefined) {
      task.title = this.normalizeTitle(dto.title);
    }

    if (dto.isCompleted !== undefined) {
      task.isCompleted = dto.isCompleted;
    }

    const savedTask = await this.tasksRepository.save(task);
    this.tasksEventsGateway.emitTasksChanged('updated');

    return savedTask;
  }

  async remove(id: string): Promise<void> {
    const result = await this.tasksRepository.delete(id);

    if (!result.affected) {
      throw new NotFoundException(`Task ${id} was not found.`);
    }

    this.tasksEventsGateway.emitTasksChanged('deleted');
  }

  async generateFromGoal(dto: GenerateTasksDto): Promise<Task[]> {
    const titles = await this.aiTaskGenerator.generateTasks({
      apiKey: dto.apiKey,
      goal: dto.goal,
    });

    const taskEntities = titles.map((title) =>
      this.tasksRepository.create({
        title,
        isCompleted: false,
        isAiGenerated: true,
      }),
    );

    const tasks = await this.tasksRepository.manager.transaction((manager) =>
      manager.save(Task, taskEntities),
    );

    this.tasksEventsGateway.emitTasksChanged('generated');

    return tasks;
  }

  private async findOneOrFail(id: string): Promise<Task> {
    const task = await this.tasksRepository.findOne({ where: { id } });

    if (!task) {
      throw new NotFoundException(`Task ${id} was not found.`);
    }

    return task;
  }

  private normalizeTitle(title: string): string {
    const normalizedTitle = title.trim().replace(/\s+/g, ' ');

    if (!normalizedTitle) {
      throw new BadRequestException('Task title cannot be empty.');
    }

    return normalizedTitle;
  }
}
