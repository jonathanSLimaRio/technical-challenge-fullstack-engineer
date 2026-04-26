'use client';

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  type DragEndEvent,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  AlertCircle,
  BarChart3,
  ChevronDown,
  CheckCircle2,
  Circle,
  Clock3,
  FileText,
  GripVertical,
  LayoutList,
  ListChecks,
  Loader2,
  Moon,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  Sun,
  Tag,
  Trash2,
  Wand2,
  X,
} from 'lucide-react';
import type { CSSProperties, FormEvent, ReactNode } from 'react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import useSWR from 'swr';
import {
  ApiError,
  createTask,
  deleteTask,
  fetchTasks,
  generateTasks,
  getApiOrigin,
  moveTask,
  updateTask,
} from '../lib/api';
import { TASK_STATUSES, type Task, type TaskStatus } from '../types/task';
import { ToastViewport, useToastQueue } from './toast';
import type { Theme } from './theme';
import { useThemePreference } from './use-theme-preference';

type TaskFilter = 'all' | 'pending' | 'done' | 'ai';
type TaskLane = {
  label: string;
  status: TaskStatus;
};

const GOAL_MAX_LENGTH = 500;
const TASK_DESCRIPTION_MAX_LENGTH = 1000;
const TASK_LABEL_MAX_LENGTH = 40;
const TASK_MAX_LENGTH = 160;
const DONE_STATUS: TaskStatus = 'done';

const TASK_LANES: TaskLane[] = [
  { label: 'A Fazer', status: 'todo' },
  { label: 'Fazendo', status: 'doing' },
  { label: 'Block', status: 'blocked' },
  { label: 'Concluído', status: 'done' },
];

const TASK_STATUS_LABELS: Record<TaskStatus, string> = TASK_LANES.reduce(
  (labels, lane) => ({ ...labels, [lane.status]: lane.label }),
  {} as Record<TaskStatus, string>,
);
const TASK_STATUS_SET = new Set<string>(TASK_STATUSES);

const tooltipCopy = {
  aiFilter: 'Mostrar tarefas criadas pela IA.',
  cancelDelete: 'Manter esta tarefa e fechar a confirmação.',
  completionMetric: 'Percentual de tarefas marcadas como concluídas.',
  createTaskDetails: 'Criar tarefa com título, conteúdo e etiqueta.',
  confirmDelete: 'Remover esta tarefa permanentemente.',
  deleteTask: 'Pedir confirmação antes de excluir esta tarefa.',
  doneFilter: 'Mostrar apenas tarefas concluídas.',
  doneMetric: 'Tarefas já marcadas como concluídas.',
  dragTask: 'Arrastar para mover entre raias ou reordenar a fila.',
  generateTasks:
    'Criar e salvar tarefas sugeridas pela IA a partir deste objetivo.',
  goal: 'Descreva um resultado concreto. A IA transforma isso em tarefas salvas.',
  markDone: 'Marcar esta tarefa como concluída.',
  markPending: 'Mover esta tarefa de volta para pendente.',
  pendingFilter: 'Mostrar apenas tarefas em aberto.',
  pendingMetric: 'Tarefas ainda aguardando conclusão.',
  refresh: 'Recarregar tarefas da API.',
  retry: 'Recarregar tarefas da API.',
  quickCapture: 'Abrir captura rápida de tarefa.',
  showAll: 'Mostrar todas as tarefas.',
  syncOffline:
    'A conexão em tempo real está offline; atualize manualmente se precisar.',
  syncOnline: 'As alterações nas tarefas estão sincronizando em tempo real.',
  taskTitle: 'Escreva uma pequena tarefa para adicionar manualmente.',
  themeDark: 'Usar o tema dark.',
  themeLight: 'Usar o tema light.',
  totalFilter: 'Mostrar todas as tarefas.',
  totalMetric: 'Contagem de todas as tarefas salvas.',
  updateTaskDetails: 'Salvar descrição e etiqueta desta tarefa.',
};

const emptyFilterTitles: Record<TaskFilter, string> = {
  ai: 'Nenhuma tarefa da IA',
  all: 'Nenhuma tarefa',
  done: 'Nenhuma tarefa concluída',
  pending: 'Nenhuma tarefa pendente',
};

const describedBy = (
  tooltipId: string,
  existingDescriptionId?: string,
): string =>
  existingDescriptionId
    ? `${existingDescriptionId} ${tooltipId}`
    : tooltipId;

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
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

  return 'Algo deu errado. Tente novamente.';
}

function getRootTasks(tasks: Task[]): Task[] {
  return tasks.filter((task) => !task.parentId);
}

function getTasksByParent(tasks: Task[]): Map<string, Task[]> {
  const tasksByParent = new Map<string, Task[]>();

  for (const task of tasks) {
    if (!task.parentId) {
      continue;
    }

    const siblings = tasksByParent.get(task.parentId) ?? [];
    siblings.push(task);
    tasksByParent.set(task.parentId, siblings);
  }

  for (const siblings of tasksByParent.values()) {
    siblings.sort((left, right) => {
      if (left.position !== right.position) {
        return left.position - right.position;
      }

      return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
    });
  }

  return tasksByParent;
}

function isStoryComplete(task: Task, subtasks: Task[]): boolean {
  if (subtasks.length === 0) {
    return getTaskStatus(task) === DONE_STATUS;
  }

  return subtasks.every((subtask) => getTaskStatus(subtask) === DONE_STATUS);
}

