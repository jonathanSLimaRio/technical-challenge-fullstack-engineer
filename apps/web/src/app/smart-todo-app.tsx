'use client';

import {
  CheckCircle2,
  Circle,
  KeyRound,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { FormEvent, useMemo, useState } from 'react';
import useSWR from 'swr';
import {
  ApiError,
  createTask,
  deleteTask,
  fetchTasks,
  generateTasks,
  updateTask,
} from '../lib/api';
import type { Task } from '../types/task';

type Feedback = {
  type: 'error' | 'success';
  message: string;
};

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en', {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
  }).format(new Date(value));
}

function getErrorMessage(error: unknown): string {
  if (error instanceof ApiError || error instanceof Error) {
    return error.message;
  }

  return 'Something went wrong. Please try again.';
}

export function SmartTodoApp() {
  const {
    data: tasks = [],
    error,
    isLoading,
    mutate,
  } = useSWR<Task[]>('tasks', fetchTasks);
  const [manualTitle, setManualTitle] = useState('');
  const [goal, setGoal] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [pendingIds, setPendingIds] = useState<Set<string>>(() => new Set());
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const stats = useMemo(() => {
    const completed = tasks.filter((task) => task.isCompleted).length;
    return {
      completed,
      total: tasks.length,
      pending: tasks.length - completed,
    };
  }, [tasks]);

  async function handleCreateTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const title = manualTitle.trim();

    if (!title) {
      return;
    }

    setIsCreating(true);
    setFeedback(null);

    try {
      const createdTask = await createTask(title);
      setManualTitle('');
      await mutate((currentTasks = []) => [createdTask, ...currentTasks], {
        revalidate: false,
      });
      setFeedback({ type: 'success', message: 'Task created.' });
    } catch (requestError) {
      setFeedback({ type: 'error', message: getErrorMessage(requestError) });
    } finally {
      setIsCreating(false);
    }
  }

  async function handleGenerateTasks(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const normalizedGoal = goal.trim();
    const normalizedApiKey = apiKey.trim();

    if (!normalizedGoal || !normalizedApiKey) {
      return;
    }

    setIsGenerating(true);
    setFeedback(null);

    try {
      const generatedTasks = await generateTasks(normalizedGoal, normalizedApiKey);
      setGoal('');
      await mutate((currentTasks = []) => [...generatedTasks, ...currentTasks], {
        revalidate: false,
      });
      setFeedback({
        type: 'success',
        message: `${generatedTasks.length} AI tasks created.`,
      });
    } catch (requestError) {
      setFeedback({ type: 'error', message: getErrorMessage(requestError) });
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleToggleTask(task: Task) {
    const previousTasks = tasks;
    setPending(task.id, true);
    setFeedback(null);

    await mutate(
      tasks.map((item) =>
        item.id === task.id
          ? { ...item, isCompleted: !item.isCompleted }
          : item,
      ),
      { revalidate: false },
    );

    try {
      const updatedTask = await updateTask(task.id, {
        isCompleted: !task.isCompleted,
      });
      await mutate(
        (currentTasks = []) =>
          currentTasks.map((item) =>
            item.id === task.id ? updatedTask : item,
          ),
        { revalidate: false },
      );
    } catch (requestError) {
      await mutate(previousTasks, { revalidate: false });
      setFeedback({ type: 'error', message: getErrorMessage(requestError) });
    } finally {
      setPending(task.id, false);
    }
  }

  async function handleDeleteTask(task: Task) {
    const previousTasks = tasks;
    setPending(task.id, true);
    setFeedback(null);

    await mutate(
      tasks.filter((item) => item.id !== task.id),
      { revalidate: false },
    );

    try {
      await deleteTask(task.id);
      setFeedback({ type: 'success', message: 'Task deleted.' });
    } catch (requestError) {
      await mutate(previousTasks, { revalidate: false });
      setFeedback({ type: 'error', message: getErrorMessage(requestError) });
    } finally {
      setPending(task.id, false);
    }
  }

  function setPending(id: string, isPending: boolean) {
    setPendingIds((current) => {
      const next = new Set(current);

      if (isPending) {
        next.add(id);
      } else {
        next.delete(id);
      }

      return next;
    });
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">AI task decomposition</p>
          <h1>Smart To-Do List</h1>
          <p className="subtitle">
            Turn broad goals into focused tasks and keep the list moving.
          </p>
        </div>
        <div className="summary-strip" aria-label="Task summary">
          <span>
            <strong>{stats.total}</strong>
            total
          </span>
          <span>
            <strong>{stats.pending}</strong>
            pending
          </span>
          <span>
            <strong>{stats.completed}</strong>
            done
          </span>
        </div>
      </header>

      <div className="workspace">
        <aside className="control-stack" aria-label="Task controls">
          <form className="surface" onSubmit={handleCreateTask}>
            <div className="form-heading">
              <Plus size={18} aria-hidden="true" />
              <h2>Manual task</h2>
            </div>
            <label htmlFor="manual-title">Title</label>
            <input
              id="manual-title"
              maxLength={160}
              onChange={(event) => setManualTitle(event.target.value)}
              placeholder="Book flights"
              type="text"
              value={manualTitle}
            />
            <button
              className="button primary"
              disabled={isCreating || !manualTitle.trim()}
              type="submit"
            >
              {isCreating ? (
                <Loader2 className="spin" size={18} aria-hidden="true" />
              ) : (
                <Plus size={18} aria-hidden="true" />
              )}
              Add task
            </button>
          </form>

          <form className="surface" onSubmit={handleGenerateTasks}>
            <div className="form-heading">
              <Sparkles size={18} aria-hidden="true" />
              <h2>AI planner</h2>
            </div>
            <label htmlFor="goal">Goal</label>
            <textarea
              id="goal"
              maxLength={500}
              onChange={(event) => setGoal(event.target.value)}
              placeholder="Plan a five-day trip to Buenos Aires"
              rows={5}
              value={goal}
            />
            <label htmlFor="api-key">Provider API key</label>
            <div className="key-field">
              <KeyRound size={17} aria-hidden="true" />
              <input
                id="api-key"
                onChange={(event) => setApiKey(event.target.value)}
                placeholder="sk-or-..."
                type="password"
                value={apiKey}
              />
            </div>
            <button
              className="button accent"
              disabled={isGenerating || !goal.trim() || !apiKey.trim()}
              type="submit"
            >
              {isGenerating ? (
                <Loader2 className="spin" size={18} aria-hidden="true" />
              ) : (
                <Sparkles size={18} aria-hidden="true" />
              )}
              Generate tasks
            </button>
          </form>
        </aside>

        <section className="task-area" aria-label="Tasks">
          <div className="task-toolbar">
            <div>
              <p className="eyebrow">Current list</p>
              <h2>Tasks</h2>
            </div>
            <button
              className="button ghost"
              disabled={isLoading}
              onClick={() => void mutate()}
              type="button"
            >
              Refresh
            </button>
          </div>

          {feedback ? (
            <div className={`feedback ${feedback.type}`} role="status">
              {feedback.message}
            </div>
          ) : null}

          {error ? (
            <div className="feedback error" role="alert">
              {getErrorMessage(error)}
            </div>
          ) : null}

          {isLoading ? <TaskSkeleton /> : null}

          {!isLoading && !error && tasks.length === 0 ? (
            <div className="empty-state">
              <Sparkles size={24} aria-hidden="true" />
              <h3>No tasks yet</h3>
              <p>Create a task or generate a plan from a goal.</p>
            </div>
          ) : null}

          {!isLoading && tasks.length > 0 ? (
            <ul className="task-list">
              {tasks.map((task) => {
                const isPending = pendingIds.has(task.id);
                return (
                  <li
                    className={task.isCompleted ? 'task done' : 'task'}
                    key={task.id}
                  >
                    <button
                      className="icon-button"
                      disabled={isPending}
                      onClick={() => void handleToggleTask(task)}
                      title={task.isCompleted ? 'Mark pending' : 'Mark done'}
                      type="button"
                    >
                      {task.isCompleted ? (
                        <CheckCircle2 size={22} aria-hidden="true" />
                      ) : (
                        <Circle size={22} aria-hidden="true" />
                      )}
                      <span className="sr-only">
                        {task.isCompleted ? 'Mark pending' : 'Mark done'}
                      </span>
                    </button>

                    <div className="task-content">
                      <p>{task.title}</p>
                      <div className="task-meta">
                        <span className={task.isAiGenerated ? 'badge ai' : 'badge'}>
                          {task.isAiGenerated ? 'AI' : 'Manual'}
                        </span>
                        <span>{formatDate(task.createdAt)}</span>
                      </div>
                    </div>

                    <button
                      className="icon-button danger"
                      disabled={isPending}
                      onClick={() => void handleDeleteTask(task)}
                      title="Delete task"
                      type="button"
                    >
                      {isPending ? (
                        <Loader2 className="spin" size={20} aria-hidden="true" />
                      ) : (
                        <Trash2 size={20} aria-hidden="true" />
                      )}
                      <span className="sr-only">Delete task</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </section>
      </div>
    </main>
  );
}

function TaskSkeleton() {
  return (
    <div className="skeleton-stack" aria-label="Loading tasks">
      <div />
      <div />
      <div />
    </div>
  );
}
