import { Module } from '@nestjs/common';
import { AiTaskGeneratorService } from './ai-task-generator.service';
import { LlmChatCompletionClient } from './llm-chat-completion.client';

@Module({
  providers: [AiTaskGeneratorService, LlmChatCompletionClient],
  exports: [AiTaskGeneratorService],
})
export class AiModule {}
