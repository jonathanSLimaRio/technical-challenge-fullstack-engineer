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
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CreateTaskDto } from './dto/create-task.dto';
import { GenerateTasksDto } from './dto/generate-tasks.dto';
import { MoveTaskDto } from './dto/move-task.dto';
import { ReorderTasksDto } from './dto/reorder-tasks.dto';
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
  @ApiOperation({ summary: 'Lista tarefas ordenadas por data de criação' })
  @ApiOkResponse({ type: [TaskResponseDto] })
  async findAll(): Promise<TaskResponseDto[]> {
    const tasks = await this.tasksService.findAll();
    return tasks.map(TaskResponseDto.fromEntity);
  }

  @Post()
  @ApiOperation({ summary: 'Cria uma tarefa manual' })
  @ApiCreatedResponse({ type: TaskResponseDto })
  async create(@Body() dto: CreateTaskDto): Promise<TaskResponseDto> {
    const task = await this.tasksService.create(dto);
    return TaskResponseDto.fromEntity(task);
  }

  @Patch('reorder')
  @ApiOperation({ summary: 'Reordena a fila de execucao das tarefas' })
  @ApiOkResponse({ type: [TaskResponseDto] })
  async reorder(@Body() dto: ReorderTasksDto): Promise<TaskResponseDto[]> {
    const tasks = await this.tasksService.reorder(dto.orderedIds);
    return tasks.map(TaskResponseDto.fromEntity);
  }

  @Patch(':id/move')
  @ApiOperation({ summary: 'Move uma tarefa entre raias e persiste a ordem' })
  @ApiOkResponse({ type: [TaskResponseDto] })
  async move(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MoveTaskDto,
  ): Promise<TaskResponseDto[]> {
    const tasks = await this.tasksService.move(id, dto);
    return tasks.map(TaskResponseDto.fromEntity);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Atualiza o título da tarefa ou o status de conclusão',
  })
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
  @ApiOperation({ summary: 'Exclui uma tarefa' })
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
  @ApiOperation({ summary: 'Gera tarefas a partir de um objetivo amplo' })
  @ApiCreatedResponse({ type: GenerateTasksResponseDto })
  @ApiUnauthorizedResponse({
    description: 'Chave do provedor inválida ou não autorizada',
  })
  @ApiBadGatewayResponse({
    description: 'Timeout do provedor ou resposta inválida da IA',
  })
  @ApiServiceUnavailableResponse({
    description: 'Chave da API de IA nao configurada no servidor',
  })
  async generateFromGoal(
    @Body() dto: GenerateTasksDto,
  ): Promise<GenerateTasksResponseDto> {
    const tasks = await this.tasksService.generateFromGoal(dto);
    return { tasks: tasks.map(TaskResponseDto.fromEntity) };
  }
}
