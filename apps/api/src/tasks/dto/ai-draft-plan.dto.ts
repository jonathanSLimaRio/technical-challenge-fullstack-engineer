import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsDefined,
  IsArray,
  IsOptional,
  IsString,
  Length,
  ValidateNested,
} from 'class-validator';

export const AI_DRAFT_MAX_SUBTASKS = 10;

// Define os campos aceitos para uma tarefa dentro de um rascunho de IA.
export class AiDraftTaskDto {
  @ApiProperty({
    example: 'Planejar viagem para Buenos Aires',
    maxLength: 160,
    minLength: 1,
  })
  @IsString({ message: 'O titulo da tarefa deve ser um texto.' })
  @Length(1, 160, {
    message: 'O titulo da tarefa deve ter entre 1 e 160 caracteres.',
  })
  title!: string;

  @ApiProperty({
    example: 'Organizar reservas, roteiro e documentos antes da viagem.',
    maxLength: 1000,
    nullable: true,
    required: false,
  })
  @IsOptional()
  @IsString({ message: 'A descricao da tarefa deve ser um texto.' })
  @Length(0, 1000, {
    message: 'A descricao da tarefa deve ter no maximo 1000 caracteres.',
  })
  description?: string | null;

  @ApiProperty({
    example: 'Planejamento',
    maxLength: 40,
    nullable: true,
    required: false,
  })
  @IsOptional()
  @IsString({ message: 'A etiqueta da tarefa deve ser um texto.' })
  @Length(0, 40, {
    message: 'A etiqueta da tarefa deve ter no maximo 40 caracteres.',
  })
  label?: string | null;
}

// Define o contrato de um plano de IA com história principal e subtarefas.
export class AiDraftPlanDto {
  @ApiProperty({ type: AiDraftTaskDto })
  @IsDefined({ message: 'O plano precisa ter uma historia.' })
  @ValidateNested()
  @Type(() => AiDraftTaskDto)
  story!: AiDraftTaskDto;

  @ApiProperty({
    example: [
      {
        description: 'Definir datas, orçamento e critérios de pronto.',
        label: 'Escopo',
        title: 'Definir escopo da viagem',
      },
    ],
    maxItems: AI_DRAFT_MAX_SUBTASKS,
    minItems: 1,
    type: [AiDraftTaskDto],
  })
  @IsArray({ message: 'As subtarefas devem ser enviadas em uma lista.' })
  @ArrayMinSize(1, {
    message: 'O plano precisa ter ao menos uma subtarefa.',
  })
  @ArrayMaxSize(AI_DRAFT_MAX_SUBTASKS, {
    message: `O plano pode ter no maximo ${AI_DRAFT_MAX_SUBTASKS} subtarefas.`,
  })
  @ValidateNested({ each: true })
  @Type(() => AiDraftTaskDto)
  subtasks!: AiDraftTaskDto[];
}
