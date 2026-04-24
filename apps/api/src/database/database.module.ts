import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { Task } from '../tasks/task.entity';

function resolveSqlitePath(): string {
  const databasePath =
    process.env.SQLITE_PATH ?? join(process.cwd(), 'data', 'smart-todos.sqlite');

  mkdirSync(dirname(databasePath), { recursive: true });

  return databasePath;
}

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'better-sqlite3',
      database: resolveSqlitePath(),
      entities: [Task],
      synchronize: process.env.TYPEORM_SYNCHRONIZE !== 'false',
    }),
  ],
})
export class DatabaseModule {}
