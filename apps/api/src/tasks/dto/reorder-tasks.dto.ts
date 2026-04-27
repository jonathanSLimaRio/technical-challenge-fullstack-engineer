import { ApiProperty } from '@nestjs/swagger';
import { ArrayNotEmpty, ArrayUnique, IsArray, IsUUID } from 'class-validator';

// Define a lista de IDs usada para reordenar tarefas raiz.
export class ReorderTasksDto {
  @ApiProperty({
    example: [
      '4c6e1a25-1dd2-4d17-8c8a-c7629fbb064d',
      'bff7d199-65b7-45b4-95c8-9c7da0fd6fd4',
    ],
    type: [String],
  })
  @IsArray({ message: 'A ordem das tarefas deve ser uma lista.' })
  @ArrayNotEmpty({ message: 'Informe ao menos uma tarefa para reordenar.' })
  @ArrayUnique({ message: 'A lista de tarefas nao pode conter duplicatas.' })
  @IsUUID('4', {
    each: true,
    message: 'Cada item da ordenacao deve ser um UUID valido.',
  })
  orderedIds!: string[];
}
