import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DataSource } from 'typeorm';

type HealthResponse = {
  status: 'ok';
  timestamp: string;
  database: 'ok';
};

// Expõe uma verificação simples de saúde da API e do banco de dados.
@ApiTags('health')
@Controller('health')
export class HealthController {
  // Recebe a conexão do TypeORM usada para validar o banco.
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
  // Confirma que a API responde e que o SQLite aceita uma consulta básica.
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
