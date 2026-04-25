'use client';

import {
  AlertCircle,
  BarChart3,
  CheckCircle2,
  Circle,
  Clock3,
  KeyRound,
  LayoutList,
  Loader2,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
  Wand2,
  X,
} from 'lucide-react';
import type { FormEvent, ReactNode } from 'react';
import { useEffect, useId, useMemo, useState } from 'react';
import { io } from 'socket.io-client';
import useSWR from 'swr';
import {
  ApiError,
  createTask,
  deleteTask,
  fetchTasks,
  generateTasks,
  getApiOrigin,
  updateTask,
} from '../lib/api';
import type { Task } from '../types/task';

type Feedback = {
  type: 'error' | 'success';
  message: string;
};

type TaskFilter = 'all' | 'pending' | 'done' | 'ai';

const GOAL_MAX_LENGTH = 500;
const TASK_MAX_LENGTH = 160;

const tooltipCopy = {
  addTask: 'Save this manual task in the execution queue.',
  aiFilter: 'Show tasks created by AI.',
  apiKey: 'Used only for this generation request and never stored by the app.',
  cancelDelete: 'Keep this task and close confirmation.',
  completionMetric: 'Percentage of tasks marked complete.',
  confirmDelete: 'Permanently remove this task.',
  deleteTask: 'Ask for confirmation before deleting this task.',
  doneFilter: 'Show completed tasks only.',
  doneMetric: 'Tasks already marked complete.',
  generateTasks: 'Create and save AI-suggested tasks from this goal.',
  goal: 'Describe one concrete outcome. AI turns it into saved tasks.',
  markDone: 'Mark this task as complete.',
  markPending: 'Move this task back to pending.',
  pendingFilter: 'Show open tasks only.',
  pendingMetric: 'Tasks still waiting to be completed.',
  refresh: 'Reload tasks from the API.',
  retry: 'Reload tasks from the API.',
  showAll: 'Show every task.',
  syncOffline: 'Realtime connection is offline; refresh manually if needed.',
  syncOnline: 'New task changes are syncing in real time.',
  taskTitle: 'Write one small task to add manually.',
  totalFilter: 'Show every task.',
  totalMetric: 'Count of all saved tasks.',
};

const describedBy = (
  tooltipId: string,
  existingDescriptionId?: string,
): string =>
  existingDescriptionId
    ? `${existingDescriptionId} ${tooltipId}`
    : tooltipId;

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

