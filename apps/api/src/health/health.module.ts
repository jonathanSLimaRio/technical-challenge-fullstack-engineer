import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';

// Registra o endpoint de saúde da aplicação.
@Module({
  controllers: [HealthController],
})
export class HealthModule {}
