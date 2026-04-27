import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, Length } from 'class-validator';

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

  @ApiProperty({
    description:
      'Chave opcional do provedor usada somente nesta solicitacao de IA.',
    example: 'hf_your_token_here',
    maxLength: 4096,
    minLength: 1,
    required: false,
  })
  @IsOptional()
  @IsString({ message: 'A chave da API do provedor deve ser um texto.' })
  @Length(1, 4096, {
    message: 'A chave da API do provedor deve ter entre 1 e 4096 caracteres.',
  })
  apiKey?: string;
}
