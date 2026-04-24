import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, Length } from 'class-validator';

export class UpdateTaskDto {
  @ApiPropertyOptional({ example: 'Book refundable flights', maxLength: 160 })
  @IsOptional()
  @IsString()
  @Length(1, 160)
  title?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isCompleted?: boolean;
}
