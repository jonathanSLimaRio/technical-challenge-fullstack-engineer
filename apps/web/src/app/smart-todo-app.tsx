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
  Pencil,
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
  confirmGeneratedTasks,
  createTask,
  deleteTask,
  fetchTasks,
  getApiOrigin,
  moveTask,
  previewTasks,
  updateTask,
} from '../lib/api';
import {
  TASK_STATUSES,
  type AiDraftPlan,
  type AiDraftTask,
  type Task,
  type TaskStatus,
} from '../types/task';
import { ToastViewport, useToastQueue } from './toast';
import type { Theme } from './theme';
import { useThemePreference } from './use-theme-preference';

type TaskFilter = 'all' | 'pending' | 'done' | 'ai';
type MobileStatusFilter = 'all' | TaskStatus;
type AiDraftModalStatus = 'error' | 'loading' | 'ready';
type DraftSaveState = 'confirmed' | 'idle' | 'saving';
type TaskLane = {
  label: string;
  status: TaskStatus;
};

const DRAFT_CONFIRMATION_MS = 520;
const DRAFT_SUBTASK_EXIT_MS = 180;
const GOAL_MAX_LENGTH = 500;
const AI_DRAFT_MAX_SUBTASKS = 10;
const STATUS_PULSE_MS = 650;
const TASK_DESCRIPTION_MAX_LENGTH = 1000;
const TASK_LABEL_MAX_LENGTH = 40;
const TASK_MAX_LENGTH = 160;
const DONE_STATUS: TaskStatus = 'done';

