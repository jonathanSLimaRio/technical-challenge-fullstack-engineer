import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

// Define o objetivo enviado pelo usuário para geração por IA.
export class GenerateTasksDto {
  @ApiProperty({
    example: 'Planejar uma viagem de cinco dias a Buenos Aires',
    minLength: 3,
    maxLength: 500,
  })
  @IsString({ message: 'O objetivo deve ser um texto.' })
  @Length(3, 500, {
    message: 'O objetivo deve ter entre 3 e 500 caracteres.',
  })
  goal!: string;
}
