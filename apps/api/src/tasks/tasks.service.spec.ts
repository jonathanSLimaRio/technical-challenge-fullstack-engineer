import { NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { AiTaskGeneratorService } from '../ai/ai-task-generator.service';
import { Task } from './task.entity';
import { TasksService } from './tasks.service';

type Harness = {
  aiTaskGenerator: { generateTasks: jest.Mock };
  repository: Repository<Task>;
  service: TasksService;
  tasks: Task[];
};

function createHarness(): Harness {
  const tasks: Task[] = [];
  let sequence = 0;

  const persistTask = (task: Task): Task => {
    const now = new Date(Date.UTC(2026, 3, 24, 12, 0, sequence++));
    const existingIndex = tasks.findIndex((item) => item.id === task.id);
    const persisted: Task = {
      ...task,
      id: task.id || `task-${sequence}`,
      createdAt: task.createdAt ?? now,
      updatedAt: now,
    };

    if (existingIndex >= 0) {
      tasks[existingIndex] = persisted;
    } else {
      tasks.push(persisted);
    }

    return persisted;
  };

  const managerSave = jest.fn(async (_entity: typeof Task, entities: Task[]) =>
    entities.map(persistTask),
  );

  const repository = {
    create: jest.fn((input: Partial<Task>) => ({
      id: '',
      title: '',
      isCompleted: false,
      isAiGenerated: false,
      createdAt: undefined,
      updatedAt: undefined,
      ...input,
    })),
    delete: jest.fn(async (id: string) => {
      const index = tasks.findIndex((task) => task.id === id);

      if (index === -1) {
        return { affected: 0, raw: undefined };
      }

      tasks.splice(index, 1);
      return { affected: 1, raw: undefined };
    }),
    find: jest.fn(async () =>
      [...tasks].sort((left, right) => {
        return right.createdAt.getTime() - left.createdAt.getTime();
      }),
    ),
    findOne: jest.fn(async ({ where }: { where: { id: string } }) => {
      return tasks.find((task) => task.id === where.id) ?? null;
    }),
    manager: {
      transaction: jest.fn(async (callback: (manager: unknown) => Promise<Task[]>) =>
        callback({ save: managerSave }),
      ),
    },
    save: jest.fn(async (task: Task) => persistTask(task)),
  } as unknown as Repository<Task>;

  const aiTaskGenerator = {
    generateTasks: jest.fn(),
  };

  return {
    aiTaskGenerator,
    repository,
    service: new TasksService(
      repository,
      aiTaskGenerator as unknown as AiTaskGeneratorService,
    ),
    tasks,
  };
}

describe(TasksService.name, () => {
  it('creates a normalized manual task', async () => {
    const { service } = createHarness();

    const task = await service.create({ title: '  Book    flights  ' });

    expect(task.title).toBe('Book flights');
    expect(task.isCompleted).toBe(false);
    expect(task.isAiGenerated).toBe(false);
  });

  it('lists tasks with newest first', async () => {
    const { service } = createHarness();

    const first = await service.create({ title: 'First task' });
    const second = await service.create({ title: 'Second task' });

    await expect(service.findAll()).resolves.toEqual([second, first]);
  });

  it('updates title and completion status', async () => {
    const { service } = createHarness();
    const task = await service.create({ title: 'Pack bags' });

    const updated = await service.update(task.id, {
      isCompleted: true,
      title: '  Pack carry-on bag ',
    });

    expect(updated.title).toBe('Pack carry-on bag');
    expect(updated.isCompleted).toBe(true);
  });

  it('deletes a task', async () => {
    const { service, tasks } = createHarness();
    const task = await service.create({ title: 'Cancel hotel hold' });

    await service.remove(task.id);

    expect(tasks).toHaveLength(0);
    await expect(service.remove(task.id)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('persists AI-generated tasks inside a transaction', async () => {
    const { aiTaskGenerator, repository, service } = createHarness();
    aiTaskGenerator.generateTasks.mockResolvedValue([
      'Choose destination dates',
      'Compare flight options',
    ]);

    const generatedTasks = await service.generateFromGoal({
      apiKey: 'sk-test',
      goal: 'Plan a trip',
    });

    expect(generatedTasks).toHaveLength(2);
    expect(generatedTasks.every((task) => task.isAiGenerated)).toBe(true);
    expect(repository.manager.transaction).toHaveBeenCalledTimes(1);
  });

  it('does not persist tasks when AI generation fails', async () => {
    const { aiTaskGenerator, repository, service, tasks } = createHarness();
    aiTaskGenerator.generateTasks.mockRejectedValue(new Error('provider failed'));

    await expect(
      service.generateFromGoal({ apiKey: 'sk-test', goal: 'Plan a trip' }),
    ).rejects.toThrow('provider failed');

    expect(tasks).toHaveLength(0);
    expect(repository.manager.transaction).not.toHaveBeenCalled();
  });
});