const TASK_LANES: TaskLane[] = [
  { label: 'A Fazer', status: 'todo' },
  { label: 'Fazendo', status: 'doing' },
  { label: 'Bloqueadas', status: 'blocked' },
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
    'Criar um rascunho editavel com tarefas sugeridas pela IA.',
  goal: 'Descreva um resultado concreto. A IA transforma isso em um rascunho editavel.',
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

const emptyMobileFilterTitles: Record<MobileStatusFilter, string> = {
  all: 'Nenhuma tarefa',
  blocked: 'Nenhuma tarefa bloqueada',
  doing: 'Nenhuma tarefa em andamento',
  done: 'Nenhuma tarefa concluída',
  todo: 'Nenhuma tarefa a fazer',
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

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function waitForMotion(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
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

function getTasksByMobileStatus(
  rootTasks: Task[],
  filter: MobileStatusFilter,
): Task[] {
  if (filter === 'all') {
    return rootTasks;
  }

  return rootTasks.filter((task) => getTaskStatus(task) === filter);
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

function createEmptyDraftSubtask(): AiDraftTask {
  return {
    description: null,
    label: null,
    title: '',
  };
}

function sanitizeDraftText(value: string | null | undefined): string {
  return value ?? '';
}

function normalizeDraftTask(task: AiDraftTask): AiDraftTask {
  return {
    description: sanitizeDraftText(task.description).trim() || null,
    label: sanitizeDraftText(task.label).trim().replace(/\s+/g, ' ') || null,
    title: task.title.trim().replace(/\s+/g, ' '),
  };
}

function normalizeDraftPlan(plan: AiDraftPlan): AiDraftPlan {
  return {
    story: normalizeDraftTask(plan.story),
    subtasks: plan.subtasks.map((subtask) => normalizeDraftTask(subtask)),
  };
}

function getDraftValidationError(plan: AiDraftPlan): string | null {
  const normalizedPlan = normalizeDraftPlan(plan);

  if (!normalizedPlan.story.title) {
    return 'Informe o titulo da historia antes de salvar.';
  }

  if (normalizedPlan.subtasks.length === 0) {
    return 'Mantenha ao menos uma subtarefa no plano.';
  }

  if (normalizedPlan.subtasks.some((subtask) => !subtask.title)) {
    return 'Remova ou preencha subtarefas sem titulo.';
  }

  return null;
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
  const [activeMobileStatus, setActiveMobileStatus] =
    useState<MobileStatusFilter>('all');
  const [isQuickCaptureOpen, setIsQuickCaptureOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [draftSaveState, setDraftSaveState] =
    useState<DraftSaveState>('idle');
  const [isDraftModalOpen, setIsDraftModalOpen] = useState(false);
  const [draftModalStatus, setDraftModalStatus] =
    useState<AiDraftModalStatus>('loading');
  const [draftPlan, setDraftPlan] = useState<AiDraftPlan | null>(null);
  const [draftSubtaskKeys, setDraftSubtaskKeys] = useState<string[]>([]);
  const [removingDraftSubtaskKeys, setRemovingDraftSubtaskKeys] = useState<
    Set<string>
  >(() => new Set());
  const [draftError, setDraftError] = useState<string | null>(null);
  const [draftPreviewError, setDraftPreviewError] = useState<string | null>(
    null,
  );
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
  const [isMobileTaskFlow, setIsMobileTaskFlow] = useState(false);
  const [statusPulseTaskIds, setStatusPulseTaskIds] = useState<Set<string>>(
    () => new Set(),
  );
  const draftSubtaskKeysRef = useRef<string[]>([]);
  const draftRemovalTimeoutsRef = useRef(
    new Map<string, ReturnType<typeof setTimeout>>(),
  );
  const nextDraftSubtaskUiIdRef = useRef(1);
  const statusPulseTimeoutsRef = useRef(
    new Map<string, ReturnType<typeof setTimeout>>(),
  );
  const modalReturnFocusRef = useRef<HTMLElement | null>(null);
  const draftPreviewAbortRef = useRef<AbortController | null>(null);
  const draftGoalRef = useRef('');
  const isSavingDraft = draftSaveState !== 'idle';
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
  const mobileFilteredRootTasks = useMemo(
    () => getTasksByMobileStatus(rootTasks, activeMobileStatus),
    [activeMobileStatus, rootTasks],
  );
  const rootTasksByStatus = useMemo(
    () => getTasksByStatus(rootTasks),
    [rootTasks],
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

  const mobileStatusTabs = useMemo(
    () => [
      {
        count: rootTasks.length,
        icon: <LayoutList size={16} aria-hidden="true" />,
        label: 'Todas',
        tooltip: 'Mostrar todas as tarefas.',
        value: 'all' as const,
      },
      {
        count: rootTasksByStatus.todo.length,
        icon: <Circle size={16} aria-hidden="true" />,
        label: 'A Fazer',
        tooltip: 'Mostrar tarefas a fazer.',
        value: 'todo' as const,
      },
      {
        count: rootTasksByStatus.doing.length,
        icon: <Clock3 size={16} aria-hidden="true" />,
        label: 'Fazendo',
        tooltip: 'Mostrar tarefas em andamento.',
        value: 'doing' as const,
      },
      {
        count: rootTasksByStatus.blocked.length,
        icon: <AlertCircle size={16} aria-hidden="true" />,
        label: 'Bloqueadas',
        tooltip: 'Mostrar tarefas bloqueadas.',
        value: 'blocked' as const,
      },
      {
        count: rootTasksByStatus.done.length,
        icon: <CheckCircle2 size={16} aria-hidden="true" />,
        label: 'Concluídas',
        tooltip: 'Mostrar tarefas concluídas.',
        value: 'done' as const,
      },
    ],
    [rootTasks.length, rootTasksByStatus],
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

  useEffect(() => {
    draftSubtaskKeysRef.current = draftSubtaskKeys;
  }, [draftSubtaskKeys]);

  useEffect(() => {
    const draftRemovalTimeouts = draftRemovalTimeoutsRef.current;
    const statusPulseTimeouts = statusPulseTimeoutsRef.current;

    return () => {
      draftPreviewAbortRef.current?.abort();
      draftRemovalTimeouts.forEach((timeout) => clearTimeout(timeout));
      draftRemovalTimeouts.clear();
      statusPulseTimeouts.forEach((timeout) => clearTimeout(timeout));
      statusPulseTimeouts.clear();
    };
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 640px)');
    const handleChange = () => setIsMobileTaskFlow(mediaQuery.matches);

    handleChange();
    mediaQuery.addEventListener('change', handleChange);

    return () => {
      mediaQuery.removeEventListener('change', handleChange);
    };
  }, []);

  function rememberModalReturnFocus() {
    if (typeof document === 'undefined') {
      return;
    }

    const activeElement = document.activeElement;

    if (
      activeElement instanceof HTMLElement &&
      !activeElement.closest('[role="dialog"]')
    ) {
      modalReturnFocusRef.current = activeElement;
    }
  }

  function restoreModalReturnFocus() {
    const element = modalReturnFocusRef.current;

    window.setTimeout(() => {
      if (element?.isConnected) {
        element.focus();
      }
    }, 0);
  }

  function createDraftSubtaskKey(): string {
    const key = `draft-subtask-${nextDraftSubtaskUiIdRef.current}`;
    nextDraftSubtaskUiIdRef.current += 1;
    return key;
  }

  function clearDraftRemovalTimeouts() {
    draftRemovalTimeoutsRef.current.forEach((timeout) =>
      clearTimeout(timeout),
    );
    draftRemovalTimeoutsRef.current.clear();
  }

  function resetDraftMotionState() {
    clearDraftRemovalTimeouts();
    setDraftSubtaskKeys([]);
    setRemovingDraftSubtaskKeys(new Set());
    setDraftSaveState('idle');
  }

  function getDraftWithoutRemovingSubtasks(plan: AiDraftPlan): AiDraftPlan {
    return {
      ...plan,
      subtasks: plan.subtasks.filter((_subtask, index) => {
        const key = draftSubtaskKeysRef.current[index];
        return !key || !removingDraftSubtaskKeys.has(key);
      }),
    };
  }

  function markTaskStatusChanged(taskId: string) {
    const activeTimeout = statusPulseTimeoutsRef.current.get(taskId);

    if (activeTimeout) {
      clearTimeout(activeTimeout);
    }

    setStatusPulseTaskIds((current) => {
      const next = new Set(current);
      next.add(taskId);
      return next;
    });

    const timeout = setTimeout(() => {
      statusPulseTimeoutsRef.current.delete(taskId);
      setStatusPulseTaskIds((current) => {
        const next = new Set(current);
        next.delete(taskId);
        return next;
      });
    }, STATUS_PULSE_MS);

    statusPulseTimeoutsRef.current.set(taskId, timeout);
  }

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
      restoreModalReturnFocus();
      setActiveFilter('all');
      setActiveMobileStatus('all');
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
    rememberModalReturnFocus();
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
    restoreModalReturnFocus();
  }

  async function startDraftPreview(normalizedGoal: string): Promise<void> {
    draftPreviewAbortRef.current?.abort();
    const abortController = new AbortController();
    draftPreviewAbortRef.current = abortController;
    draftGoalRef.current = normalizedGoal;
    resetDraftMotionState();
    setIsDraftModalOpen(true);
    setDraftModalStatus('loading');
    setIsGenerating(true);
    setDraftPlan(null);
    setDraftError(null);
    setDraftPreviewError(null);

    try {
      const generatedDraft = await previewTasks(normalizedGoal, {
        signal: abortController.signal,
      });

      if (abortController.signal.aborted) {
        return;
      }

      const normalizedDraft = normalizeDraftPlan(generatedDraft);
      setDraftPlan(normalizedDraft);
      setDraftSubtaskKeys(
        normalizedDraft.subtasks.map(() => createDraftSubtaskKey()),
      );
      setDraftModalStatus('ready');
    } catch (requestError) {
      if (isAbortError(requestError)) {
        return;
      }

      setDraftPreviewError(getErrorMessage(requestError));
      setDraftModalStatus('error');
    } finally {
      if (draftPreviewAbortRef.current === abortController) {
        draftPreviewAbortRef.current = null;
        setIsGenerating(false);
      }
    }
  }

  async function handleGenerateTasks(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const normalizedGoal = goal.trim();
    if (!normalizedGoal) {
      return;
    }

    rememberModalReturnFocus();
    await startDraftPreview(normalizedGoal);
  }

  function handleRetryDraftPreview(): void {
    if (!draftGoalRef.current || isGenerating) {
      return;
    }

    void startDraftPreview(draftGoalRef.current);
  }

  function handleDraftStoryChange(
    field: keyof AiDraftTask,
    value: string,
  ): void {
    setDraftPlan((currentDraft) =>
      currentDraft
        ? {
            ...currentDraft,
            story: { ...currentDraft.story, [field]: value },
          }
        : currentDraft,
    );
    setDraftError(null);
  }

  function handleDraftSubtaskChange(
    index: number,
    field: keyof AiDraftTask,
    value: string,
  ): void {
    setDraftPlan((currentDraft) => {
      if (!currentDraft) {
        return currentDraft;
      }

      return {
        ...currentDraft,
        subtasks: currentDraft.subtasks.map((subtask, subtaskIndex) =>
          subtaskIndex === index ? { ...subtask, [field]: value } : subtask,
        ),
      };
    });
    setDraftError(null);
  }

  function handleAddDraftSubtask(): void {
    const subtaskKey = createDraftSubtaskKey();

    setDraftPlan((currentDraft) =>
      currentDraft
        ? {
            ...currentDraft,
            subtasks: [...currentDraft.subtasks, createEmptyDraftSubtask()],
          }
        : currentDraft,
    );
    setDraftSubtaskKeys((currentKeys) => [...currentKeys, subtaskKey]);
    setDraftError(null);
  }

  function handleRemoveDraftSubtask(index: number): void {
    const subtaskKey = draftSubtaskKeysRef.current[index];

    if (
      !subtaskKey ||
      removingDraftSubtaskKeys.has(subtaskKey) ||
      draftRemovalTimeoutsRef.current.has(subtaskKey)
    ) {
      return;
    }

    setRemovingDraftSubtaskKeys((currentKeys) => {
      const nextKeys = new Set(currentKeys);
      nextKeys.add(subtaskKey);
      return nextKeys;
    });

    const timeout = setTimeout(() => {
      const currentIndex = draftSubtaskKeysRef.current.indexOf(subtaskKey);

      if (currentIndex >= 0) {
        setDraftPlan((currentDraft) =>
          currentDraft
            ? {
                ...currentDraft,
                subtasks: currentDraft.subtasks.filter(
                  (_subtask, subtaskIndex) => subtaskIndex !== currentIndex,
                ),
              }
            : currentDraft,
        );
        setDraftSubtaskKeys((currentKeys) =>
          currentKeys.filter((key) => key !== subtaskKey),
        );
      }

      draftRemovalTimeoutsRef.current.delete(subtaskKey);
      setRemovingDraftSubtaskKeys((currentKeys) => {
        const nextKeys = new Set(currentKeys);
        nextKeys.delete(subtaskKey);
        return nextKeys;
      });
    }, DRAFT_SUBTASK_EXIT_MS);

    draftRemovalTimeoutsRef.current.set(subtaskKey, timeout);
    setDraftError(null);
  }

  function handleCancelDraft(): void {
    if (isSavingDraft) {
      return;
    }

    draftPreviewAbortRef.current?.abort();
    draftPreviewAbortRef.current = null;
    setIsGenerating(false);
    setIsDraftModalOpen(false);
    setDraftModalStatus('loading');
    setDraftPlan(null);
    resetDraftMotionState();
    setDraftError(null);
    setDraftPreviewError(null);
    restoreModalReturnFocus();
  }

  async function handleConfirmDraft(): Promise<void> {
    if (!draftPlan) {
      return;
    }

    const activeDraft = getDraftWithoutRemovingSubtasks(draftPlan);
    const validationError = getDraftValidationError(activeDraft);

    if (validationError) {
      setDraftError(validationError);
      return;
    }

    const normalizedDraft = normalizeDraftPlan(activeDraft);
    setDraftSaveState('saving');
    setDraftError(null);
    let didSaveDraft = false;

    try {
      const generatedTasks = await confirmGeneratedTasks(normalizedDraft);
      await mutate((currentTasks = []) => [...generatedTasks, ...currentTasks], {
        revalidate: false,
      });
      const storyCount = generatedTasks.filter((task) => !task.parentId).length;
      const subtaskCount = generatedTasks.length - storyCount;
      const successMessage = `Plano salvo com ${storyCount} historia e ${subtaskCount} subtarefas.`;

      didSaveDraft = true;
      setDraftSaveState('confirmed');
      await waitForMotion(DRAFT_CONFIRMATION_MS);
      setIsDraftModalOpen(false);
      setDraftModalStatus('loading');
      setDraftPlan(null);
      resetDraftMotionState();
      setDraftPreviewError(null);
      setGoal('');
      setActiveFilter('all');
      setActiveMobileStatus('all');
      showToast({
        type: 'success',
        message: successMessage,
      });
      restoreModalReturnFocus();
    } catch (requestError) {
      showToast({ type: 'error', message: getErrorMessage(requestError) });
    } finally {
      if (!didSaveDraft) {
        setDraftSaveState('idle');
      }
    }
  }

  async function handleToggleTask(task: Task) {
    const previousTasks = tasks;
    const nextStatus =
      getTaskStatus(task) === DONE_STATUS ? 'todo' : DONE_STATUS;
    setPending(task.id, true);
    markTaskStatusChanged(task.id);

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
    rememberModalReturnFocus();
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
    restoreModalReturnFocus();
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
      restoreModalReturnFocus();
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
    if (getTaskStatus(activeTask) !== targetStatus) {
      markTaskStatusChanged(activeId);
    }
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

  async function handleMoveTaskStatus(task: Task, targetStatus: TaskStatus) {
    if (isReordering || getTaskStatus(task) === targetStatus) {
      return;
    }

    const previousTasks = tasks;
    const nextRootTasks = rootTasks.map((item) =>
      item.id === task.id ? withTaskStatus(item, targetStatus) : item,
    );
    const nextTasks = mergeRootTasks(tasks, nextRootTasks);
    const orderedIds = nextRootTasks.map((item) => item.id);

    setPending(task.id, true);
    markTaskStatusChanged(task.id);
    await mutate(nextTasks, { revalidate: false });

    try {
      const movedTasks = await moveTask(task.id, {
        orderedIds,
        status: targetStatus,
      });
      await mutate(movedTasks, { revalidate: false });
      showToast({ type: 'success', message: 'Status atualizado.' });
    } catch (requestError) {
      await mutate(previousTasks, { revalidate: false });
      showToast({ type: 'error', message: getErrorMessage(requestError) });
    } finally {
      setPending(task.id, false);
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
                    disabled={isGenerating || isSavingDraft || !goal.trim()}
                    type="submit"
                  >
                    {isGenerating ? (
                      <Loader2 className="spin" size={18} aria-hidden="true" />
                    ) : (
                      <Sparkles size={18} aria-hidden="true" />
                    )}
                    {isGenerating ? 'Gerando rascunho...' : 'Gerar rascunho'}
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
                      <span className="mobile-action-label" aria-hidden="true">
                        Nova
                      </span>
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
                      <span className="mobile-action-label" aria-hidden="true">
                        Recarregar
                      </span>
                      <span className="sr-only">Recarregar tarefas</span>
                    </button>
                  )}
                </Tooltip>
              </div>
            </div>

            {!isMobileTaskFlow ? (
              <div
                className="filter-tabs desktop-filter-tabs"
                aria-label="Filtrar tarefas"
              >
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
                        <strong>
                          <AnimatedNumber value={filter.count} />
                        </strong>
                      </button>
                    )}
                  </Tooltip>
                ))}
              </div>
            ) : null}

            {isMobileTaskFlow ? (
              <div
                className="mobile-status-tabs"
                aria-label="Filtrar tarefas por status"
              >
                {mobileStatusTabs.map((filter) => (
                  <Tooltip
                    className="tooltip-fill"
                    content={filter.tooltip}
                    key={filter.value}
                  >
                    {(tooltipId) => (
                      <button
                        aria-describedby={tooltipId}
                        aria-pressed={activeMobileStatus === filter.value}
                        className={
                          activeMobileStatus === filter.value
                            ? 'filter-tab active'
                            : 'filter-tab'
                        }
                        onClick={() => setActiveMobileStatus(filter.value)}
                        type="button"
                      >
                        {filter.icon}
                        <span>{filter.label}</span>
                        <strong>
                          <AnimatedNumber value={filter.count} />
                        </strong>
                      </button>
                    )}
                  </Tooltip>
                ))}
              </div>
            ) : null}

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

              {!isMobileTaskFlow ? (
                <div className="desktop-task-surface">
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
                        statusPulseTaskIds={statusPulseTaskIds}
                        tasksByParent={tasksByParent}
                        tasks={filteredTasksByStatus[lane.status]}
                      />
                    ))}
                  </div>
                </DndContext>
              ) : null}
                </div>
              ) : null}

              {isMobileTaskFlow && !isLoading && !error && tasks.length > 0 ? (
                <div className="mobile-task-surface">
                  {rootTasks.length > 0 &&
                  mobileFilteredRootTasks.length === 0 ? (
                    <EmptyState
                      actionIcon={<LayoutList size={18} aria-hidden="true" />}
                      actionLabel="Mostrar todas as tarefas"
                      actionTooltip={tooltipCopy.showAll}
                      description="Ainda nao ha tarefas neste status."
                      onAction={() => setActiveMobileStatus('all')}
                      title={emptyMobileFilterTitles[activeMobileStatus]}
                    />
                  ) : null}

                  {mobileFilteredRootTasks.length > 0 ? (
                    <MobileTaskList
                      confirmingDeleteId={confirmingDeleteId}
                      expandedTaskIds={expandedTaskIds}
                      isDisabled={isReordering}
                      onCancelDelete={() => setConfirmingDeleteId(null)}
                      onDelete={handleDeleteTask}
                      onOpenDetails={handleOpenTaskDetails}
                      onStartDelete={handleStartDelete}
                      onStatusChange={handleMoveTaskStatus}
                      onToggleExpandedTask={handleToggleExpandedTask}
                      onToggle={handleToggleTask}
                      pendingIds={pendingIds}
                      statusPulseTaskIds={statusPulseTaskIds}
                      tasksByParent={tasksByParent}
                      tasks={mobileFilteredRootTasks}
                    />
                  ) : null}
                </div>
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
          key={editingTask.id}
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

      {isDraftModalOpen ? (
        <AiDraftModal
          draft={draftPlan}
          editorError={draftError}
          isSaving={isSavingDraft}
          onAddSubtask={handleAddDraftSubtask}
          onCancel={handleCancelDraft}
          onConfirm={() => void handleConfirmDraft()}
          onRemoveSubtask={handleRemoveDraftSubtask}
          onRetry={handleRetryDraftPreview}
          onStoryChange={handleDraftStoryChange}
          onSubtaskChange={handleDraftSubtaskChange}
          previewError={draftPreviewError}
          removingSubtaskKeys={removingDraftSubtaskKeys}
          saveState={draftSaveState}
          status={draftModalStatus}
          subtaskKeys={draftSubtaskKeys}
        />
      ) : null}

      <ToastViewport onDismiss={dismissToast} toasts={toasts} />
    </main>
  );
}

