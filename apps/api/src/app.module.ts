import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AiModule } from './ai/ai.module';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { TasksModule } from './tasks/tasks.module';

// Converte variáveis de ambiente numéricas para limites positivos com fallback seguro.
function envNumber(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

// Agrupa os módulos principais da API e configura o limite global de requisições.
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([
      {
        ttl: envNumber('THROTTLE_TTL_MS', 60000),
        limit: envNumber('THROTTLE_LIMIT', 100),
      },
    ]),
    DatabaseModule,
    AiModule,
    HealthModule,
    TasksModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
