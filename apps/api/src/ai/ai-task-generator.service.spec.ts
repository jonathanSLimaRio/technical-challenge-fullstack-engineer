import { BadGatewayException, UnprocessableEntityException } from '@nestjs/common';
import { AiTaskGeneratorService } from './ai-task-generator.service';
import { OpenAiCompatibleClient } from './openai-compatible.client';

describe(AiTaskGeneratorService.name, () => {
  const client = {
    createJsonCompletion: jest.fn(),
  };
  const service = new AiTaskGeneratorService(
    client as unknown as OpenAiCompatibleClient,
  );

  beforeEach(() => {
    client.createJsonCompletion.mockReset();
  });

  it('parses, normalizes, deduplicates and limits generated tasks', async () => {
    client.createJsonCompletion.mockResolvedValue(
      JSON.stringify({
        tasks: [
          { title: '  Choose destination dates ' },
          { title: 'Choose destination dates' },
          'Compare flights',
          { title: 'Reserve hotel' },
          { title: 'Create packing list' },
          { title: 'Check visa rules' },
          { title: 'Buy travel insurance' },
          { title: 'Plan daily itinerary' },
          { title: 'Book airport transfer' },
          { title: 'Download offline maps' },
          { title: 'Share itinerary' },
          { title: 'Extra task beyond limit' },
        ],
      }),
    );

    await expect(
      service.generateTasks({ apiKey: 'sk-test', goal: 'Plan a trip' }),
    ).resolves.toEqual([
      'Choose destination dates',
      'Compare flights',
      'Reserve hotel',
      'Create packing list',
      'Check visa rules',
      'Buy travel insurance',
      'Plan daily itinerary',
      'Book airport transfer',
      'Download offline maps',
      'Share itinerary',
    ]);
  });

  it('parses JSON surrounded by markdown fences', async () => {
    client.createJsonCompletion.mockResolvedValue(
      '```json\n{"tasks":[{"title":"Draft itinerary"}]}\n```',
    );

    await expect(
      service.generateTasks({ apiKey: 'sk-test', goal: 'Plan a trip' }),
    ).resolves.toEqual(['Draft itinerary']);
  });

  it('rejects invalid JSON responses', async () => {
    client.createJsonCompletion.mockResolvedValue('not-json');

    await expect(
      service.generateTasks({ apiKey: 'sk-test', goal: 'Plan a trip' }),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('rejects JSON without a tasks array', async () => {
    client.createJsonCompletion.mockResolvedValue('{"items":[]}');

    await expect(
      service.generateTasks({ apiKey: 'sk-test', goal: 'Plan a trip' }),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('rejects empty task lists', async () => {
    client.createJsonCompletion.mockResolvedValue('{"tasks":[]}');

    await expect(
      service.generateTasks({ apiKey: 'sk-test', goal: 'Plan a trip' }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });
});