function MobileTaskList({
  confirmingDeleteId,
  expandedTaskIds,
  isDisabled,
  onCancelDelete,
  onDelete,
  onOpenDetails,
  onStartDelete,
  onStatusChange,
  onToggleExpandedTask,
  onToggle,
  pendingIds,
  statusPulseTaskIds,
  tasksByParent,
  tasks,
}: {
  confirmingDeleteId: string | null;
  expandedTaskIds: Set<string>;
  isDisabled: boolean;
  onCancelDelete: () => void;
  onDelete: (task: Task) => void | Promise<void>;
  onOpenDetails: (task: Task) => void;
  onStartDelete: (taskId: string) => void;
  onStatusChange: (task: Task, status: TaskStatus) => void | Promise<void>;
  onToggleExpandedTask: (taskId: string) => void;
  onToggle: (task: Task) => void | Promise<void>;
  pendingIds: Set<string>;
  statusPulseTaskIds: Set<string>;
  tasksByParent: Map<string, Task[]>;
  tasks: Task[];
}) {
  return (
    <ul className="mobile-task-list" aria-label="Tarefas em lista">
      {tasks.map((task) => (
        <MobileTaskCard
          isConfirmingDelete={confirmingDeleteId === task.id}
          isDisabled={isDisabled}
          isExpanded={expandedTaskIds.has(task.id)}
          isPending={pendingIds.has(task.id)}
          key={task.id}
          onCancelDelete={onCancelDelete}
          onDelete={onDelete}
          onOpenDetails={onOpenDetails}
          onStartDelete={onStartDelete}
          onStatusChange={onStatusChange}
          onToggleExpandedTask={onToggleExpandedTask}
          onToggle={onToggle}
          pendingIds={pendingIds}
          statusPulseTaskIds={statusPulseTaskIds}
          task={task}
          subtasks={tasksByParent.get(task.id) ?? []}
        />
      ))}
    </ul>
  );
}

