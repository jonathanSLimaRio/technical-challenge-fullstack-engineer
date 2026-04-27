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
import { AiDraftPlanDto } from './dto/ai-draft-plan.dto';
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

// Converte variáveis de ambiente numéricas para limites positivos com fallback seguro.
function envNumber(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

// Expõe os endpoints HTTP para gerenciar tarefas e planos gerados por IA.
@ApiTags('tasks')
@Controller('tasks')
export class TasksController {
  // Recebe o serviço que contém as regras de negócio das tarefas.
  constructor(private readonly tasksService: TasksService) {}

  // Retorna todas as tarefas no formato público da API.
  @Get()
  @ApiOperation({ summary: 'Lista tarefas ordenadas por data de criação' })
  @ApiOkResponse({ type: [TaskResponseDto] })
  async findAll(): Promise<TaskResponseDto[]> {
    const tasks = await this.tasksService.findAll();
    return tasks.map(TaskResponseDto.fromEntity);
  }

  // Cria uma tarefa manual a partir dos dados enviados pelo usuário.
  @Post()
  @ApiOperation({ summary: 'Cria uma tarefa manual' })
  @ApiCreatedResponse({ type: TaskResponseDto })
  async create(@Body() dto: CreateTaskDto): Promise<TaskResponseDto> {
    const task = await this.tasksService.create(dto);
    return TaskResponseDto.fromEntity(task);
  }

  // Reordena a fila de execução das tarefas raiz.
  @Patch('reorder')
  @ApiOperation({ summary: 'Reordena a fila de execucao das tarefas' })
  @ApiOkResponse({ type: [TaskResponseDto] })
  async reorder(@Body() dto: ReorderTasksDto): Promise<TaskResponseDto[]> {
    const tasks = await this.tasksService.reorder(dto.orderedIds);
    return tasks.map(TaskResponseDto.fromEntity);
  }

  // Move uma tarefa raiz entre status do quadro e atualiza sua posição.
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

  // Atualiza os campos editáveis ou o status de uma tarefa existente.
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

  // Exclui uma tarefa e delega a remoção de subtarefas ao serviço.
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Exclui uma tarefa' })
  @ApiNoContentResponse()
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.tasksService.remove(id);
  }

  // Gera tarefas por IA e já persiste o plano retornado.
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

  // Gera um rascunho editável de IA sem salvar tarefas.
  @Post('ai-preview')
  @Throttle({
    default: {
      limit: envNumber('AI_THROTTLE_LIMIT', 5),
      ttl: envNumber('AI_THROTTLE_TTL_MS', 60000),
    },
  })
  @ApiOperation({
    summary: 'Gera um rascunho editavel de plano sem persistir tarefas',
  })
  @ApiCreatedResponse({ type: AiDraftPlanDto })
  @ApiUnauthorizedResponse({
    description: 'Chave do provedor invalida ou nao autorizada',
  })
  @ApiBadGatewayResponse({
    description: 'Timeout do provedor ou resposta invalida da IA',
  })
  @ApiServiceUnavailableResponse({
    description: 'Chave da API de IA nao configurada no servidor',
  })
  async previewFromGoal(
    @Body() dto: GenerateTasksDto,
  ): Promise<AiDraftPlanDto> {
    return this.tasksService.previewFromGoal(dto);
  }

  // Persiste um plano de IA revisado pelo usuário.
  @Post('ai-confirm')
  @ApiOperation({
    summary: 'Persiste um rascunho editado de plano gerado por IA',
  })
  @ApiCreatedResponse({ type: GenerateTasksResponseDto })
  async confirmGeneratedPlan(
    @Body() dto: AiDraftPlanDto,
  ): Promise<GenerateTasksResponseDto> {
    const tasks = await this.tasksService.confirmGeneratedPlan(dto);
    return { tasks: tasks.map(TaskResponseDto.fromEntity) };
  }
}
