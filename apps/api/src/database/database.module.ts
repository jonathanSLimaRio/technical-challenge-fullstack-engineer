import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { Task } from '../tasks/task.entity';

// Resolve o caminho do SQLite e garante que a pasta do banco exista.
function resolveSqlitePath(): string {
  const databasePath =
    process.env.SQLITE_PATH ?? join(process.cwd(), 'data', 'smart-todos.sqlite');

  mkdirSync(dirname(databasePath), { recursive: true });

  return databasePath;
}

// Configura o TypeORM para persistir tarefas em SQLite.
@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'better-sqlite3',
      database: resolveSqlitePath(),
      entities: [Task],
      synchronize: process.env.TYPEORM_SYNCHRONIZE === 'true',
    }),
  ],
})
export class DatabaseModule {}
