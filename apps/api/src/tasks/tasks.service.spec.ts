import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { AiTaskGeneratorService } from '../ai/ai-task-generator.service';
import { Task } from './task.entity';
import { TasksService } from './tasks.service';

type Harness = {
  aiTaskGenerator: { generateTasks: jest.Mock };
  repository: Repository<Task>;
  service: TasksService;
  tasks: Task[];
  tasksEventsGateway: { emitTasksChanged: jest.Mock };
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

  const managerSave = jest.fn(async (_entity: typeof Task, input: Task | Task[]) =>
    Array.isArray(input) ? input.map(persistTask) : persistTask(input),
  );

  const repository = {
    create: jest.fn((input: Partial<Task>) => ({
      id: '',
      title: '',
      description: null,
      label: null,
      parentId: null,
      rootId: null,
      position: 0,
      status: 'todo',
      isCompleted: false,
      isAiGenerated: false,
      createdAt: undefined,
      updatedAt: undefined,
      ...input,
    })),
    delete: jest.fn(async (idOrIds: string | string[]) => {
      const ids = Array.isArray(idOrIds) ? idOrIds : [idOrIds];
      let affected = 0;

      for (const id of ids) {
        const index = tasks.findIndex((task) => task.id === id);

        if (index !== -1) {
          tasks.splice(index, 1);
          affected += 1;
        }
      }

      return { affected, raw: undefined };
    }),
    find: jest.fn(async () =>
      [...tasks].sort((left, right) => {
        if (left.position !== right.position) {
          return left.position - right.position;
        }

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
    save: jest.fn(async (taskOrTasks: Task | Task[]) => {
      if (Array.isArray(taskOrTasks)) {
        return taskOrTasks.map(persistTask);
      }

      return persistTask(taskOrTasks);
    }),
  } as unknown as Repository<Task>;

  const aiTaskGenerator = {
    generateTasks: jest.fn(),
  };
  const tasksEventsGateway = {
    emitTasksChanged: jest.fn(),
  };

  return {
    aiTaskGenerator,
    repository,
    service: new TasksService(
      repository,
      aiTaskGenerator as unknown as AiTaskGeneratorService,
      tasksEventsGateway,
    ),
    tasks,
    tasksEventsGateway,
  };
}

describe(TasksService.name, () => {
  it('creates a normalized manual task', async () => {
    const { service, tasksEventsGateway } = createHarness();

    const task = await service.create({ title: '  Book    flights  ' });

    expect(task.title).toBe('Book flights');
    expect(task.description).toBeNull();
    expect(task.label).toBeNull();
    expect(task.parentId).toBeNull();
    expect(task.rootId).toBeNull();
    expect(task.position).toBe(0);
    expect(task.status).toBe('todo');
    expect(task.isCompleted).toBe(false);
    expect(task.isAiGenerated).toBe(false);
    expect(tasksEventsGateway.emitTasksChanged).toHaveBeenCalledWith('created');
  });

  it('lists tasks with newest first', async () => {
    const { service } = createHarness();

    const first = await service.create({ title: 'First task' });
    const second = await service.create({ title: 'Second task' });

    await expect(service.findAll()).resolves.toEqual([second, first]);
  });

  it('updates title, metadata and completion status', async () => {
    const { service, tasksEventsGateway } = createHarness();
    const task = await service.create({ title: 'Pack bags' });
    tasksEventsGateway.emitTasksChanged.mockClear();

    const updated = await service.update(task.id, {
      description: '  Confirm airline baggage policy  ',
      isCompleted: true,
      label: '  Travel   admin ',
      title: '  Pack carry-on bag ',
    });

    expect(updated.title).toBe('Pack carry-on bag');
    expect(updated.description).toBe('Confirm airline baggage policy');
    expect(updated.label).toBe('Travel admin');
    expect(updated.status).toBe('done');
    expect(updated.isCompleted).toBe(true);
    expect(tasksEventsGateway.emitTasksChanged).toHaveBeenCalledWith('updated');
  });

  it('persists reordered tasks', async () => {
    const { service, tasksEventsGateway } = createHarness();

    const first = await service.create({ title: 'First task' });
    const second = await service.create({ title: 'Second task' });
    const third = await service.create({ title: 'Third task' });
    tasksEventsGateway.emitTasksChanged.mockClear();

    const reordered = await service.reorder([first.id, third.id, second.id]);

    expect(reordered.map((task) => task.id)).toEqual([
      first.id,
      third.id,
      second.id,
    ]);
    expect(reordered.map((task) => task.position)).toEqual([0, 1, 2]);
    expect(tasksEventsGateway.emitTasksChanged).toHaveBeenCalledWith(
      'reordered',
    );
  });

  it('moves a task between lanes and persists the full order', async () => {
    const { service, tasksEventsGateway } = createHarness();

    const first = await service.create({ title: 'First task' });
    const second = await service.create({ title: 'Second task' });
    const third = await service.create({ title: 'Third task' });
    tasksEventsGateway.emitTasksChanged.mockClear();

    const moved = await service.move(second.id, {
      orderedIds: [second.id, first.id, third.id],
      status: 'blocked',
    });

    expect(moved.map((task) => task.id)).toEqual([
      second.id,
      first.id,
      third.id,
    ]);
    expect(moved[0]).toMatchObject({
      id: second.id,
      isCompleted: false,
      position: 0,
      status: 'blocked',
    });
    expect(tasksEventsGateway.emitTasksChanged).toHaveBeenCalledWith('moved');
  });

  it('rejects invalid reorder payloads', async () => {
    const { service } = createHarness();

    const first = await service.create({ title: 'First task' });
    const second = await service.create({ title: 'Second task' });

    await expect(service.reorder([first.id, first.id])).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.reorder([first.id])).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.reorder([first.id, 'missing-task'])).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.findAll()).resolves.toHaveLength(2);
    expect(second.id).toBeDefined();
  });

  it('deletes a task', async () => {
    const { service, tasks, tasksEventsGateway } = createHarness();
    const task = await service.create({ title: 'Cancel hotel hold' });
    tasksEventsGateway.emitTasksChanged.mockClear();

    await service.remove(task.id);

    expect(tasks).toHaveLength(0);
    expect(tasksEventsGateway.emitTasksChanged).toHaveBeenCalledWith('deleted');
    await expect(service.remove(task.id)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('persists an AI-generated story and subtasks inside a transaction', async () => {
    const { aiTaskGenerator, repository, service, tasksEventsGateway } =
      createHarness();
    aiTaskGenerator.generateTasks.mockResolvedValue({
      story: {
        description: 'Organize the trip from planning to departure.',
        label: 'Travel',
        title: 'Plan a trip',
      },
      subtasks: [
        {
          description: 'Confirm the best window before booking anything.',
          label: 'Planning',
          title: 'Choose destination dates',
        },
        {
          description: '  Compare nonstop and refundable routes.  ',
          label: '  Flights   ',
          title: 'Compare flight options',
        },
      ],
    });

    const generatedTasks = await service.generateFromGoal({
      goal: 'Plan a trip',
    });

    expect(generatedTasks).toHaveLength(3);
    expect(generatedTasks.every((task) => task.isAiGenerated)).toBe(true);
    expect(generatedTasks[0]).toMatchObject({
      description: 'Organize the trip from planning to departure.',
      label: 'Travel',
      parentId: null,
      title: 'Plan a trip',
    });
    expect(generatedTasks[0].rootId).toBe(generatedTasks[0].id);
    expect(generatedTasks[1]).toMatchObject({
      description: 'Confirm the best window before booking anything.',
      label: 'Planning',
      parentId: generatedTasks[0].id,
      rootId: generatedTasks[0].id,
      title: 'Choose destination dates',
    });
    expect(generatedTasks[2]).toMatchObject({
      description: 'Compare nonstop and refundable routes.',
      label: 'Flights',
      parentId: generatedTasks[0].id,
      rootId: generatedTasks[0].id,
      title: 'Compare flight options',
    });
    expect(repository.manager.transaction).toHaveBeenCalledTimes(1);
    expect(tasksEventsGateway.emitTasksChanged).toHaveBeenCalledWith('generated');
  });

  it('returns an AI draft without persisting tasks', async () => {
    const { aiTaskGenerator, repository, service, tasks, tasksEventsGateway } =
      createHarness();
    aiTaskGenerator.generateTasks.mockResolvedValue({
      story: {
        description: '  Draft story context  ',
        label: '  Draft   ',
        title: '  Draft   plan  ',
      },
      subtasks: [
        {
          description: '  First step context  ',
          label: '  Step   one ',
          title: '  First   step ',
        },
      ],
    });

    const draft = await service.previewFromGoal({ goal: 'Draft plan' });

    expect(draft).toEqual({
      story: {
        description: 'Draft story context',
        label: 'Draft',
        title: 'Draft plan',
      },
      subtasks: [
        {
          description: 'First step context',
          label: 'Step one',
          title: 'First step',
        },
      ],
    });
    expect(tasks).toHaveLength(0);
    expect(repository.manager.transaction).not.toHaveBeenCalled();
    expect(tasksEventsGateway.emitTasksChanged).not.toHaveBeenCalled();
  });

  it('persists an edited AI draft as generated tasks', async () => {
    const { repository, service, tasksEventsGateway } = createHarness();

    const generatedTasks = await service.confirmGeneratedPlan({
      story: {
        description: '  Confirmed story context  ',
        label: '  Product   ',
        title: '  Confirmed   plan ',
      },
      subtasks: [
        {
          description: '  Build the first slice  ',
          label: '  Delivery ',
          title: '  Ship   first slice ',
        },
        {
          description: null,
          label: null,
          title: 'Review result',
        },
      ],
    });

    expect(generatedTasks).toHaveLength(3);
    expect(generatedTasks.every((task) => task.isAiGenerated)).toBe(true);
    expect(generatedTasks[0]).toMatchObject({
      description: 'Confirmed story context',
      label: 'Product',
      parentId: null,
      title: 'Confirmed plan',
    });
    expect(generatedTasks[1]).toMatchObject({
      description: 'Build the first slice',
      label: 'Delivery',
      parentId: generatedTasks[0].id,
      rootId: generatedTasks[0].id,
      title: 'Ship first slice',
    });
    expect(generatedTasks[2]).toMatchObject({
      description: null,
      label: null,
      parentId: generatedTasks[0].id,
      rootId: generatedTasks[0].id,
      title: 'Review result',
    });
    expect(repository.manager.transaction).toHaveBeenCalledTimes(1);
    expect(tasksEventsGateway.emitTasksChanged).toHaveBeenCalledWith('confirmed');
  });

  it('rejects invalid edited AI drafts before persisting', async () => {
    const { repository, service, tasks, tasksEventsGateway } = createHarness();
    const validStory = {
      description: null,
      label: null,
      title: 'Valid story',
    };

    await expect(
      service.confirmGeneratedPlan({
        story: { ...validStory, title: '   ' },
        subtasks: [{ description: null, label: null, title: 'Valid subtask' }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.confirmGeneratedPlan({
        story: validStory,
        subtasks: [],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.confirmGeneratedPlan({
        story: validStory,
        subtasks: [{ description: null, label: null, title: '   ' }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.confirmGeneratedPlan({
        story: validStory,
        subtasks: Array.from({ length: 11 }, (_value, index) => ({
          description: null,
          label: null,
          title: `Subtask ${index}`,
        })),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(tasks).toHaveLength(0);
    expect(repository.manager.transaction).not.toHaveBeenCalled();
    expect(tasksEventsGateway.emitTasksChanged).not.toHaveBeenCalled();
  });

  it('deletes descendants when deleting a parent task', async () => {
    const { service, tasks } = createHarness();
    const parent = await service.create({ title: 'Parent task' });
    const child = await service.create({ title: 'Child task' });
    child.parentId = parent.id;
    child.rootId = parent.id;
    const grandchild = await service.create({ title: 'Nested task' });
    grandchild.parentId = child.id;
    grandchild.rootId = parent.id;

    await service.remove(parent.id);

    expect(tasks).toHaveLength(0);
  });

  it('does not persist tasks when AI generation fails', async () => {
    const { aiTaskGenerator, repository, service, tasks, tasksEventsGateway } =
      createHarness();
    aiTaskGenerator.generateTasks.mockRejectedValue(new Error('provider failed'));

    await expect(
      service.generateFromGoal({ goal: 'Plan a trip' }),
    ).rejects.toThrow('provider failed');

    expect(tasks).toHaveLength(0);
    expect(repository.manager.transaction).not.toHaveBeenCalled();
    expect(tasksEventsGateway.emitTasksChanged).not.toHaveBeenCalled();
  });
});