function getFilteredRootTasks(
  rootTasks: Task[],
  tasksByParent: Map<string, Task[]>,
  filter: TaskFilter,
): Task[] {
  if (filter === 'ai') {
    return rootTasks.filter((task) => {
      const subtasks = tasksByParent.get(task.id) ?? [];
      return task.isAiGenerated || subtasks.some((subtask) => subtask.isAiGenerated);
    });
  }

  if (filter === 'pending') {
    return rootTasks.filter(
      (task) => !isStoryComplete(task, tasksByParent.get(task.id) ?? []),
    );
  }

  if (filter === 'done') {
    return rootTasks.filter((task) =>
      isStoryComplete(task, tasksByParent.get(task.id) ?? []),
    );
  }

  return rootTasks;
}

function getDescendantIds(id: string, tasks: Task[]): Set<string> {
  const ids = new Set<string>([id]);
  let changed = true;

  while (changed) {
    changed = false;

    for (const task of tasks) {
      if (task.parentId && ids.has(task.parentId) && !ids.has(task.id)) {
        ids.add(task.id);
        changed = true;
      }
    }
  }

  return ids;
}

function mergeRootTasks(tasks: Task[], rootTasks: Task[]): Task[] {
  const rootIds = new Set(rootTasks.map((task) => task.id));

  return [...rootTasks, ...tasks.filter((task) => !rootIds.has(task.id))];
}

function getVisibleLanes(filter: TaskFilter): TaskLane[] {
  if (filter === 'pending') {
    return TASK_LANES.filter((lane) => lane.status !== DONE_STATUS);
  }

  if (filter === 'done') {
    return TASK_LANES.filter((lane) => lane.status === DONE_STATUS);
  }

  return TASK_LANES;
}

function getTaskStatus(task: Task): TaskStatus {
  return task.status ?? (task.isCompleted ? DONE_STATUS : 'todo');
}

function isTaskStatus(value: string): value is TaskStatus {
  return TASK_STATUS_SET.has(value);
}

function withTaskStatus(task: Task, status: TaskStatus): Task {
  return {
    ...task,
    status,
    isCompleted: status === DONE_STATUS,
  };
}

function getTasksByStatus(tasks: Task[]): Record<TaskStatus, Task[]> {
  const grouped: Record<TaskStatus, Task[]> = {
    blocked: [],
    doing: [],
    done: [],
    todo: [],
  };

  for (const task of tasks) {
    grouped[getTaskStatus(task)].push(task);
  }

  return grouped;
}

function getDragTargetStatus(tasks: Task[], overId: string): TaskStatus | null {
  if (isTaskStatus(overId)) {
    return overId;
  }

  const task = tasks.find((item) => item.id === overId);
  return task ? getTaskStatus(task) : null;
}

function getMovedTasks(
  tasks: Task[],
  activeId: string,
  overId: string,
  targetStatus: TaskStatus,
): Task[] {
  const activeTask = tasks.find((task) => task.id === activeId);

  if (!activeTask) {
    return tasks;
  }

  const sourceStatus = getTaskStatus(activeTask);
  const grouped = getTasksByStatus(tasks);

  if (sourceStatus === targetStatus && !isTaskStatus(overId)) {
    const laneTasks = grouped[sourceStatus];
    const activeIndex = laneTasks.findIndex((task) => task.id === activeId);
    const overIndex = laneTasks.findIndex((task) => task.id === overId);

    if (activeIndex >= 0 && overIndex >= 0) {
      grouped[sourceStatus] = arrayMove(laneTasks, activeIndex, overIndex).map(
        (task) => (task.id === activeId ? withTaskStatus(task, targetStatus) : task),
      );

      return TASK_STATUSES.flatMap((status) => grouped[status]);
    }
  }

  grouped[sourceStatus] = grouped[sourceStatus].filter(
    (task) => task.id !== activeId,
  );

  const movedTask = withTaskStatus(activeTask, targetStatus);
  const targetTasks = grouped[targetStatus];
  const targetIndex = isTaskStatus(overId)
    ? targetTasks.length
    : targetTasks.findIndex((task) => task.id === overId);

  targetTasks.splice(
    targetIndex >= 0 ? targetIndex : targetTasks.length,
    0,
    movedTask,
  );

  return TASK_STATUSES.flatMap((status) => grouped[status]);
}

function getNormalizedTaskInput(
  title: string,
  description: string,
  label: string,
) {
  return {
    title: title.trim().replace(/\s+/g, ' '),
    description: description.trim(),
    label: label.trim().replace(/\s+/g, ' '),
  };
}

function getTaskPreviewContent(
  task: Task,
  status: TaskStatus,
  description: string | undefined,
  label: string | undefined,
): ReactNode {
  return (
    <span className="task-preview-tooltip">
      <strong>{task.title}</strong>
      <span>{description || 'Sem descrição adicionada.'}</span>
      <span className="task-preview-tooltip-meta">
        <span>{TASK_STATUS_LABELS[status]}</span>
        <span>{task.isAiGenerated ? 'Gerada por IA' : 'Manual'}</span>
        <span>{label || 'Sem etiqueta'}</span>
        <span>{formatDate(task.createdAt)}</span>
      </span>
    </span>
  );
}