function getFilteredTasks(tasks: Task[], filter: TaskFilter): Task[] {
  if (filter === 'pending') {
    return tasks.filter((task) => !task.isCompleted);
  }

  if (filter === 'done') {
    return tasks.filter((task) => task.isCompleted);
  }

  if (filter === 'ai') {
    return tasks.filter((task) => task.isAiGenerated);
  }

  return tasks;
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
  const [activeFilter, setActiveFilter] = useState<TaskFilter>('all');
  const [isCreating, setIsCreating] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [pendingIds, setPendingIds] = useState<Set<string>>(() => new Set());
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(
    null,
  );
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [isRealtimeConnected, setIsRealtimeConnected] = useState(false);

  const stats = useMemo(() => {
    const completed = tasks.filter((task) => task.isCompleted).length;
    const aiGenerated = tasks.filter((task) => task.isAiGenerated).length;
    const pending = tasks.length - completed;

    return {
      aiGenerated,
      completed,
      completionRate:
        tasks.length > 0 ? Math.round((completed / tasks.length) * 100) : 0,
      pending,
      total: tasks.length,
    };
  }, [tasks]);

  const filteredTasks = useMemo(
    () => getFilteredTasks(tasks, activeFilter),
    [activeFilter, tasks],
  );

  const filters = useMemo(
    () => [
      {
        count: stats.total,
        icon: <LayoutList size={16} aria-hidden="true" />,
        label: 'All',
        tooltip: tooltipCopy.totalFilter,
        value: 'all' as const,
      },
      {
        count: stats.pending,
        icon: <Circle size={16} aria-hidden="true" />,
        label: 'Pending',
        tooltip: tooltipCopy.pendingFilter,
        value: 'pending' as const,
      },
      {
        count: stats.completed,
        icon: <CheckCircle2 size={16} aria-hidden="true" />,
        label: 'Done',
        tooltip: tooltipCopy.doneFilter,
        value: 'done' as const,
      },
      {
        count: stats.aiGenerated,
        icon: <Sparkles size={16} aria-hidden="true" />,
        label: 'AI',
        tooltip: tooltipCopy.aiFilter,
        value: 'ai' as const,
      },
    ],
    [stats],
  );

  useEffect(() => {
    const socket = io(getApiOrigin(), {
      reconnectionAttempts: 5,
      transports: ['websocket', 'polling'],
    });

    socket.on('connect', () => setIsRealtimeConnected(true));
    socket.on('disconnect', () => setIsRealtimeConnected(false));
    socket.on('tasks:changed', () => {
      void mutate();
    });

    return () => {
      socket.disconnect();
    };
  }, [mutate]);

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
      setActiveFilter('all');
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
      setActiveFilter('all');
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
      setConfirmingDeleteId(null);
      setFeedback({ type: 'success', message: 'Task deleted.' });
    } catch (requestError) {
      await mutate(previousTasks, { revalidate: false });
      setFeedback({ type: 'error', message: getErrorMessage(requestError) });
    } finally {
      setPending(task.id, false);
    }
  }

  function handleStartDelete(taskId: string) {
    setConfirmingDeleteId(taskId);
    setFeedback(null);
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
        <div className="brand-lockup">
          <span className="logo-mark" aria-hidden="true">
            <Sparkles size={20} />
          </span>
          <div>
            <p className="eyebrow">AI task decomposition</p>
            <h1>Smart To-Do List</h1>
          </div>
        </div>

        <p className="header-copy">
          Break large goals into clean next steps, then keep execution visible
          from first draft to done.
        </p>
      </header>

      <div className="workspace">
        <aside className="control-rail" aria-label="Task controls">
          <section className="planner-panel" aria-labelledby="planner-title">
            <div className="panel-heading">
              <span className="panel-icon" aria-hidden="true">
                <Wand2 size={19} />
              </span>
              <div>
                <p className="eyebrow">Primary workflow</p>
                <h2 id="planner-title">Generate a focused plan</h2>
              </div>
            </div>

            <form className="form-grid" onSubmit={handleGenerateTasks}>
              <div className="field-group">
                <div className="label-row">
                  <label htmlFor="goal">Goal</label>
                  <span>{goal.length}/{GOAL_MAX_LENGTH}</span>
                </div>
                <Tooltip className="tooltip-fill" content={tooltipCopy.goal}>
                  {(tooltipId) => (
                    <textarea
                      aria-describedby={describedBy(tooltipId, 'goal-helper')}
                      id="goal"
                      maxLength={GOAL_MAX_LENGTH}
                      onChange={(event) => setGoal(event.target.value)}
                      placeholder="Plan a five-day trip to Buenos Aires"
                      rows={6}
                      value={goal}
                    />
                  )}
                </Tooltip>
                <p className="field-hint" id="goal-helper">
                  Use one concrete outcome. The API will create the tasks and
                  save them here.
                </p>
              </div>

              <div className="field-group">
                <label htmlFor="api-key">Provider API key</label>
                <div className="key-field">
                  <KeyRound size={17} aria-hidden="true" />
                  <Tooltip
                    className="tooltip-fill"
                    content={tooltipCopy.apiKey}
                  >
                    {(tooltipId) => (
                      <input
                        aria-describedby={describedBy(
                          tooltipId,
                          'api-key-helper',
                        )}
                        autoComplete="new-password"
                        id="api-key"
                        onChange={(event) => setApiKey(event.target.value)}
                        placeholder="sk-or-..."
                        type="password"
                        value={apiKey}
                      />
                    )}
                  </Tooltip>
                </div>
                <p className="field-hint secure" id="api-key-helper">
                  <ShieldCheck size={15} aria-hidden="true" />
                  Sent only with this request. It is not stored by the app.
                </p>
              </div>

              <Tooltip
                className="tooltip-fill"
                content={tooltipCopy.generateTasks}
              >
                {(tooltipId) => (
                  <button
                    aria-describedby={tooltipId}
                    className="button primary wide"
                    disabled={isGenerating || !goal.trim() || !apiKey.trim()}
                    type="submit"
                  >
                    {isGenerating ? (
                      <Loader2 className="spin" size={18} aria-hidden="true" />
                    ) : (
                      <Sparkles size={18} aria-hidden="true" />
                    )}
                    {isGenerating ? 'Generating plan...' : 'Generate tasks'}
                  </button>
                )}
              </Tooltip>
            </form>
          </section>

          <section className="quick-add-panel" aria-labelledby="quick-add-title">
            <div className="panel-heading compact">
              <span className="panel-icon soft" aria-hidden="true">
                <Plus size={18} />
              </span>
              <div>
                <p className="eyebrow">Quick capture</p>
                <h2 id="quick-add-title">Add one task</h2>
              </div>
            </div>

            <form className="form-grid" onSubmit={handleCreateTask}>
              <div className="field-group">
                <div className="label-row">
                  <label htmlFor="manual-title">Task title</label>
                  <span>{manualTitle.length}/{TASK_MAX_LENGTH}</span>
                </div>
                <Tooltip
                  className="tooltip-fill"
                  content={tooltipCopy.taskTitle}
                >
                  {(tooltipId) => (
                    <input
                      aria-describedby={tooltipId}
                      id="manual-title"
                      maxLength={TASK_MAX_LENGTH}
                      onChange={(event) => setManualTitle(event.target.value)}
                      placeholder="Book flights"
                      type="text"
                      value={manualTitle}
                    />
                  )}
                </Tooltip>
              </div>
              <Tooltip className="tooltip-fill" content={tooltipCopy.addTask}>
                {(tooltipId) => (
                  <button
                    aria-describedby={tooltipId}
                    className="button secondary wide"
                    disabled={isCreating || !manualTitle.trim()}
                    type="submit"
                  >
                    {isCreating ? (
                      <Loader2 className="spin" size={18} aria-hidden="true" />
                    ) : (
                      <Plus size={18} aria-hidden="true" />
                    )}
                    {isCreating ? 'Adding task...' : 'Add task'}
                  </button>
                )}
              </Tooltip>
            </form>
          </section>
        </aside>

        <section className="task-area" aria-label="Tasks">
          <div className="metrics-grid" aria-label="Task summary">
            <MetricCard
              icon={<LayoutList size={18} aria-hidden="true" />}
              label="Total"
              tooltip={tooltipCopy.totalMetric}
              value={stats.total}
            />
            <MetricCard
              icon={<Circle size={18} aria-hidden="true" />}
              label="Pending"
              tone="warning"
              tooltip={tooltipCopy.pendingMetric}
              value={stats.pending}
            />
            <MetricCard
              icon={<CheckCircle2 size={18} aria-hidden="true" />}
              label="Done"
              tone="success"
              tooltip={tooltipCopy.doneMetric}
              value={stats.completed}
            />
            <MetricCard
              icon={<BarChart3 size={18} aria-hidden="true" />}
              label="Completion"
              suffix="%"
              tone="accent"
              tooltip={tooltipCopy.completionMetric}
              value={stats.completionRate}
            />
          </div>

          <div className="list-panel">
            <div className="task-toolbar">
              <div>
                <p className="eyebrow">Current list</p>
                <h2>Execution queue</h2>
              </div>

              <div className="toolbar-actions">
                <Tooltip
                  className="tooltip-control"
                  content={
                    isRealtimeConnected
                      ? tooltipCopy.syncOnline
                      : tooltipCopy.syncOffline
                  }
                >
                  {(tooltipId) => (
                    <span
                      aria-describedby={tooltipId}
                      className={
                        isRealtimeConnected
                          ? 'sync-pill connected'
                          : 'sync-pill'
                      }
                      tabIndex={0}
                    >
                      {isRealtimeConnected ? 'Live sync' : 'Sync offline'}
                    </span>
                  )}
                </Tooltip>
                <Tooltip
                  className="tooltip-control tooltip-end"
                  content={tooltipCopy.refresh}
                >
                  {(tooltipId) => (
                    <button
                      aria-describedby={tooltipId}
                      className="icon-button neutral"
                      disabled={isLoading}
                      onClick={() => void mutate()}
                      type="button"
                    >
                      <RefreshCw
                        className={isLoading ? 'spin' : undefined}
                        size={19}
                        aria-hidden="true"
                      />
                      <span className="sr-only">Refresh tasks</span>
                    </button>
                  )}
                </Tooltip>
              </div>
            </div>

            <div className="filter-tabs" aria-label="Filter tasks">
              {filters.map((filter) => (
                <Tooltip
                  className="tooltip-fill"
                  content={filter.tooltip}
                  key={filter.value}
                >
                  {(tooltipId) => (
                    <button
                      aria-describedby={tooltipId}
                      aria-pressed={activeFilter === filter.value}
                      className={
                        activeFilter === filter.value
                          ? 'filter-tab active'
                          : 'filter-tab'
                      }
                      onClick={() => setActiveFilter(filter.value)}
                      type="button"
                    >
                      {filter.icon}
                      <span>{filter.label}</span>
                      <strong>{filter.count}</strong>
                    </button>
                  )}
                </Tooltip>
              ))}
            </div>

            {feedback ? <FeedbackBanner feedback={feedback} /> : null}

            {error ? (
              <div className="feedback error" role="alert">
                <AlertCircle size={18} aria-hidden="true" />
                <span>{getErrorMessage(error)}</span>
                <Tooltip
                  className="tooltip-control tooltip-end feedback-action"
                  content={tooltipCopy.retry}
                >
                  {(tooltipId) => (
                    <button
                      aria-describedby={tooltipId}
                      className="text-button"
                      onClick={() => void mutate()}
                      type="button"
                    >
                      <RefreshCw size={15} aria-hidden="true" />
                      Retry
                    </button>
                  )}
                </Tooltip>
              </div>
            ) : null}

            <div className="list-state" aria-busy={isLoading}>
              {isLoading ? <TaskSkeleton /> : null}

              {!isLoading && !error && tasks.length === 0 ? (
                <EmptyState
                  description="Generate a plan from a goal or capture the first manual task."
                  title="Your queue is ready"
                />
              ) : null}

              {!isLoading &&
              !error &&
              tasks.length > 0 &&
              filteredTasks.length === 0 ? (
                <EmptyState
                  actionIcon={<LayoutList size={18} aria-hidden="true" />}
                  actionLabel="Show all tasks"
                  actionTooltip={tooltipCopy.showAll}
                  description="There are no tasks in this view yet."
                  onAction={() => setActiveFilter('all')}
                  title={`No ${activeFilter} tasks`}
                />
              ) : null}

              {!isLoading && filteredTasks.length > 0 ? (
                <ul className="task-list">
                  {filteredTasks.map((task) => {
                    const isPending = pendingIds.has(task.id);
                    const isConfirmingDelete = confirmingDeleteId === task.id;

                    return (
                      <li
                        className={task.isCompleted ? 'task-card done' : 'task-card'}
                        key={task.id}
                      >
                        <Tooltip
                          className="tooltip-control"
                          content={
                            task.isCompleted
                              ? tooltipCopy.markPending
                              : tooltipCopy.markDone
                          }
                        >
                          {(tooltipId) => (
                            <button
                              aria-describedby={tooltipId}
                              className="toggle-button"
                              disabled={isPending}
                              onClick={() => void handleToggleTask(task)}
                              type="button"
                            >
                              {task.isCompleted ? (
                                <CheckCircle2 size={23} aria-hidden="true" />
                              ) : (
                                <Circle size={23} aria-hidden="true" />
                              )}
                              <span className="sr-only">
                                {task.isCompleted
                                  ? 'Mark pending'
                                  : 'Mark done'}
                              </span>
                            </button>
                          )}
                        </Tooltip>

                        <div className="task-content">
                          <p>{task.title}</p>
                          <div className="task-meta">
                            <span
                              className={
                                task.isAiGenerated ? 'badge ai' : 'badge'
                              }
                            >
                              {task.isAiGenerated ? 'AI generated' : 'Manual'}
                            </span>
                            <span>
                              <Clock3 size={14} aria-hidden="true" />
                              {formatDate(task.createdAt)}
                            </span>
                          </div>
                        </div>

                        {isConfirmingDelete ? (
                          <div className="confirm-actions">
                            <Tooltip
                              className="tooltip-control"
                              content={tooltipCopy.confirmDelete}
                            >
                              {(tooltipId) => (
                                <button
                                  aria-describedby={tooltipId}
                                  className="mini-button danger"
                                  disabled={isPending}
                                  onClick={() => void handleDeleteTask(task)}
                                  type="button"
                                >
                                  {isPending ? (
                                    <Loader2
                                      className="spin"
                                      size={16}
                                      aria-hidden="true"
                                    />
                                  ) : (
                                    <Trash2 size={16} aria-hidden="true" />
                                  )}
                                  Delete
                                </button>
                              )}
                            </Tooltip>
                            <Tooltip
                              className="tooltip-control tooltip-end"
                              content={tooltipCopy.cancelDelete}
                            >
                              {(tooltipId) => (
                                <button
                                  aria-describedby={tooltipId}
                                  className="icon-button neutral small"
                                  disabled={isPending}
                                  onClick={() => setConfirmingDeleteId(null)}
                                  type="button"
                                >
                                  <X size={17} aria-hidden="true" />
                                  <span className="sr-only">Cancel delete</span>
                                </button>
                              )}
                            </Tooltip>
                          </div>
                        ) : (
                          <Tooltip
                            className="tooltip-control tooltip-end"
                            content={tooltipCopy.deleteTask}
                          >
                            {(tooltipId) => (
                              <button
                                aria-describedby={tooltipId}
                                className="icon-button danger"
                                disabled={isPending}
                                onClick={() => handleStartDelete(task.id)}
                                type="button"
                              >
                                {isPending ? (
                                  <Loader2
                                    className="spin"
                                    size={19}
                                    aria-hidden="true"
                                  />
                                ) : (
                                  <Trash2 size={19} aria-hidden="true" />
                                )}
                                <span className="sr-only">Delete task</span>
                              </button>
                            )}
                          </Tooltip>
                        )}
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function MetricCard({
  icon,
  label,
  suffix = '',
  tone = 'default',
  tooltip,
  value,
}: {
  icon: ReactNode;
  label: string;
  suffix?: string;
  tone?: 'accent' | 'default' | 'success' | 'warning';
  tooltip: string;
  value: number;
}) {
  return (
    <Tooltip className="tooltip-fill" content={tooltip}>
      {(tooltipId) => (
        <div
          aria-describedby={tooltipId}
          aria-label={`${label}: ${value}${suffix}`}
          className={`metric-card ${tone}`}
          role="group"
          tabIndex={0}
        >
          <span className="metric-card-header">
            {icon}
            {label}
          </span>
          <strong>
            {value}
            {suffix}
          </strong>
        </div>
      )}
    </Tooltip>
  );
}

function FeedbackBanner({ feedback }: { feedback: Feedback }) {
  return (
    <div className={`feedback ${feedback.type}`} role="status">
      {feedback.type === 'success' ? (
        <CheckCircle2 size={18} aria-hidden="true" />
      ) : (
        <AlertCircle size={18} aria-hidden="true" />
      )}
      <span>{feedback.message}</span>
    </div>
  );
}

function EmptyState({
  actionIcon,
  actionLabel,
  actionTooltip,
  description,
  onAction,
  title,
}: {
  actionIcon?: ReactNode;
  actionLabel?: string;
  actionTooltip?: string;
  description: string;
  onAction?: () => void;
  title: string;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon" aria-hidden="true">
        <LayoutList size={24} />
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
      {actionLabel && onAction ? (
        <Tooltip
          className="tooltip-control"
          content={actionTooltip ?? actionLabel}
        >
          {(tooltipId) => (
            <button
              aria-describedby={tooltipId}
              className="button tertiary"
              onClick={onAction}
              type="button"
            >
              {actionIcon}
              {actionLabel}
            </button>
          )}
        </Tooltip>
      ) : null}
    </div>
  );
}

function Tooltip({
  children,
  className = '',
  content,
}: {
  children: (tooltipId: string) => ReactNode;
  className?: string;
  content: string;
}) {
  const tooltipId = useId();

  return (
    <span className={`tooltip-wrap ${className}`.trim()}>
      {children(tooltipId)}
      <span className="tooltip-bubble" id={tooltipId} role="tooltip">
        {content}
      </span>
    </span>
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
