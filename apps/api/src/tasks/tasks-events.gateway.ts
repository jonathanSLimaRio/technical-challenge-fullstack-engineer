import { Injectable } from '@nestjs/common';
import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { Server } from 'socket.io';

export type TaskChangeAction =
  | 'created'
  | 'deleted'
  | 'confirmed'
  | 'generated'
  | 'moved'
  | 'reordered'
  | 'updated';

type TasksChangedPayload = {
  action: TaskChangeAction;
  at: string;
};

// Transforma a configuração de CORS em uma lista de origens para WebSocket.
function parseCorsOrigins(value: string | undefined): string[] {
  return (value ?? 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

// Publica eventos WebSocket quando a lista de tarefas muda.
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

  // Envia aos clientes conectados a ação que alterou as tarefas.
  emitTasksChanged(action: TaskChangeAction): void {
    this.server?.emit('tasks:changed', {
      action,
      at: new Date().toISOString(),
    } satisfies TasksChangedPayload);
  }
}
