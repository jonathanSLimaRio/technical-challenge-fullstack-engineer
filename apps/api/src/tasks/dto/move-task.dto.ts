import { ApiProperty } from '@nestjs/swagger';
import { ArrayNotEmpty, IsArray, IsIn, IsUUID } from 'class-validator';
import { TASK_STATUSES, type TaskStatus } from '../task-status';

// Define o status de destino e a nova ordem ao mover uma tarefa no quadro.
export class MoveTaskDto {
  @ApiProperty({ enum: TASK_STATUSES, example: 'doing' })
  @IsIn(TASK_STATUSES, {
    message: 'O status da tarefa deve ser todo, doing, blocked ou done.',
  })
  status!: TaskStatus;

  @ApiProperty({ type: [String] })
  @IsArray({ message: 'A ordenacao deve ser uma lista de tarefas.' })
  @ArrayNotEmpty({ message: 'A ordenacao deve conter ao menos uma tarefa.' })
  @IsUUID('4', {
    each: true,
    message: 'A ordenacao deve conter apenas IDs validos de tarefas.',
  })
  orderedIds!: string[];
}
