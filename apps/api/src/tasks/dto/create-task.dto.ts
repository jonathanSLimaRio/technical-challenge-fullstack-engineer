import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

export class CreateTaskDto {
  @ApiProperty({ example: 'Book flights', minLength: 1, maxLength: 160 })
  @IsString()
  @Length(1, 160)
  title!: string;
}
