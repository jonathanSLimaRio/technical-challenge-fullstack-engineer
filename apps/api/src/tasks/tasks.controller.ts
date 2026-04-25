import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiBadGatewayResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CreateTaskDto } from './dto/create-task.dto';
import { GenerateTasksDto } from './dto/generate-tasks.dto';
import {
  GenerateTasksResponseDto,
  TaskResponseDto,
} from './dto/task-response.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { TasksService } from './tasks.service';

function envNumber(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

@ApiTags('tasks')
@Controller('tasks')
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Get()
  @ApiOperation({ summary: 'List tasks ordered by creation date' })
  @ApiOkResponse({ type: [TaskResponseDto] })
  async findAll(): Promise<TaskResponseDto[]> {
    const tasks = await this.tasksService.findAll();
    return tasks.map(TaskResponseDto.fromEntity);
  }

  @Post()
  @ApiOperation({ summary: 'Create a manual task' })
  @ApiCreatedResponse({ type: TaskResponseDto })
  async create(@Body() dto: CreateTaskDto): Promise<TaskResponseDto> {
    const task = await this.tasksService.create(dto);
    return TaskResponseDto.fromEntity(task);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update task title or completion status' })
  @ApiOkResponse({ type: TaskResponseDto })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTaskDto,
  ): Promise<TaskResponseDto> {
    const task = await this.tasksService.update(id, dto);
    return TaskResponseDto.fromEntity(task);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a task' })
  @ApiNoContentResponse()
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.tasksService.remove(id);
  }

  @Post('ai-generate')
  @Throttle({
    default: {
      limit: envNumber('AI_THROTTLE_LIMIT', 5),
      ttl: envNumber('AI_THROTTLE_TTL_MS', 60000),
    },
  })
  @ApiOperation({ summary: 'Generate tasks from a high-level goal' })
  @ApiCreatedResponse({ type: GenerateTasksResponseDto })
  @ApiUnauthorizedResponse({ description: 'Invalid or unauthorized provider key' })
  @ApiBadGatewayResponse({ description: 'Provider timeout or invalid AI response' })
  async generateFromGoal(
    @Body() dto: GenerateTasksDto,
  ): Promise<GenerateTasksResponseDto> {
    const tasks = await this.tasksService.generateFromGoal(dto);
    return { tasks: tasks.map(TaskResponseDto.fromEntity) };
  }
}
