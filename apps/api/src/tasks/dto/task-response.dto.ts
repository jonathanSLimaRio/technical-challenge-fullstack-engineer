import { ApiProperty } from '@nestjs/swagger';
import { Task } from '../task.entity';
import {
  isCompletedStatus,
  resolveTaskStatus,
  TASK_STATUSES,
  type TaskStatus,
} from '../task-status';

// Define o formato público de uma tarefa retornada pela API.
export class TaskResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty({ nullable: true })
  description!: string | null;

  @ApiProperty({ nullable: true })
  label!: string | null;

  @ApiProperty({ nullable: true })
  parentId!: string | null;

  @ApiProperty({ nullable: true })
  rootId!: string | null;

  @ApiProperty()
  position!: number;

  @ApiProperty({ enum: TASK_STATUSES })
  status!: TaskStatus;

  @ApiProperty()
  isCompleted!: boolean;

  @ApiProperty()
  isAiGenerated!: boolean;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;

  // Converte a entidade persistida para o DTO exposto aos clientes.
  static fromEntity(task: Task): TaskResponseDto {
    const status = resolveTaskStatus(task.status, task.isCompleted);

    return {
      id: task.id,
      title: task.title,
      description: task.description,
      label: task.label,
      parentId: task.parentId,
      rootId: task.rootId,
      position: task.position,
      status,
      isCompleted: isCompletedStatus(status),
      isAiGenerated: task.isAiGenerated,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    };
  }
}

// Define a resposta de endpoints que retornam tarefas geradas por IA.
export class GenerateTasksResponseDto {
  @ApiProperty({ type: [TaskResponseDto] })
  tasks!: TaskResponseDto[];
}