export function SmartTodoApp() {
  const {
    data: tasks = [],
    error,
    isLoading,
    mutate,
  } = useSWR<Task[]>('tasks', fetchTasks);
  const [manualTitle, setManualTitle] = useState('');
  const [manualDescription, setManualDescription] = useState('');
  const [manualLabel, setManualLabel] = useState('');
  const [goal, setGoal] = useState('');
  const [activeFilter, setActiveFilter] = useState<TaskFilter>('all');
  const [isQuickCaptureOpen, setIsQuickCaptureOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [pendingIds, setPendingIds] = useState<Set<string>>(() => new Set());
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(
    null,
  );
  const [expandedTaskIds, setExpandedTaskIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editLabel, setEditLabel] = useState('');
  const [isRealtimeConnected, setIsRealtimeConnected] = useState(false);
  const [isReordering, setIsReordering] = useState(false);
  const [isSavingTaskDetails, setIsSavingTaskDetails] = useState(false);
  const [theme, setThemePreference] = useThemePreference();
  const { dismissToast, showToast, toasts } = useToastQueue();
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 6,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const stats = useMemo(() => {
    const completed = tasks.filter(
      (task) => getTaskStatus(task) === DONE_STATUS,
    ).length;
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

  const rootTasks = useMemo(() => getRootTasks(tasks), [tasks]);
  const tasksByParent = useMemo(() => getTasksByParent(tasks), [tasks]);
  const filteredRootTasks = useMemo(
    () => getFilteredRootTasks(rootTasks, tasksByParent, activeFilter),
    [activeFilter, rootTasks, tasksByParent],
  );
  const filteredTasksByStatus = useMemo(
    () => getTasksByStatus(filteredRootTasks),
    [filteredRootTasks],
  );
  const visibleLanes = useMemo(
    () => getVisibleLanes(activeFilter),
    [activeFilter],
  );

  const filters = useMemo(
    () => [
      {
        count: stats.total,
        icon: <LayoutList size={16} aria-hidden="true" />,
        label: 'Todas',
        tooltip: tooltipCopy.totalFilter,
        value: 'all' as const,
      },
      {
        count: stats.pending,
        icon: <Circle size={16} aria-hidden="true" />,
        label: 'Pendentes',
        tooltip: tooltipCopy.pendingFilter,
        value: 'pending' as const,
      },
      {
        count: stats.completed,
        icon: <CheckCircle2 size={16} aria-hidden="true" />,
        label: 'Concluídas',
        tooltip: tooltipCopy.doneFilter,
        value: 'done' as const,
      },
      {
        count: stats.aiGenerated,
        icon: <Sparkles size={16} aria-hidden="true" />,
        label: 'IA',
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

    const normalizedTask = getNormalizedTaskInput(
      manualTitle,
      manualDescription,
      manualLabel,
    );

    if (!normalizedTask.title) {
      return;
    }

    setIsCreating(true);
    try {
      const createdTask = await createTask(normalizedTask);
      setManualTitle('');
      setManualDescription('');
      setManualLabel('');
      setIsQuickCaptureOpen(false);
      setActiveFilter('all');
      await mutate((currentTasks = []) => [createdTask, ...currentTasks], {
        revalidate: false,
      });
      showToast({ type: 'success', message: 'Tarefa criada.' });
    } catch (requestError) {
      showToast({ type: 'error', message: getErrorMessage(requestError) });
    } finally {
      setIsCreating(false);
    }
  }

  function handleOpenQuickCapture() {
    setManualTitle('');
    setManualDescription('');
    setManualLabel('');
    setIsQuickCaptureOpen(true);
  }

  function handleCloseQuickCapture() {
    if (isCreating) {
      return;
    }

    setIsQuickCaptureOpen(false);
  }

  async function handleGenerateTasks(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const normalizedGoal = goal.trim();
    if (!normalizedGoal) {
      return;
    }

    setIsGenerating(true);
    try {
      const generatedTasks = await generateTasks(normalizedGoal);
      setGoal('');
      setActiveFilter('all');
      await mutate((currentTasks = []) => [...generatedTasks, ...currentTasks], {
        revalidate: false,
      });
      const storyCount = generatedTasks.filter((task) => !task.parentId).length;
      const subtaskCount = generatedTasks.length - storyCount;
      showToast({
        type: 'success',
        message: `Plano criado com ${storyCount} historia e ${subtaskCount} subtarefas.`,
      });
    } catch (requestError) {
      showToast({ type: 'error', message: getErrorMessage(requestError) });
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleToggleTask(task: Task) {
    const previousTasks = tasks;
    const nextStatus =
      getTaskStatus(task) === DONE_STATUS ? 'todo' : DONE_STATUS;
    setPending(task.id, true);

    await mutate(
      tasks.map((item) =>
        item.id === task.id
          ? withTaskStatus(item, nextStatus)
          : item,
      ),
      { revalidate: false },
    );

    try {
      const updatedTask = await updateTask(task.id, {
        isCompleted: nextStatus === DONE_STATUS,
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
      showToast({ type: 'error', message: getErrorMessage(requestError) });
    } finally {
      setPending(task.id, false);
    }
  }

  async function handleDeleteTask(task: Task) {
    const previousTasks = tasks;
    const idsToDelete = getDescendantIds(task.id, tasks);
    setPending(task.id, true);

    await mutate(
      tasks.filter((item) => !idsToDelete.has(item.id)),
      { revalidate: false },
    );

    try {
      await deleteTask(task.id);
      setConfirmingDeleteId(null);
      showToast({ type: 'success', message: 'Tarefa excluída.' });
    } catch (requestError) {
      await mutate(previousTasks, { revalidate: false });
      showToast({ type: 'error', message: getErrorMessage(requestError) });
    } finally {
      setPending(task.id, false);
    }
  }

  function handleOpenTaskDetails(task: Task) {
    setEditingTask(task);
    setEditTitle(task.title);
    setEditDescription(task.description ?? '');
    setEditLabel(task.label ?? '');
  }

  function handleCloseTaskDetails() {
    if (isSavingTaskDetails) {
      return;
    }

    setEditingTask(null);
  }

  async function handleSaveTaskDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!editingTask) {
      return;
    }

    const previousTasks = tasks;
    const normalizedTask = getNormalizedTaskInput(
      editTitle,
      editDescription,
      editLabel,
    );

    if (!normalizedTask.title) {
      return;
    }

    const optimisticTask: Task = {
      ...editingTask,
      title: normalizedTask.title,
      description: normalizedTask.description || null,
      label: normalizedTask.label || null,
    };

    setIsSavingTaskDetails(true);
    setPending(editingTask.id, true);

    await mutate(
      tasks.map((item) => (item.id === editingTask.id ? optimisticTask : item)),
      { revalidate: false },
    );

    try {
      const updatedTask = await updateTask(editingTask.id, normalizedTask);
      await mutate(
        (currentTasks = []) =>
          currentTasks.map((item) =>
            item.id === editingTask.id ? updatedTask : item,
          ),
        { revalidate: false },
      );
      setEditingTask(null);
      showToast({ type: 'success', message: 'Detalhes da tarefa salvos.' });
    } catch (requestError) {
      await mutate(previousTasks, { revalidate: false });
      showToast({ type: 'error', message: getErrorMessage(requestError) });
    } finally {
      setPending(editingTask.id, false);
      setIsSavingTaskDetails(false);
    }
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;

    if (!over || active.id === over.id || isReordering) {
      return;
    }

    const activeId = String(active.id);
    const overId = String(over.id);
    const activeTask = rootTasks.find((task) => task.id === activeId);
    const targetStatus = getDragTargetStatus(rootTasks, overId);

    if (!activeTask || !targetStatus) {
      return;
    }

    const previousTasks = tasks;
    const nextRootTasks = getMovedTasks(
      rootTasks,
      activeId,
      overId,
      targetStatus,
    );
    const nextTasks = mergeRootTasks(tasks, nextRootTasks);
    const orderedIds = nextRootTasks.map((task) => task.id);

    if (
      getTaskStatus(activeTask) === targetStatus &&
      orderedIds.every((id, index) => id === rootTasks[index]?.id)
    ) {
      return;
    }

    setIsReordering(true);
    await mutate(nextTasks, { revalidate: false });

    try {
      const movedTasks = await moveTask(activeId, {
        orderedIds,
        status: targetStatus,
      });
      await mutate(movedTasks, { revalidate: false });
      showToast({ type: 'success', message: 'Quadro atualizado.' });
    } catch (requestError) {
      await mutate(previousTasks, { revalidate: false });
      showToast({ type: 'error', message: getErrorMessage(requestError) });
    } finally {
      setIsReordering(false);
    }
  }

  function handleStartDelete(taskId: string) {
    setConfirmingDeleteId(taskId);
  }

  function handleToggleExpandedTask(taskId: string) {
    setExpandedTaskIds((current) => {
      const next = new Set(current);

      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
      }

      return next;
    });
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
            <p className="eyebrow">Decomposição de tarefas com IA</p>
            <h1>Smart To-Do List</h1>
          </div>
        </div>

        <div className="header-side">
          <p className="header-copy">
            Divida grandes objetivos em próximos passos claros e mantenha a
            execução visível do primeiro rascunho à conclusão.
          </p>

          <ThemeControl theme={theme} onThemeChange={setThemePreference} />
        </div>
      </header>

      <div className="workspace">
        <aside className="control-rail" aria-label="Controles de tarefas">
          <section className="planner-panel" aria-labelledby="planner-title">
            <div className="panel-heading">
              <span className="panel-icon" aria-hidden="true">
                <Wand2 size={19} />
              </span>
              <div>
                <p className="eyebrow">Fluxo principal</p>
                <h2 id="planner-title">Gerar um plano focado</h2>
              </div>
            </div>

            <form className="form-grid" onSubmit={handleGenerateTasks}>
              <div className="field-group">
                <div className="label-row">
                  <label htmlFor="goal">Objetivo</label>
                  <span>{goal.length}/{GOAL_MAX_LENGTH}</span>
                </div>
                <Tooltip className="tooltip-fill" content={tooltipCopy.goal}>
                  {(tooltipId) => (
                    <textarea
                      aria-describedby={describedBy(tooltipId, 'goal-helper')}
                      id="goal"
                      maxLength={GOAL_MAX_LENGTH}
                      onChange={(event) => setGoal(event.target.value)}
                      placeholder="Planejar uma viagem de cinco dias a Buenos Aires"
                      rows={6}
                      value={goal}
                    />
                  )}
                </Tooltip>
                <p className="field-hint" id="goal-helper">
                  Use um resultado concreto. A API criará as tarefas e as
                  salvará aqui.
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
                    disabled={isGenerating || !goal.trim()}
                    type="submit"
                  >
                    {isGenerating ? (
                      <Loader2 className="spin" size={18} aria-hidden="true" />
                    ) : (
                      <Sparkles size={18} aria-hidden="true" />
                    )}
                    {isGenerating ? 'Gerando plano...' : 'Gerar plano'}
                  </button>
                )}
              </Tooltip>
            </form>
          </section>
        </aside>

        <section className="task-area" aria-label="Tarefas">
          <div className="metrics-grid" aria-label="Resumo das tarefas">
            <MetricCard
              icon={<LayoutList size={18} aria-hidden="true" />}
              label="Total"
              tooltip={tooltipCopy.totalMetric}
              value={stats.total}
            />
            <MetricCard
              icon={<Circle size={18} aria-hidden="true" />}
              label="Pendentes"
              tone="warning"
              tooltip={tooltipCopy.pendingMetric}
              value={stats.pending}
            />
            <MetricCard
              icon={<CheckCircle2 size={18} aria-hidden="true" />}
              label="Concluídas"
              tone="success"
              tooltip={tooltipCopy.doneMetric}
              value={stats.completed}
            />
            <MetricCard
              icon={<BarChart3 size={18} aria-hidden="true" />}
              label="Conclusão"
              suffix="%"
              tone="accent"
              tooltip={tooltipCopy.completionMetric}
              value={stats.completionRate}
            />
          </div>

          <div className="list-panel">
            <div className="task-toolbar">
              <div>
                <p className="eyebrow">Lista atual</p>
                <h2>Fila de execução</h2>
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
                      {isRealtimeConnected
                        ? 'Sincronização ativa'
                        : 'Sincronização offline'}
                    </span>
                  )}
                </Tooltip>
                <Tooltip
                  className="tooltip-control"
                  content={tooltipCopy.quickCapture}
                >
                  {(tooltipId) => (
                    <button
                      aria-describedby={tooltipId}
                      className="icon-button neutral"
                      onClick={handleOpenQuickCapture}
                      type="button"
                    >
                      <Plus size={19} aria-hidden="true" />
                      <span className="sr-only">Abrir captura rápida</span>
                    </button>
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
                      <span className="sr-only">Recarregar tarefas</span>
                    </button>
                  )}
                </Tooltip>
              </div>
            </div>

            <div className="filter-tabs" aria-label="Filtrar tarefas">
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
                      Tentar novamente
                    </button>
                  )}
                </Tooltip>
              </div>
            ) : null}

            <div className="list-state" aria-busy={isLoading || isReordering}>
              {isLoading ? <TaskSkeleton /> : null}

              {!isLoading && !error && tasks.length === 0 ? (
                <EmptyState
                  description="Gere um plano a partir de um objetivo ou capture a primeira tarefa manual."
                  title="Sua fila está pronta"
                />
              ) : null}

              {!isLoading &&
              !error &&
              rootTasks.length > 0 &&
              filteredRootTasks.length === 0 ? (
                <EmptyState
                  actionIcon={<LayoutList size={18} aria-hidden="true" />}
                  actionLabel="Mostrar todas as tarefas"
                  actionTooltip={tooltipCopy.showAll}
                  description="Ainda não há tarefas nesta visualização."
                  onAction={() => setActiveFilter('all')}
                  title={emptyFilterTitles[activeFilter]}
                />
              ) : null}

              {!isLoading && filteredRootTasks.length > 0 ? (
                <DndContext
                  collisionDetection={closestCenter}
                  onDragEnd={(event) => void handleDragEnd(event)}
                  sensors={sensors}
                >
                  <div
                    className={
                      isReordering ? 'kanban-board reordering' : 'kanban-board'
                    }
                  >
                    {visibleLanes.map((lane) => (
                      <KanbanLane
                        confirmingDeleteId={confirmingDeleteId}
                        expandedTaskIds={expandedTaskIds}
                        isDisabled={isReordering}
                        key={lane.status}
                        lane={lane}
                        onCancelDelete={() => setConfirmingDeleteId(null)}
                        onDelete={handleDeleteTask}
                        onOpenDetails={handleOpenTaskDetails}
                        onStartDelete={handleStartDelete}
                        onToggleExpandedTask={handleToggleExpandedTask}
                        onToggle={handleToggleTask}
                        pendingIds={pendingIds}
                        tasksByParent={tasksByParent}
                        tasks={filteredTasksByStatus[lane.status]}
                      />
                    ))}
                  </div>
                </DndContext>
              ) : null}
            </div>
          </div>
        </section>
      </div>

      {isQuickCaptureOpen ? (
        <TaskFormModal
          description={manualDescription}
          isSaving={isCreating}
          label={manualLabel}
          mode="create"
          onClose={handleCloseQuickCapture}
          onDescriptionChange={setManualDescription}
          onLabelChange={setManualLabel}
          onSubmit={handleCreateTask}
          onTitleChange={setManualTitle}
          title={manualTitle}
        />
      ) : null}

      {editingTask ? (
        <TaskFormModal
          description={editDescription}
          isSaving={isSavingTaskDetails}
          label={editLabel}
          mode="edit"
          onClose={handleCloseTaskDetails}
          onDescriptionChange={setEditDescription}
          onLabelChange={setEditLabel}
          onOpenSubtask={handleOpenTaskDetails}
          onSubmit={handleSaveTaskDetails}
          onToggleSubtask={handleToggleTask}
          onTitleChange={setEditTitle}
          pendingIds={pendingIds}
          subtasks={tasksByParent.get(editingTask.id) ?? []}
          title={editTitle}
        />
      ) : null}

      <ToastViewport onDismiss={dismissToast} toasts={toasts} />
    </main>
  );
}

