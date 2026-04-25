import { ServiceUnavailableException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { HealthController } from './health.controller';

describe(HealthController.name, () => {
  it('returns ok when the database responds', async () => {
    const dataSource = {
      query: jest.fn().mockResolvedValue([{ ok: 1 }]),
    };
    const controller = new HealthController(dataSource as unknown as DataSource);

    await expect(controller.check()).resolves.toEqual({
      status: 'ok',
      timestamp: expect.any(String),
      database: 'ok',
    });
    expect(dataSource.query).toHaveBeenCalledWith('SELECT 1');
  });

  it('returns service unavailable when the database check fails', async () => {
    const dataSource = {
      query: jest.fn().mockRejectedValue(new Error('database down')),
    };
    const controller = new HealthController(dataSource as unknown as DataSource);

    await expect(controller.check()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
