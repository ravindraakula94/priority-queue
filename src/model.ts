export type TaskStatus = 'queued' | 'completed' | 'archived'

export interface QueueTask {
  id: string
  title: string
  tags: string[]
  due: string
  status: TaskStatus
  createdAt: number
  completedAt: number | null
}

export interface Session {
  taskId: string
  title: string
  start: number
  end: number
}

export interface QueueState {
  version: 1
  tasks: QueueTask[]
  sessions: Session[]
  focusId: string | null
  runningSince: number | null
}

export type Action =
  | { type: 'add'; task: QueueTask }
  | { type: 'edit'; id: string; title: string; tags: string[]; due: string }
  | { type: 'focus'; id: string }
  | { type: 'pause' }
  | { type: 'lock'; at: number }
  | { type: 'complete-next'; id: string }
  | { type: 'complete' | 'archive' | 'restore' | 'delete'; id: string }
  | { type: 'move'; id: string; overId: string }
  | { type: 'tick' }

export function emptyState(): QueueState {
  return { version: 1, tasks: [], sessions: [], focusId: null, runningSince: null }
}

export function makeTask(title: string, tags: string[], due: string, now = Date.now()): QueueTask {
  return { id: crypto.randomUUID(), title: title.trim(), tags, due, status: 'queued', createdAt: now, completedAt: null }
}

export function parseTags(value: string): string[] {
  return [...new Set(value.split(',').map(tag => tag.trim().replace(/^#/, '').toLowerCase()).filter(Boolean))].slice(0, 8)
}

export function checkpoint(state: QueueState, now: number): QueueState {
  if (state.runningSince === null || !state.focusId) return state
  const task = state.tasks.find(task => task.id === state.focusId && task.status === 'queued')
  if (!task) return { ...state, focusId: null, runningSince: null }
  if (now <= state.runningSince) return { ...state, runningSince: now }
  const sessions = [...state.sessions]
  const previous = sessions.at(-1)
  if (previous?.taskId === task.id && previous.end === state.runningSince) {
    sessions[sessions.length - 1] = { ...previous, end: now }
  } else {
    sessions.push({ taskId: task.id, title: task.title, start: state.runningSince, end: now })
  }
  return { ...state, sessions, runningSince: now }
}

export function transition(current: QueueState, action: Action, now = Date.now()): QueueState {
  if (action.type === 'lock') {
    const at = Math.min(now, action.at)
    const stopped = current.runningSince !== null && current.runningSince <= at ? checkpoint(current, at) : current
    return {
      ...stopped,
      runningSince: null,
      sessions: stopped.sessions.filter(session => session.start < at).map(session => session.end > at ? { ...session, end: at } : session),
    }
  }
  const state = checkpoint(current, now)
  switch (action.type) {
    case 'tick': return state
    case 'add': return { ...state, tasks: [...state.tasks, action.task] }
    case 'edit': return { ...state, tasks: state.tasks.map(task => task.id === action.id ? { ...task, title: action.title.trim(), tags: action.tags, due: action.due } : task) }
    case 'focus':
      if (!state.tasks.some(task => task.id === action.id && task.status === 'queued')) return state
      return { ...state, focusId: action.id, runningSince: now }
    case 'pause': return { ...state, runningSince: null }
    case 'complete-next': {
      if (!state.tasks.some(task => task.id === action.id && task.status === 'queued')) return state
      const completed = transition(state, { type: 'complete', id: action.id }, now)
      const next = completed.tasks.find(task => task.status === 'queued')
      return { ...completed, focusId: next?.id ?? null, runningSince: next && state.runningSince !== null ? now : null }
    }
    case 'complete':
    case 'archive':
    case 'restore':
    case 'delete': {
      const status = action.type === 'complete' ? 'completed' : action.type === 'archive' ? 'archived' : 'queued'
      const tasks = action.type === 'delete'
        ? state.tasks.filter(task => task.id !== action.id)
        : state.tasks.map(task => task.id !== action.id ? task : {
          ...task, status: status as TaskStatus,
          completedAt: action.type === 'complete' ? now : action.type === 'restore' ? null : task.completedAt,
        })
      return { ...state, tasks, ...(state.focusId === action.id ? { focusId: null, runningSince: null } : {}) }
    }
    case 'move': {
      const tasks = [...state.tasks]
      const from = tasks.findIndex(task => task.id === action.id && task.status === 'queued')
      const to = tasks.findIndex(task => task.id === action.overId && task.status === 'queued')
      if (from < 0 || to < 0) return state
      const [task] = tasks.splice(from, 1)
      tasks.splice(to, 0, task)
      return { ...state, tasks }
    }
  }
}

export function persistedState(state: QueueState): QueueState {
  return { ...state, runningSince: null }
}

export function restoreState(value: unknown): QueueState {
  if (value === null || value === undefined) return emptyState()
  if (typeof value !== 'object') throw new Error('Invalid saved queue.')
  const state = value as QueueState
  const finiteTime = (time: unknown): time is number => typeof time === 'number' && Number.isFinite(time) && time >= 0
  if (state.version !== 1 || !Array.isArray(state.tasks) || !Array.isArray(state.sessions)
    || !state.tasks.every(task => task && typeof task.id === 'string' && typeof task.title === 'string'
      && Array.isArray(task.tags) && task.tags.every(tag => typeof tag === 'string')
      && typeof task.due === 'string' && (task.due === '' || /^\d{4}-\d{2}-\d{2}$/.test(task.due))
      && ['queued', 'completed', 'archived'].includes(task.status)
      && finiteTime(task.createdAt) && (task.completedAt === null || finiteTime(task.completedAt)))
    || new Set(state.tasks.map(task => task.id)).size !== state.tasks.length
    || !state.sessions.every(session => session && typeof session.taskId === 'string' && typeof session.title === 'string'
      && finiteTime(session.start) && finiteTime(session.end) && session.end >= session.start)) {
    throw new Error('Saved queue is not valid. Your original data has not been changed.')
  }
  return { ...state, focusId: state.tasks.some(task => task.id === state.focusId && task.status === 'queued') ? state.focusId : null, runningSince: null }
}

export function taskMilliseconds(state: QueueState, id: string, now: number): number {
  return state.sessions.reduce((total, session) => total + (session.taskId === id ? session.end - session.start : 0), 0)
    + (state.focusId === id && state.runningSince !== null ? Math.max(0, now - state.runningSince) : 0)
}

export function dayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function dailySummary(state: QueueState, date: Date, now: number) {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const end = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime()
  const sessions = checkpoint(state, now).sessions
  const byTask = new Map<string, { title: string; milliseconds: number }>()
  let milliseconds = 0
  for (const session of sessions) {
    const overlap = Math.max(0, Math.min(end, session.end) - Math.max(start, session.start))
    if (!overlap) continue
    milliseconds += overlap
    const previous = byTask.get(session.taskId)
    byTask.set(session.taskId, {
      title: state.tasks.find(task => task.id === session.taskId)?.title ?? session.title,
      milliseconds: (previous?.milliseconds ?? 0) + overlap,
    })
  }
  const completed = state.tasks.filter(task => task.completedAt !== null && task.completedAt >= start && task.completedAt < end).length
  return { milliseconds, completed, byTask: [...byTask.entries()].sort((first, second) => second[1].milliseconds - first[1].milliseconds) }
}

export function clock(milliseconds: number): string {
  const seconds = Math.floor(Math.max(0, milliseconds) / 1000)
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor(seconds / 60) % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

export function duration(milliseconds: number): string {
  const minutes = Math.floor(Math.max(0, milliseconds) / 60000)
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`
}