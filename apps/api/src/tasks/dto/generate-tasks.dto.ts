import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

export class GenerateTasksDto {
  @ApiProperty({
    example: 'Plan a five-day trip to Buenos Aires',
    minLength: 3,
    maxLength: 500,
  })
  @IsString()
  @Length(3, 500)
  goal!: string;

  @ApiProperty({
    description: 'OpenAI-compatible provider API key. It is never persisted.',
    minLength: 1,
  })
  @IsString()
  @Length(1, 2048)
  apiKey!: string;
}
