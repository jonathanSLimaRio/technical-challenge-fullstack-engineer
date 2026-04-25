import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiModule } from '../ai/ai.module';
import { Task } from './task.entity';
import { TasksController } from './tasks.controller';
import { TasksEventsGateway } from './tasks-events.gateway';
import { TasksService } from './tasks.service';

@Module({
  imports: [TypeOrmModule.forFeature([Task]), AiModule],
  controllers: [TasksController],
  providers: [TasksEventsGateway, TasksService],
})
export class TasksModule {}