function KanbanLane({
  confirmingDeleteId,
  expandedTaskIds,
  isDisabled,
  lane,
  onCancelDelete,
  onDelete,
  onOpenDetails,
  onStartDelete,
  onToggleExpandedTask,
  onToggle,
  pendingIds,
  tasksByParent,
  tasks,
}: {
  confirmingDeleteId: string | null;
  expandedTaskIds: Set<string>;
  isDisabled: boolean;
  lane: TaskLane;
  onCancelDelete: () => void;
  onDelete: (task: Task) => void | Promise<void>;
  onOpenDetails: (task: Task) => void;
  onStartDelete: (taskId: string) => void;
  onToggleExpandedTask: (taskId: string) => void;
  onToggle: (task: Task) => void | Promise<void>;
  pendingIds: Set<string>;
  tasksByParent: Map<string, Task[]>;
  tasks: Task[];
}) {
  const { isOver, setNodeRef } = useDroppable({
    data: { status: lane.status, type: 'lane' },
    id: lane.status,
  });
  const taskIds = useMemo(() => tasks.map((task) => task.id), [tasks]);
  const className = [
    'kanban-lane',
    `lane-${lane.status}`,
    isOver ? 'over' : '',
    tasks.length === 0 ? 'empty' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <section
      aria-label={`Raia ${lane.label}`}
      className={className}
      ref={setNodeRef}
    >
      <div className="kanban-lane-header">
        <h3>{lane.label}</h3>
        <strong aria-label={`${tasks.length} tarefas`}>{tasks.length}</strong>
      </div>

      <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
        <ul aria-label={`Tarefas em ${lane.label}`} className="task-list">
          {tasks.map((task) => (
            <SortableTaskCard
              isConfirmingDelete={confirmingDeleteId === task.id}
              isDisabled={isDisabled}
              isPending={pendingIds.has(task.id)}
              key={task.id}
              onCancelDelete={onCancelDelete}
              onDelete={onDelete}
              onOpenDetails={onOpenDetails}
              onStartDelete={onStartDelete}
              onToggleExpandedTask={onToggleExpandedTask}
              onToggle={onToggle}
              pendingIds={pendingIds}
              task={task}
              subtasks={tasksByParent.get(task.id) ?? []}
              isExpanded={expandedTaskIds.has(task.id)}
            />
          ))}
        </ul>
      </SortableContext>
    </section>
  );
}

