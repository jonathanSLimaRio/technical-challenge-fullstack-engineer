import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, Length } from 'class-validator';

export class CreateTaskDto {
  @ApiProperty({ example: 'Reservar voos', minLength: 1, maxLength: 160 })
  @IsString({ message: 'O título da tarefa deve ser um texto.' })
  @Length(1, 160, {
    message: 'O título da tarefa deve ter entre 1 e 160 caracteres.',
  })
  title!: string;

  @ApiProperty({
    example: 'Comparar opcoes com bagagem incluida antes de comprar.',
    maxLength: 1000,
    required: false,
  })
  @IsOptional()
  @IsString({ message: 'A descricao da tarefa deve ser um texto.' })
  @Length(0, 1000, {
    message: 'A descricao da tarefa deve ter no maximo 1000 caracteres.',
  })
  description?: string;

  @ApiProperty({ example: 'Viagem', maxLength: 40, required: false })
  @IsOptional()
  @IsString({ message: 'A etiqueta da tarefa deve ser um texto.' })
  @Length(0, 40, {
    message: 'A etiqueta da tarefa deve ter no maximo 40 caracteres.',
  })
  label?: string;
}
