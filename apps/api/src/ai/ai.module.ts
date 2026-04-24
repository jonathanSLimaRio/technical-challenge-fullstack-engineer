import { Module } from '@nestjs/common';
import { AiTaskGeneratorService } from './ai-task-generator.service';
import { OpenAiCompatibleClient } from './openai-compatible.client';

@Module({
  providers: [AiTaskGeneratorService, OpenAiCompatibleClient],
  exports: [AiTaskGeneratorService],
})
export class AiModule {}
