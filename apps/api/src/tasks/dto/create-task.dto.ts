import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

export class CreateTaskDto {
  @ApiProperty({ example: 'Reservar voos', minLength: 1, maxLength: 160 })
  @IsString({ message: 'O título da tarefa deve ser um texto.' })
  @Length(1, 160, {
    message: 'O título da tarefa deve ter entre 1 e 160 caracteres.',
  })
  title!: string;
}