function SortableTaskCard({
  isConfirmingDelete,
  isDisabled,
  isExpanded,
  isPending,
  onCancelDelete,
  onDelete,
  onOpenDetails,
  onStartDelete,
  onToggleExpandedTask,
  onToggle,
  pendingIds,
  subtasks,
  task,
}: {
  isConfirmingDelete: boolean;
  isDisabled: boolean;
  isExpanded: boolean;
  isPending: boolean;
  onCancelDelete: () => void;
  onDelete: (task: Task) => void | Promise<void>;
  onOpenDetails: (task: Task) => void;
  onStartDelete: (taskId: string) => void;
  onToggleExpandedTask: (taskId: string) => void;
  onToggle: (task: Task) => void | Promise<void>;
  pendingIds: Set<string>;
  subtasks: Task[];
  task: Task;
}) {
  const status = getTaskStatus(task);
  const {
    attributes,
    isDragging,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({
    data: { status, type: 'task' },
    disabled: isDisabled || isPending,
    id: task.id,
  });
  const description = task.description?.trim();
  const label = task.label?.trim();
  const completedSubtasks = subtasks.filter(
    (subtask) => getTaskStatus(subtask) === DONE_STATUS,
  ).length;
  const subtaskProgress =
    subtasks.length > 0 ? Math.round((completedSubtasks / subtasks.length) * 100) : 0;
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  const className = [
    'task-card',
    `status-${status}`,
    subtasks.length > 0 ? 'has-subtasks' : '',
    isExpanded ? 'expanded' : '',
    status === DONE_STATUS ? 'done' : '',
    isDragging ? 'dragging' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const {
    'aria-describedby': sortableDescriptionId,
    ...dragAttributes
  } = attributes;

  return (
    <li className={className} ref={setNodeRef} style={style}>
      <div className="task-card-actions">
        <div className="task-card-actions-left">
          <Tooltip className="tooltip-control" content={tooltipCopy.dragTask}>
            {(tooltipId) => (
              <button
                aria-describedby={describedBy(tooltipId, sortableDescriptionId)}
                aria-label={`Arrastar tarefa ${task.title}`}
                className="drag-handle"
                disabled={isDisabled || isPending}
                type="button"
                {...dragAttributes}
                {...listeners}
              >
                <GripVertical size={19} aria-hidden="true" />
              </button>
            )}
          </Tooltip>

          <Tooltip
            className="tooltip-control"
            content={
              status === DONE_STATUS
                ? tooltipCopy.markPending
                : tooltipCopy.markDone
            }
          >
            {(tooltipId) => (
              <button
                aria-describedby={tooltipId}
                className="toggle-button"
                disabled={isPending}
                onClick={() => void onToggle(task)}
                type="button"
              >
                {status === DONE_STATUS ? (
                  <CheckCircle2 size={23} aria-hidden="true" />
                ) : (
                  <Circle size={23} aria-hidden="true" />
                )}
                <span className="sr-only">
                  {status === DONE_STATUS
                    ? 'Marcar como pendente'
                    : 'Marcar como concluída'}
                </span>
              </button>
            )}
          </Tooltip>
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
                  onClick={() => void onDelete(task)}
                  type="button"
                >
                  {isPending ? (
                    <Loader2 className="spin" size={16} aria-hidden="true" />
                  ) : (
                    <Trash2 size={16} aria-hidden="true" />
                  )}
                  Excluir
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
                  onClick={onCancelDelete}
                  type="button"
                >
                  <X size={17} aria-hidden="true" />
                  <span className="sr-only">Cancelar exclusão</span>
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
                onClick={() => onStartDelete(task.id)}
                type="button"
              >
                {isPending ? (
                  <Loader2 className="spin" size={19} aria-hidden="true" />
                ) : (
                  <Trash2 size={19} aria-hidden="true" />
                )}
                <span className="sr-only">Excluir tarefa</span>
              </button>
            )}
          </Tooltip>
        )}
      </div>

      {subtasks.length > 0 ? (
        <div className="story-progress" aria-label={`${completedSubtasks} de ${subtasks.length} subtarefas concluidas`}>
          <div className="story-progress-row">
            <span>
              <ListChecks size={14} aria-hidden="true" />
              {completedSubtasks}/{subtasks.length} subtarefas
            </span>
            <strong>{subtaskProgress}%</strong>
          </div>
          <span className="story-progress-track">
            <span style={{ width: `${subtaskProgress}%` }} />
          </span>
        </div>
      ) : null}

      <Tooltip
        className="tooltip-fill task-card-preview-trigger"
        content={getTaskPreviewContent(task, status, description, label)}
      >
        {(tooltipId) => (
          <button
            aria-describedby={tooltipId}
            aria-label={`Editar detalhes de ${task.title}`}
            className="task-content task-edit-button"
            disabled={isPending}
            onClick={() => onOpenDetails(task)}
            type="button"
          >
            <span className="task-title">{task.title}</span>
            <span className={`status-chip status-${status}`}>
              {TASK_STATUS_LABELS[status]}
            </span>
            <span
              className={
                description ? 'task-description' : 'task-description empty'
              }
            >
              <FileText size={14} aria-hidden="true" />
              <span>{description || 'Sem descrição'}</span>
            </span>
            <span className="task-meta">
              <span className={task.isAiGenerated ? 'badge ai' : 'badge'}>
                {task.isAiGenerated ? 'Gerada por IA' : 'Manual'}
              </span>
              <span className={label ? 'label-pill' : 'label-pill empty'}>
                <Tag size={13} aria-hidden="true" />
                {label || 'Sem etiqueta'}
              </span>
              <span>
                <Clock3 size={14} aria-hidden="true" />
                {formatDate(task.createdAt)}
              </span>
            </span>
          </button>
        )}
      </Tooltip>

      {subtasks.length > 0 ? (
        <div className="subtask-panel">
          <Tooltip
            className="tooltip-fill"
            content="Mostrar ou ocultar subtarefas desta historia."
          >
            {(tooltipId) => (
              <button
                aria-describedby={tooltipId}
                aria-expanded={isExpanded}
                className="subtask-toggle"
                onClick={() => onToggleExpandedTask(task.id)}
                type="button"
              >
                <span>Subtarefas</span>
                <ChevronDown size={16} aria-hidden="true" />
              </button>
            )}
          </Tooltip>

          {isExpanded ? (
            <ul className="subtask-list" aria-label={`Subtarefas de ${task.title}`}>
              {subtasks.map((subtask) => {
                const subtaskStatus = getTaskStatus(subtask);
                const subtaskLabel = subtask.label?.trim();

                return (
                  <li className="subtask-item" key={subtask.id}>
                    <button
                      className="subtask-check"
                      disabled={pendingIds.has(subtask.id)}
                      onClick={() => void onToggle(subtask)}
                      type="button"
                    >
                      {subtaskStatus === DONE_STATUS ? (
                        <CheckCircle2 size={18} aria-hidden="true" />
                      ) : (
                        <Circle size={18} aria-hidden="true" />
                      )}
                      <span className="sr-only">
                        {subtaskStatus === DONE_STATUS
                          ? 'Marcar subtarefa como pendente'
                          : 'Marcar subtarefa como concluida'}
                      </span>
                    </button>
                    <button
                      className="subtask-open"
                      disabled={pendingIds.has(subtask.id)}
                      onClick={() => onOpenDetails(subtask)}
                      type="button"
                    >
                      <span>{subtask.title}</span>
                      <small>{subtaskLabel || TASK_STATUS_LABELS[subtaskStatus]}</small>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function TaskFormModal({
  description,
  isSaving,
  label,
  mode,
  onClose,
  onDescriptionChange,
  onLabelChange,
  onOpenSubtask,
  onSubmit,
  onToggleSubtask,
  onTitleChange,
  pendingIds = new Set(),
  subtasks = [],
  title,
}: {
  description: string;
  isSaving: boolean;
  label: string;
  mode: 'create' | 'edit';
  onClose: () => void;
  onDescriptionChange: (value: string) => void;
  onLabelChange: (value: string) => void;
  onOpenSubtask?: (task: Task) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onToggleSubtask?: (task: Task) => void | Promise<void>;
  onTitleChange: (value: string) => void;
  pendingIds?: Set<string>;
  subtasks?: Task[];
  title: string;
}) {
  const dialogTitleId = useId();
  const titleId = useId();
  const descriptionId = useId();
  const labelId = useId();
  const isCreateMode = mode === 'create';
  const dialogTitle = isCreateMode ? 'Captura rápida' : 'Editar tarefa';
  const eyebrow = isCreateMode ? 'Nova tarefa' : 'Detalhes da tarefa';
  const submitLabel = isCreateMode ? 'Criar tarefa' : 'Salvar detalhes';
  const savingLabel = isCreateMode ? 'Criando...' : 'Salvando...';
  const submitTooltip = isCreateMode
    ? tooltipCopy.createTaskDetails
    : tooltipCopy.updateTaskDetails;

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
      }
    }

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <form
        aria-labelledby={dialogTitleId}
        aria-modal="true"
        className="task-modal"
        onSubmit={onSubmit}
        role="dialog"
      >
        <div className="modal-header">
          <div>
            <p className="eyebrow">{eyebrow}</p>
            <h2 id={dialogTitleId}>{dialogTitle}</h2>
          </div>
          <Tooltip
            className="tooltip-control tooltip-end"
            content="Fechar detalhes da tarefa."
          >
            {(tooltipId) => (
              <button
                aria-describedby={tooltipId}
                className="icon-button neutral"
                disabled={isSaving}
                onClick={onClose}
                type="button"
              >
                <X size={18} aria-hidden="true" />
                <span className="sr-only">Fechar detalhes</span>
              </button>
            )}
          </Tooltip>
        </div>

        <div className="form-grid">
          <div className="field-group">
            <div className="label-row">
              <label htmlFor={titleId}>Título</label>
              <span>{title.length}/{TASK_MAX_LENGTH}</span>
            </div>
            <Tooltip className="tooltip-fill" content={tooltipCopy.taskTitle}>
              {(tooltipId) => (
                <input
                  aria-describedby={tooltipId}
                  id={titleId}
                  maxLength={TASK_MAX_LENGTH}
                  onChange={(event) => onTitleChange(event.target.value)}
                  placeholder="Reservar voos"
                  type="text"
                  value={title}
                />
              )}
            </Tooltip>
          </div>

          <div className="field-group">
            <div className="label-row">
              <label htmlFor={descriptionId}>Conteúdo</label>
              <span>{description.length}/{TASK_DESCRIPTION_MAX_LENGTH}</span>
            </div>
            <textarea
              id={descriptionId}
              maxLength={TASK_DESCRIPTION_MAX_LENGTH}
              onChange={(event) => onDescriptionChange(event.target.value)}
              placeholder="Adicione contexto, critérios de pronto ou próximos passos."
              rows={7}
              value={description}
            />
          </div>

          <div className="field-group">
            <div className="label-row">
              <label htmlFor={labelId}>Etiqueta</label>
              <span>{label.length}/{TASK_LABEL_MAX_LENGTH}</span>
            </div>
            <input
              id={labelId}
              maxLength={TASK_LABEL_MAX_LENGTH}
              onChange={(event) => onLabelChange(event.target.value)}
              placeholder="Ex: Planejamento"
              type="text"
              value={label}
            />
          </div>
        </div>

        {subtasks.length > 0 ? (
          <section className="modal-subtasks" aria-label="Subtarefas">
            <div className="modal-subtasks-header">
              <span>
                <ListChecks size={16} aria-hidden="true" />
                Subtarefas
              </span>
              <strong>
                {
                  subtasks.filter(
                    (subtask) => getTaskStatus(subtask) === DONE_STATUS,
                  ).length
                }/{subtasks.length}
              </strong>
            </div>
            <ul className="modal-subtask-list">
              {subtasks.map((subtask) => {
                const subtaskStatus = getTaskStatus(subtask);
                const isSubtaskPending = pendingIds.has(subtask.id);

                return (
                  <li key={subtask.id}>
                    <button
                      className="subtask-check"
                      disabled={isSubtaskPending || !onToggleSubtask}
                      onClick={() => void onToggleSubtask?.(subtask)}
                      type="button"
                    >
                      {subtaskStatus === DONE_STATUS ? (
                        <CheckCircle2 size={18} aria-hidden="true" />
                      ) : (
                        <Circle size={18} aria-hidden="true" />
                      )}
                      <span className="sr-only">
                        Alternar status da subtarefa
                      </span>
                    </button>
                    <button
                      className="modal-subtask-open"
                      disabled={isSubtaskPending || !onOpenSubtask}
                      onClick={() => onOpenSubtask?.(subtask)}
                      type="button"
                    >
                      <span>{subtask.title}</span>
                      <small>{TASK_STATUS_LABELS[subtaskStatus]}</small>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        <div className="modal-actions">
          <button
            className="button tertiary"
            disabled={isSaving}
            onClick={onClose}
            type="button"
          >
            Cancelar
          </button>
          <Tooltip
            className="tooltip-control"
            content={submitTooltip}
          >
            {(tooltipId) => (
              <button
                aria-describedby={tooltipId}
                className="button primary"
                disabled={isSaving || !title.trim()}
                type="submit"
              >
                {isSaving ? (
                  <Loader2 className="spin" size={18} aria-hidden="true" />
                ) : isCreateMode ? (
                  <Plus size={18} aria-hidden="true" />
                ) : (
                  <Save size={18} aria-hidden="true" />
                )}
                {isSaving ? savingLabel : submitLabel}
              </button>
            )}
          </Tooltip>
        </div>
      </form>
    </div>
  );
}

function ThemeControl({
  onThemeChange,
  theme,
}: {
  onThemeChange: (theme: Theme) => void;
  theme: Theme;
}) {
  const options = [
    {
      icon: <Sun size={16} aria-hidden="true" />,
      label: 'Light',
      tooltip: tooltipCopy.themeLight,
      value: 'light' as const,
    },
    {
      icon: <Moon size={16} aria-hidden="true" />,
      label: 'Dark',
      tooltip: tooltipCopy.themeDark,
      value: 'dark' as const,
    },
  ];

  return (
    <div className="theme-switcher" role="group" aria-label="Seleção de tema">
      {options.map((option) => {
        const isActive = theme === option.value;

        return (
          <Tooltip
            className="tooltip-fill"
            content={option.tooltip}
            key={option.value}
          >
            {(tooltipId) => (
              <button
                aria-describedby={tooltipId}
                aria-pressed={isActive}
                className={isActive ? 'theme-option active' : 'theme-option'}
                onClick={() => onThemeChange(option.value)}
                suppressHydrationWarning
                type="button"
              >
                {option.icon}
                <span>{option.label}</span>
              </button>
            )}
          </Tooltip>
        );
      })}
    </div>
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
  content: ReactNode;
}) {
  const tooltipId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const ignorePointerFocusRef = useRef(false);

  function handlePointerDown() {
    ignorePointerFocusRef.current = true;
    setIsOpen(false);
    window.setTimeout(() => {
      ignorePointerFocusRef.current = false;
    }, 120);
  }

  return (
    <span
      className={`tooltip-wrap ${className}`.trim()}
      data-open={isOpen ? 'true' : undefined}
      onBlur={() => setIsOpen(false)}
      onFocus={() => {
        if (!ignorePointerFocusRef.current) {
          setIsOpen(true);
        }
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          setIsOpen(false);
        }
      }}
      onMouseEnter={() => setIsOpen(true)}
      onMouseLeave={() => setIsOpen(false)}
      onPointerDown={handlePointerDown}
    >
      {children(tooltipId)}
      <span className="tooltip-bubble" id={tooltipId} role="tooltip">
        {content}
      </span>
    </span>
  );
}

function TaskSkeleton() {
  return (
    <div className="skeleton-stack" aria-label="Carregando tarefas">
      <div />
      <div />
      <div />
    </div>
  );
}
