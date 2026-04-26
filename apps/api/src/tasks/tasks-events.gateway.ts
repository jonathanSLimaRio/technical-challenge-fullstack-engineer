import { Injectable } from '@nestjs/common';
import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { Server } from 'socket.io';

type TaskChangeAction =
  | 'created'
  | 'deleted'
  | 'generated'
  | 'moved'
  | 'reordered'
  | 'updated';

type TasksChangedPayload = {
  action: TaskChangeAction;
  at: string;
};

function parseCorsOrigins(value: string | undefined): string[] {
  return (value ?? 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

@Injectable()
@WebSocketGateway({
  cors: {
    origin: parseCorsOrigins(process.env.CORS_ORIGIN),
    methods: ['GET', 'POST'],
  },
})
export class TasksEventsGateway {
  @WebSocketServer()
  private server?: Server;

  emitTasksChanged(action: TaskChangeAction): void {
    this.server?.emit('tasks:changed', {
      action,
      at: new Date().toISOString(),
    } satisfies TasksChangedPayload);
  }
}
