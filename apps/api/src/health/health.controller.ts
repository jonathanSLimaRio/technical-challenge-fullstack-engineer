import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DataSource } from 'typeorm';

type HealthResponse = {
  status: 'ok';
  timestamp: string;
  database: 'ok';
};

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly dataSource: DataSource) {}

  @Get()
  @ApiOperation({ summary: 'Retorna a saúde da API e do banco de dados' })
  @ApiOkResponse({
    schema: {
      example: {
        status: 'ok',
        timestamp: '2026-04-25T12:00:00.000Z',
        database: 'ok',
      },
    },
  })
  async check(): Promise<HealthResponse> {
    try {
      await this.dataSource.query('SELECT 1');
    } catch {
      throw new ServiceUnavailableException(
        'A verificação de saúde do banco de dados falhou.',
      );
    }

    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      database: 'ok',
    };
  }
}
