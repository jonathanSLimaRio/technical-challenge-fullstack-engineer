import { ApiProperty } from '@nestjs/swagger';
import { Task } from '../task.entity';

export class TaskResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty({ nullable: true })
  description!: string | null;

  @ApiProperty({ nullable: true })
  label!: string | null;

  @ApiProperty()
  position!: number;

  @ApiProperty()
  isCompleted!: boolean;

  @ApiProperty()
  isAiGenerated!: boolean;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;

  static fromEntity(task: Task): TaskResponseDto {
    return {
      id: task.id,
      title: task.title,
      description: task.description,
      label: task.label,
      position: task.position,
      isCompleted: task.isCompleted,
      isAiGenerated: task.isAiGenerated,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    };
  }
}

export class GenerateTasksResponseDto {
  @ApiProperty({ type: [TaskResponseDto] })
  tasks!: TaskResponseDto[];
}
