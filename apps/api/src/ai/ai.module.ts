import { Module } from '@nestjs/common';
import { AiTaskGeneratorService } from './ai-task-generator.service';
import { LlmChatCompletionClient } from './llm-chat-completion.client';

// Disponibiliza os serviços de geração por IA para os demais módulos.
@Module({
  providers: [AiTaskGeneratorService, LlmChatCompletionClient],
  exports: [AiTaskGeneratorService],
})
export class AiModule {}