function MobileTaskCard({
  isConfirmingDelete,
  isDisabled,
  isExpanded,
  isPending,
  onCancelDelete,
  onDelete,
  onOpenDetails,
  onStartDelete,
  onStatusChange,
  onToggleExpandedTask,
  onToggle,
  pendingIds,
  statusPulseTaskIds,
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
  onStatusChange: (task: Task, status: TaskStatus) => void | Promise<void>;
  onToggleExpandedTask: (taskId: string) => void;
  onToggle: (task: Task) => void | Promise<void>;
  pendingIds: Set<string>;
  statusPulseTaskIds: Set<string>;
  subtasks: Task[];
  task: Task;
}) {
  const status = getTaskStatus(task);
  const description = task.description?.trim();
  const label = task.label?.trim();
  const completedSubtasks = subtasks.filter(
    (subtask) => getTaskStatus(subtask) === DONE_STATUS,
  ).length;
  const subtaskProgress =
    subtasks.length > 0
      ? Math.round((completedSubtasks / subtasks.length) * 100)
      : 0;
  const className = [
    'task-card',
    'mobile-task-card',
    `status-${status}`,
    subtasks.length > 0 ? 'has-subtasks' : '',
    isExpanded ? 'expanded' : '',
    status === DONE_STATUS ? 'done' : '',
    statusPulseTaskIds.has(task.id) ? 'status-just-changed' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <li className={className}>
      <div className="task-card-actions mobile-card-actions">
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
              className={
                status === DONE_STATUS ? 'toggle-button completed' : 'toggle-button'
              }
              disabled={isPending}
              onClick={() => void onToggle(task)}
              type="button"
            >
              {status === DONE_STATUS ? (
                <CheckCircle2 size={21} aria-hidden="true" />
              ) : (
                <Circle size={21} aria-hidden="true" />
              )}
              <span className="mobile-action-label" aria-hidden="true">
                {status === DONE_STATUS ? 'Reabrir' : 'Concluir'}
              </span>
              <span className="sr-only">
                {status === DONE_STATUS
                  ? 'Marcar como pendente'
                  : 'Marcar como concluída'}
              </span>
            </button>
          )}
        </Tooltip>

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
                  <span className="mobile-action-label" aria-hidden="true">
                    Cancelar
                  </span>
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
                  <Loader2 className="spin" size={18} aria-hidden="true" />
                ) : (
                  <Trash2 size={18} aria-hidden="true" />
                )}
                <span className="mobile-action-label" aria-hidden="true">
                  Excluir
                </span>
                <span className="sr-only">Excluir tarefa</span>
              </button>
            )}
          </Tooltip>
        )}
      </div>

      <label className="mobile-status-control">
        <span>Status</span>
        <select
          aria-label={`Alterar status de ${task.title}`}
          disabled={isDisabled || isPending}
          onChange={(event) =>
            void onStatusChange(task, event.target.value as TaskStatus)
          }
          value={status}
        >
          {TASK_LANES.map((lane) => (
            <option key={lane.status} value={lane.status}>
              {lane.label}
            </option>
          ))}
        </select>
      </label>

      {subtasks.length > 0 ? (
        <div
          className="story-progress"
          aria-label={`${completedSubtasks} de ${subtasks.length} subtarefas concluidas`}
        >
          <div className="story-progress-row">
            <span>
              <ListChecks size={14} aria-hidden="true" />
              <AnimatedNumber value={completedSubtasks} />/{subtasks.length}{' '}
              subtarefas
            </span>
            <strong>
              <AnimatedNumber suffix="%" value={subtaskProgress} />
            </strong>
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
            <span className="mobile-edit-callout">
              <Pencil size={14} aria-hidden="true" />
              Editar detalhes
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
            <ul
              className="subtask-list"
              aria-label={`Subtarefas de ${task.title}`}
            >
              {subtasks.map((subtask) => {
                const subtaskStatus = getTaskStatus(subtask);
                const subtaskLabel = subtask.label?.trim();

                return (
                  <li className="subtask-item" key={subtask.id}>
                    <button
                      className={
                        subtaskStatus === DONE_STATUS
                          ? 'subtask-check completed'
                          : 'subtask-check'
                      }
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
                      <small>
                        {subtaskLabel || TASK_STATUS_LABELS[subtaskStatus]}
                      </small>
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
  statusPulseTaskIds,
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
  statusPulseTaskIds: Set<string>;
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
              statusPulseTaskIds={statusPulseTaskIds}
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
  statusPulseTaskIds,
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
  statusPulseTaskIds: Set<string>;
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
    statusPulseTaskIds.has(task.id) ? 'status-just-changed' : '',
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
                className={
                  status === DONE_STATUS
                    ? 'toggle-button completed'
                    : 'toggle-button'
                }
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
        <div
          className="story-progress"
          aria-label={`${completedSubtasks} de ${subtasks.length} subtarefas concluidas`}
        >
          <div className="story-progress-row">
            <span>
              <ListChecks size={14} aria-hidden="true" />
              <AnimatedNumber value={completedSubtasks} />/{subtasks.length}{' '}
              subtarefas
            </span>
            <strong>
              <AnimatedNumber suffix="%" value={subtaskProgress} />
            </strong>
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
            <ul
              className="subtask-list"
              aria-label={`Subtarefas de ${task.title}`}
            >
              {subtasks.map((subtask) => {
                const subtaskStatus = getTaskStatus(subtask);
                const subtaskLabel = subtask.label?.trim();

                return (
                  <li className="subtask-item" key={subtask.id}>
                    <button
                      className={
                        subtaskStatus === DONE_STATUS
                          ? 'subtask-check completed'
                          : 'subtask-check'
                      }
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
                      <small>
                        {subtaskLabel || TASK_STATUS_LABELS[subtaskStatus]}
                      </small>
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

function AiDraftModal({
  draft,
  editorError,
  isSaving,
  onAddSubtask,
  onCancel,
  onConfirm,
  onRemoveSubtask,
  onRetry,
  onStoryChange,
  onSubtaskChange,
  previewError,
  removingSubtaskKeys,
  saveState,
  status,
  subtaskKeys,
}: {
  draft: AiDraftPlan | null;
  editorError: string | null;
  isSaving: boolean;
  onAddSubtask: () => void;
  onCancel: () => void;
  onConfirm: () => void;
  onRemoveSubtask: (index: number) => void;
  onRetry: () => void;
  onStoryChange: (field: keyof AiDraftTask, value: string) => void;
  onSubtaskChange: (
    index: number,
    field: keyof AiDraftTask,
    value: string,
  ) => void;
  previewError: string | null;
  removingSubtaskKeys: Set<string>;
  saveState: DraftSaveState;
  status: AiDraftModalStatus;
  subtaskKeys: string[];
}) {
  const dialogTitleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const isLoading = status === 'loading';
  const activeSubtaskCount =
    draft?.subtasks.filter((_subtask, index) => {
      const subtaskKey = subtaskKeys[index];
      return !subtaskKey || !removingSubtaskKeys.has(subtaskKey);
    }).length ?? 0;
  const title =
    status === 'error'
      ? 'Nao foi possivel gerar'
      : isLoading
        ? 'Gerando rascunho'
        : 'Revise antes de salvar';
  const eyebrow =
    status === 'error'
      ? 'Rascunho interrompido'
      : isLoading
        ? 'Rascunho da IA'
        : 'Rascunho da IA';

  useEffect(() => {
    const focusableElement = dialogRef.current?.querySelector<HTMLElement>(
      [
        'input:not([disabled])',
        'button:not([disabled])',
        'select:not([disabled])',
        'textarea:not([disabled])',
        '[href]',
        '[tabindex]:not([tabindex="-1"])',
      ].join(','),
    );

    focusableElement?.focus();
  }, [status]);

  useEffect(() => {
    function getFocusableElements() {
      return Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          [
            'button:not([disabled])',
            'input:not([disabled])',
            'select:not([disabled])',
            'textarea:not([disabled])',
            '[href]',
            '[tabindex]:not([tabindex="-1"])',
          ].join(','),
        ) ?? [],
      ).filter((element) => element.offsetParent !== null);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
        return;
      }

      if (event.key !== 'Tab') {
        return;
      }

      const focusableElements = getFocusableElements();

      if (focusableElements.length === 0) {
        event.preventDefault();
        return;
      }

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
        return;
      }

      if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onCancel]);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onCancel();
        }
      }}
    >
      <section
        aria-busy={isLoading}
        aria-labelledby={dialogTitleId}
        aria-modal="true"
        className="task-modal ai-draft-modal"
        ref={dialogRef}
        role="dialog"
      >
        <div className="modal-header">
          <div>
            <p className="eyebrow">{eyebrow}</p>
            <h2 id={dialogTitleId}>{title}</h2>
          </div>
          <div className="draft-modal-header-actions">
            {status === 'ready' && draft ? (
              <span>
                <AnimatedNumber value={activeSubtaskCount} /> subtarefas
              </span>
            ) : null}
            <button
              aria-label="Fechar rascunho"
              className="icon-button neutral"
              disabled={isSaving}
              onClick={onCancel}
              type="button"
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="ai-draft-modal-body">
          <div className="draft-state-pane" key={status}>
            {status === 'loading' ? (
              <AiDraftLoadingState onCancel={onCancel} />
            ) : null}

            {status === 'error' ? (
              <AiDraftErrorState
                message={previewError ?? 'Nao foi possivel gerar o rascunho.'}
                onCancel={onCancel}
                onRetry={onRetry}
              />
            ) : null}

            {status === 'ready' && draft ? (
              <DraftPlanEditor
                activeSubtaskCount={activeSubtaskCount}
                draft={draft}
                error={editorError}
                isSaving={isSaving}
                onAddSubtask={onAddSubtask}
                onCancel={onCancel}
                onConfirm={onConfirm}
                onRemoveSubtask={onRemoveSubtask}
                onStoryChange={onStoryChange}
                onSubtaskChange={onSubtaskChange}
                removingSubtaskKeys={removingSubtaskKeys}
                saveState={saveState}
                subtaskKeys={subtaskKeys}
              />
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}

function AiDraftLoadingState({ onCancel }: { onCancel: () => void }) {
  return (
    <div className="draft-loading-state">
      <div
        aria-label="Carregando rascunho"
        className="draft-loading-copy"
        role="status"
      >
        <Sparkles size={18} aria-hidden="true" />
        <span>Organizando historia e subtarefas editaveis...</span>
      </div>

      <div className="draft-skeleton-layout" aria-hidden="true">
        <div className="draft-skeleton-card story">
          <span />
          <strong />
          <p />
          <p />
        </div>
        {Array.from({ length: 3 }, (_item, index) => (
          <div className="draft-skeleton-card" key={index}>
            <span />
            <strong />
            <p />
          </div>
        ))}
      </div>

      <div className="draft-actions">
        <button className="button tertiary" onClick={onCancel} type="button">
          <X size={18} aria-hidden="true" />
          Cancelar
        </button>
      </div>
    </div>
  );
}

function AiDraftErrorState({
  message,
  onCancel,
  onRetry,
}: {
  message: string;
  onCancel: () => void;
  onRetry: () => void;
}) {
  return (
    <div className="draft-error-state">
      <p className="draft-error" role="alert">
        <AlertCircle size={16} aria-hidden="true" />
        {message}
      </p>
      <div className="draft-actions">
        <button className="button tertiary" onClick={onCancel} type="button">
          <X size={18} aria-hidden="true" />
          Cancelar
        </button>
        <button className="button primary" onClick={onRetry} type="button">
          <RefreshCw size={18} aria-hidden="true" />
          Tentar novamente
        </button>
      </div>
    </div>
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
  const dialogRef = useRef<HTMLFormElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const isCreateMode = mode === 'create';
  const dialogTitle = isCreateMode ? 'Captura rápida' : 'Editar tarefa';
  const eyebrow = isCreateMode ? 'Nova tarefa' : 'Detalhes da tarefa';
  const submitLabel = isCreateMode ? 'Criar tarefa' : 'Salvar detalhes';
  const savingLabel = isCreateMode ? 'Criando...' : 'Salvando...';
  const submitTooltip = isCreateMode
    ? tooltipCopy.createTaskDetails
    : tooltipCopy.updateTaskDetails;

  useEffect(() => {
    titleInputRef.current?.focus();
  }, []);

  useEffect(() => {
    function getFocusableElements() {
      return Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          [
            'button:not([disabled])',
            'input:not([disabled])',
            'select:not([disabled])',
            'textarea:not([disabled])',
            '[href]',
            '[tabindex]:not([tabindex="-1"])',
          ].join(','),
        ) ?? [],
      ).filter((element) => element.offsetParent !== null);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== 'Tab') {
        return;
      }

      const focusableElements = getFocusableElements();

      if (focusableElements.length === 0) {
        event.preventDefault();
        return;
      }

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
        return;
      }

      if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
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
        ref={dialogRef}
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
                  ref={titleInputRef}
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
                <AnimatedNumber
                  value={
                    subtasks.filter(
                      (subtask) => getTaskStatus(subtask) === DONE_STATUS,
                    ).length
                  }
                />
                /{subtasks.length}
              </strong>
            </div>
            <ul className="modal-subtask-list">
              {subtasks.map((subtask) => {
                const subtaskStatus = getTaskStatus(subtask);
                const isSubtaskPending = pendingIds.has(subtask.id);

                return (
                  <li key={subtask.id}>
                    <button
                      className={
                        subtaskStatus === DONE_STATUS
                          ? 'subtask-check completed'
                          : 'subtask-check'
                      }
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
            <AnimatedNumber suffix={suffix} value={value} />
          </strong>
        </div>
      )}
    </Tooltip>
  );
}

function AnimatedNumber({
  suffix = '',
  value,
}: {
  suffix?: string;
  value: number;
}) {
  return (
    <span className="animated-number" key={`${value}${suffix}`}>
      {value}
      {suffix}
    </span>
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

function DraftPlanEditor({
  activeSubtaskCount,
  draft,
  error,
  isSaving,
  onAddSubtask,
  onCancel,
  onConfirm,
  onRemoveSubtask,
  onStoryChange,
  onSubtaskChange,
  removingSubtaskKeys,
  saveState,
  subtaskKeys,
}: {
  activeSubtaskCount: number;
  draft: AiDraftPlan;
  error: string | null;
  isSaving: boolean;
  onAddSubtask: () => void;
  onCancel: () => void;
  onConfirm: () => void;
  onRemoveSubtask: (index: number) => void;
  onStoryChange: (field: keyof AiDraftTask, value: string) => void;
  onSubtaskChange: (
    index: number,
    field: keyof AiDraftTask,
    value: string,
  ) => void;
  removingSubtaskKeys: Set<string>;
  saveState: DraftSaveState;
  subtaskKeys: string[];
}) {
  const storyTitleId = useId();
  const storyDescriptionId = useId();
  const storyLabelId = useId();
  const isConfirmed = saveState === 'confirmed';
  const isSavingPlan = saveState === 'saving';

  return (
    <section className="draft-panel" aria-label="Rascunho do plano">
      <div className="draft-card">
        <div className="field-group">
          <div className="label-row">
            <label htmlFor={storyTitleId}>Titulo da historia</label>
            <span>{draft.story.title.length}/{TASK_MAX_LENGTH}</span>
          </div>
          <input
            disabled={isSaving}
            id={storyTitleId}
            maxLength={TASK_MAX_LENGTH}
            onChange={(event) => onStoryChange('title', event.target.value)}
            value={draft.story.title}
          />
        </div>

        <div className="field-group">
          <div className="label-row">
            <label htmlFor={storyDescriptionId}>Descricao</label>
            <span>
              {sanitizeDraftText(draft.story.description).length}/
              {TASK_DESCRIPTION_MAX_LENGTH}
            </span>
          </div>
          <textarea
            disabled={isSaving}
            id={storyDescriptionId}
            maxLength={TASK_DESCRIPTION_MAX_LENGTH}
            onChange={(event) =>
              onStoryChange('description', event.target.value)
            }
            rows={3}
            value={sanitizeDraftText(draft.story.description)}
          />
        </div>

        <div className="field-group">
          <div className="label-row">
            <label htmlFor={storyLabelId}>Etiqueta</label>
            <span>{sanitizeDraftText(draft.story.label).length}/{TASK_LABEL_MAX_LENGTH}</span>
          </div>
          <input
            disabled={isSaving}
            id={storyLabelId}
            maxLength={TASK_LABEL_MAX_LENGTH}
            onChange={(event) => onStoryChange('label', event.target.value)}
            value={sanitizeDraftText(draft.story.label)}
          />
        </div>
      </div>

      <div className="draft-subtasks-header">
        <span>Subtarefas</span>
        <button
          className="mini-button"
          disabled={isSaving || activeSubtaskCount >= AI_DRAFT_MAX_SUBTASKS}
          onClick={onAddSubtask}
          type="button"
        >
          <Plus size={16} aria-hidden="true" />
          Adicionar
        </button>
      </div>

      <div className="draft-subtask-list">
        {draft.subtasks.map((subtask, index) => {
          const subtaskKey = subtaskKeys[index] ?? `draft-subtask-${index}`;
          const isRemoving = removingSubtaskKeys.has(subtaskKey);

          return (
            <DraftSubtaskEditor
              index={index}
              isRemoving={isRemoving}
              isSaving={isSaving}
              key={subtaskKey}
              onChange={onSubtaskChange}
              onRemove={onRemoveSubtask}
              subtask={subtask}
            />
          );
        })}
      </div>

      {error ? (
        <p className="draft-error" role="alert">
          <AlertCircle size={16} aria-hidden="true" />
          {error}
        </p>
      ) : null}

      <div className="draft-actions">
        <button
          className="button tertiary"
          disabled={isSaving}
          onClick={onCancel}
          type="button"
        >
          <X size={18} aria-hidden="true" />
          Cancelar
        </button>
        <button
          className={isConfirmed ? 'button primary confirmed' : 'button primary'}
          disabled={isSaving}
          onClick={onConfirm}
          type="button"
        >
          {isSavingPlan ? (
            <Loader2 className="spin" size={18} aria-hidden="true" />
          ) : isConfirmed ? (
            <CheckCircle2 size={18} aria-hidden="true" />
          ) : (
            <Save size={18} aria-hidden="true" />
          )}
          {isSavingPlan
            ? 'Salvando plano...'
            : isConfirmed
              ? 'Plano salvo'
              : 'Salvar plano'}
        </button>
      </div>
    </section>
  );
}

function DraftSubtaskEditor({
  index,
  isRemoving,
  isSaving,
  onChange,
  onRemove,
  subtask,
}: {
  index: number;
  isRemoving: boolean;
  isSaving: boolean;
  onChange: (index: number, field: keyof AiDraftTask, value: string) => void;
  onRemove: (index: number) => void;
  subtask: AiDraftTask;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const labelId = useId();
  const itemNumber = index + 1;

  return (
    <section
      className={
        isRemoving ? 'draft-subtask-card removing' : 'draft-subtask-card'
      }
      aria-label={`Subtarefa ${itemNumber}`}
      aria-hidden={isRemoving ? 'true' : undefined}
    >
      <div className="draft-subtask-title-row">
        <strong>#{itemNumber}</strong>
        <button
          aria-label={`Remover subtarefa ${itemNumber}`}
          className="icon-button danger"
          disabled={isSaving || isRemoving}
          onClick={() => onRemove(index)}
          type="button"
        >
          <Trash2 size={17} aria-hidden="true" />
        </button>
      </div>

      <div className="field-group">
        <div className="label-row">
          <label htmlFor={titleId}>Titulo</label>
          <span>{subtask.title.length}/{TASK_MAX_LENGTH}</span>
        </div>
        <input
          disabled={isSaving || isRemoving}
          id={titleId}
          maxLength={TASK_MAX_LENGTH}
          onChange={(event) => onChange(index, 'title', event.target.value)}
          value={subtask.title}
        />
      </div>

      <div className="field-group">
        <div className="label-row">
          <label htmlFor={descriptionId}>Descricao</label>
          <span>
            {sanitizeDraftText(subtask.description).length}/
            {TASK_DESCRIPTION_MAX_LENGTH}
          </span>
        </div>
        <textarea
          disabled={isSaving || isRemoving}
          id={descriptionId}
          maxLength={TASK_DESCRIPTION_MAX_LENGTH}
          onChange={(event) => onChange(index, 'description', event.target.value)}
          rows={2}
          value={sanitizeDraftText(subtask.description)}
        />
      </div>

      <div className="field-group">
        <div className="label-row">
          <label htmlFor={labelId}>Etiqueta</label>
          <span>{sanitizeDraftText(subtask.label).length}/{TASK_LABEL_MAX_LENGTH}</span>
        </div>
        <input
          disabled={isSaving || isRemoving}
          id={labelId}
          maxLength={TASK_LABEL_MAX_LENGTH}
          onChange={(event) => onChange(index, 'label', event.target.value)}
          value={sanitizeDraftText(subtask.label)}
        />
      </div>
    </section>
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
