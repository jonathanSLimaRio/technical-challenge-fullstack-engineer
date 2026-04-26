import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString, Length } from 'class-validator';
import { TASK_STATUSES, type TaskStatus } from '../task-status';

export class UpdateTaskDto {
  @ApiPropertyOptional({ example: 'Reservar voos reembolsaveis', maxLength: 160 })
  @IsOptional()
  @IsString({ message: 'O titulo da tarefa deve ser um texto.' })
  @Length(1, 160, {
    message: 'O titulo da tarefa deve ter entre 1 e 160 caracteres.',
  })
  title?: string;

  @ApiPropertyOptional({
    example: 'Comparar opcoes com bagagem incluida antes de comprar.',
    maxLength: 1000,
  })
  @IsOptional()
  @IsString({ message: 'A descricao da tarefa deve ser um texto.' })
  @Length(0, 1000, {
    message: 'A descricao da tarefa deve ter no maximo 1000 caracteres.',
  })
  description?: string;

  @ApiPropertyOptional({ example: 'Viagem', maxLength: 40 })
  @IsOptional()
  @IsString({ message: 'A etiqueta da tarefa deve ser um texto.' })
  @Length(0, 40, {
    message: 'A etiqueta da tarefa deve ter no maximo 40 caracteres.',
  })
  label?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean({ message: 'O status de conclusao deve ser verdadeiro ou falso.' })
  isCompleted?: boolean;

  @ApiPropertyOptional({ enum: TASK_STATUSES, example: 'doing' })
  @IsOptional()
  @IsIn(TASK_STATUSES, {
    message: 'O status da tarefa deve ser todo, doing, blocked ou done.',
  })
  status?: TaskStatus;
}
