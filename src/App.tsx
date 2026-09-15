import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Activity, Archive, ArrowDown, ArrowUp, ArrowUpRight, CalendarDays, Check, CheckCheck, ChevronLeft, ChevronRight, Circle, CircleCheck, Clock3, GripVertical, ListOrdered, Maximize2, Minimize2, MoreHorizontal, Pause, Pencil, Pin, PinOff, Play, Plus, RotateCcw, Search, Trash2, TriangleAlert, X } from 'lucide-react'
import { clock, dailySummary, dayKey, duration, makeTask, parseTags, taskMilliseconds, transition, type Action, type QueueState, type QueueTask } from './model'
import { desktop, saveQueue } from './storage'
import { dragOverlay, setCompactWindow } from './windowMode'
import { watchSession, type SessionState } from './session'

type View = 'queued' | 'completed' | 'archived' | 'activity'
type DialogState = { kind: 'edit'; task?: QueueTask } | { kind: 'delete'; task: QueueTask } | null

function IconButton({ label, children, onClick, disabled = false, active = false }: { label: string; children: ReactNode; onClick: () => void; disabled?: boolean; active?: boolean }) {
  return <button type="button" className={`icon-button${active ? ' is-active' : ''}`} title={label} aria-label={label} onClick={onClick} disabled={disabled}>{children}</button>
}

function Modal({ label, children, close }: { label: string; children: ReactNode; close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { const dialog = ref.current!; dialog.showModal(); return () => dialog.close() }, [])
  return <dialog ref={ref} aria-label={label} onCancel={close} onClick={event => { if (event.target === event.currentTarget) close() }}><div className="dialog-body">{children}</div></dialog>
}

function TaskEditor({ task, close, submit }: { task?: QueueTask; close: () => void; submit: (title: string, tags: string[], due: string) => void }) {
  const [title, setTitle] = useState(task?.title ?? '')
  const [tags, setTags] = useState(task?.tags.join(', ') ?? '')
  const [due, setDue] = useState(task?.due ?? '')
  function save(event: FormEvent) {
    event.preventDefault()
    if (title.trim()) submit(title.trim(), parseTags(tags), due)
  }
  return <Modal label={task ? 'Edit task' : 'New task'} close={close}>
    <header className="dialog-header"><h2>{task ? 'Edit task' : 'New task'}</h2><IconButton label="Close" onClick={close}><X /></IconButton></header>
    <form onSubmit={save}>
      <label htmlFor="task-title">Task</label>
      <textarea id="task-title" autoFocus required maxLength={300} rows={3} value={title} onChange={event => setTitle(event.target.value)} placeholder="What needs your attention?" />
      <div className="form-columns"><div><label htmlFor="task-tags">Tags</label><input id="task-tags" maxLength={200} value={tags} onChange={event => setTags(event.target.value)} placeholder="work, personal" /></div><div><label htmlFor="task-due">Due date</label><input id="task-due" type="date" value={due} onChange={event => setDue(event.target.value)} /></div></div>
      <footer className="dialog-footer"><button type="button" className="secondary-button" onClick={close}>Cancel</button><button className="primary-button" type="submit" disabled={!title.trim()}><Check size={16} />{task ? 'Save changes' : 'Add task'}</button></footer>
    </form>
  </Modal>
}

function TaskRow({ task, index, state, now, dispatch, edit, remove, previous, next }: {
  task: QueueTask; index: number; state: QueueState; now: number; dispatch: (action: Action) => void; edit: () => void; remove: () => void; previous?: string; next?: string
}) {
  const [menu, setMenu] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const { attributes, listeners, setNodeRef, transform, transition: movement, isDragging } = useSortable({ id: task.id, disabled: task.status !== 'queued' })
  const focused = state.focusId === task.id
  const running = focused && state.runningSince !== null
  const today = dayKey(new Date(now))
  const dueLabel = !task.due ? '' : task.due === today ? 'Today' : new Date(`${task.due}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  useEffect(() => {
    if (!menu) return
    const dismiss = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node)) setMenu(false) }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [menu])
  function act(action: () => void) { setMenu(false); action() }
  return <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition: movement }} className={`task-row${focused ? ' focused' : ''}${isDragging ? ' dragging' : ''}`} data-task-id={task.id}>
    {task.status === 'queued' ? <button type="button" className="drag-handle" {...attributes} {...listeners} aria-label={`Reorder ${task.title}`} title="Reorder task"><GripVertical size={16} /></button> : <span className="row-index">{String(index + 1).padStart(2, '0')}</span>}
    <IconButton label={task.status === 'queued' ? `Complete ${task.title}` : `Restore ${task.title}`} onClick={() => dispatch({ type: task.status === 'queued' ? 'complete' : 'restore', id: task.id })}>{task.status === 'queued' ? <Circle /> : <CircleCheck />}</IconButton>
    <div className="task-content"><button className="task-title" onClick={edit}>{task.title}</button><div className="task-meta">
      {task.tags.map(tag => <span className={`tag tag-${tag.length % 3}`} key={tag}>#{tag}</span>)}
      {dueLabel && <span className={`due${task.due < today && task.status === 'queued' ? ' overdue' : ''}`}><CalendarDays size={11} />{dueLabel}</span>}
      {focused && <span className="focus-label">{running ? 'In focus' : 'Paused'}</span>}
    </div></div>
    <span className="task-time" title="Total focus time">{duration(taskMilliseconds(state, task.id, now))}</span>
    {task.status === 'queued' && <IconButton label={running ? `Pause ${task.title}` : `Focus ${task.title}`} active={focused} onClick={() => dispatch(running ? { type: 'pause' } : { type: 'focus', id: task.id })}>{running ? <Pause /> : <Play />}</IconButton>}
    <div className="menu-anchor" ref={menuRef} onKeyDown={event => { if (event.key === 'Escape') setMenu(false) }}>
      <button className="icon-button" aria-label={`Actions for ${task.title}`} title="Task actions" aria-expanded={menu} aria-haspopup="menu" onClick={() => setMenu(!menu)}><MoreHorizontal /></button>
      {menu && <div className="task-menu" role="menu" aria-label="Task actions">
        <button role="menuitem" onClick={() => act(edit)}><Pencil />Edit task</button>
        {task.status === 'queued' && <><button role="menuitem" disabled={!previous} onClick={() => act(() => dispatch({ type: 'move', id: task.id, overId: previous! }))}><ArrowUp />Move up</button><button role="menuitem" disabled={!next} onClick={() => act(() => dispatch({ type: 'move', id: task.id, overId: next! }))}><ArrowDown />Move down</button></>}
        {task.status !== 'archived' && <button role="menuitem" onClick={() => act(() => dispatch({ type: 'archive', id: task.id }))}><Archive />Archive</button>}
        {task.status !== 'queued' && <button role="menuitem" onClick={() => act(() => dispatch({ type: 'restore', id: task.id }))}><RotateCcw />Return to queue</button>}
        <button role="menuitem" className="danger-text" onClick={() => act(remove)}><Trash2 />Delete task</button>
      </div>}
    </div>
  </li>
}

export default function App({ initialState }: { initialState: QueueState }) {
  const [state, setState] = useState(initialState)
  const current = useRef(initialState)
  const [now, setNow] = useState(Date.now())
  const [view, setView] = useState<View>('queued')
  const [search, setSearch] = useState('')
  const [tag, setTag] = useState('')
  const [due, setDue] = useState('')
  const [dialog, setDialog] = useState<DialogState>(null)
  const [saveStatus, setSaveStatus] = useState('Saved locally')
  const [saveError, setSaveError] = useState(false)
  const [notice, setNotice] = useState('')
  const [pinned, setPinned] = useState(true)
  const [compact, setCompact] = useState(false)
  const [modeBusy, setModeBusy] = useState(false)
  const changingMode = useRef(false)
  const [screenLocked, setScreenLocked] = useState(false)
  const [pausedByLock, setPausedByLock] = useState(false)
  const locked = useRef(false)
  const lastLock = useRef(Date.now())
  const [activityDay, setActivityDay] = useState(dayKey(new Date()))
  const searchRef = useRef<HTMLInputElement>(null)
  const writeVersion = useRef(0)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))

  function persist(next: QueueState) {
    const version = ++writeVersion.current
    setSaveStatus('Saving...')
    return saveQueue(next).then(() => {
      if (version === writeVersion.current) { setSaveStatus('Saved locally'); setSaveError(false) }
    }).catch((error: unknown) => {
      setSaveStatus(`Save failed: ${String(error)}`)
      setSaveError(true)
      throw error
    })
  }

  function dispatch(action: Action) {
    if (locked.current && (action.type === 'focus' || action.type === 'complete-next')) return
    if (action.type === 'focus' || action.type === 'complete' || action.type === 'complete-next') setPausedByLock(false)
    const next = transition(current.current, action)
    current.current = next
    setState(next)
    setNow(Date.now())
    void persist(next).catch(() => undefined)
  }

  async function changeMode(next: boolean) {
    if (changingMode.current) return
    changingMode.current = true
    setModeBusy(true)
    setCompact(next)
    try {
      await setCompactWindow(next)
    } catch (error) {
      setCompact(false)
      setNotice(`Window mode failed: ${String(error)}`)
    } finally {
      changingMode.current = false
      setModeBusy(false)
    }
  }

  useLayoutEffect(() => {
    document.documentElement.classList.toggle('compact-mode', compact)
    return () => document.documentElement.classList.remove('compact-mode')
  }, [compact])

  const heartbeat = useEffectEvent(() => { if (current.current.runningSince !== null) dispatch({ type: 'tick' }) })
  const sessionChanged = useEffectEvent((session: SessionState) => {
    locked.current = session.locked
    setScreenLocked(session.locked)
    if (session.lastLock > lastLock.current) {
      lastLock.current = session.lastLock
      const wasRunning = current.current.runningSince !== null
      dispatch({ type: 'lock', at: session.lastLock })
      if (wasRunning) setPausedByLock(true)
    }
  })
  const pauseAndSave = useEffectEvent(async () => {
    const next = transition(current.current, { type: 'pause' })
    current.current = next
    setState(next)
    await persist(next)
  })
  const keyboard = useEffectEvent((event: KeyboardEvent) => {
    if (dialog || !(event.ctrlKey || event.metaKey)) return
    if (event.shiftKey && event.key.toLowerCase() === 'm') { event.preventDefault(); void changeMode(!compact) }
    if (event.key.toLowerCase() === 'k') {
      event.preventDefault()
      if (compact) void changeMode(false).then(() => setDialog({ kind: 'edit' }))
      else setDialog({ kind: 'edit' })
    }
    if (event.key.toLowerCase() === 'f' && view !== 'activity' && !compact) { event.preventDefault(); searchRef.current?.focus() }
    if (event.shiftKey && event.code === 'Space') {
      event.preventDefault()
      const candidate = current.current.focusId ?? current.current.tasks.find(task => task.status === 'queued')?.id
      if (current.current.runningSince !== null) dispatch({ type: 'pause' })
      else if (candidate) dispatch({ type: 'focus', id: candidate })
    }
    if (event.shiftKey && event.key === 'Enter') {
      const id = current.current.focusId ?? (compact ? current.current.tasks.find(task => task.status === 'queued')?.id : undefined)
      if (id) { event.preventDefault(); dispatch({ type: compact ? 'complete-next' : 'complete', id }) }
    }
  })

  useEffect(() => {
    const stopSession = watchSession(session => sessionChanged(session), error => setNotice(`Windows lock detection failed: ${String(error)}`))
    const displayTimer = window.setInterval(() => setNow(Date.now()), 1000)
    const saveTimer = window.setInterval(() => heartbeat(), 5000)
    const onKey = (event: KeyboardEvent) => keyboard(event)
    const onHide = () => { if (document.visibilityState === 'hidden') heartbeat() }
    const onPageHide = () => { void pauseAndSave().catch(() => undefined) }
    document.addEventListener('keydown', onKey)
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', onPageHide)
    let unlisten: (() => void) | undefined
    let disposed = false
    if (desktop) {
      void import('@tauri-apps/api/window').then(async ({ getCurrentWindow }) => {
        const stop = await getCurrentWindow().onCloseRequested(async event => {
          event.preventDefault()
          try { await pauseAndSave(); await getCurrentWindow().destroy() } catch { setNotice('Could not save. The window has been kept open.') }
        })
        if (disposed) stop(); else unlisten = stop
      }).catch(error => setNotice(String(error)))
    }
    return () => {
      stopSession()
      disposed = true
      window.clearInterval(displayTimer); window.clearInterval(saveTimer)
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', onPageHide)
      unlisten?.()
    }
  }, [])

  const queued = state.tasks.filter(task => task.status === 'queued')
  const focus = state.tasks.find(task => task.id === state.focusId)
  const candidate = focus ?? queued[0]
  const running = state.runningSince !== null
  const today = dayKey(new Date(now))
  const summary = dailySummary(state, new Date(now), now)
  const daySummary = dailySummary(state, new Date(`${activityDay}T12:00:00`), now)
  const allTags = [...new Set(state.tasks.flatMap(task => task.tags))].sort()
  const visible = state.tasks.filter(task => task.status === view
    && `${task.title} ${task.tags.join(' ')}`.toLowerCase().includes(search.toLowerCase())
    && (!tag || task.tags.includes(tag))
    && (!due || (due === 'today' ? task.due === today : due === 'overdue' ? !!task.due && task.due < today : !task.due)))
  const counts = { queued: queued.length, completed: state.tasks.filter(task => task.status === 'completed').length, archived: state.tasks.filter(task => task.status === 'archived').length }
  const week = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(`${activityDay}T12:00:00`)
    date.setDate(date.getDate() - 6 + index)
    return { date, ...dailySummary(state, date, now) }
  })
  const maxTime = Math.max(3600000, ...week.map(day => day.milliseconds))

  function changeView(next: View) { setView(next); setSearch(''); setTag(''); setDue('') }
  function dragEnd(event: DragEndEvent) {
    if (event.over && event.active.id !== event.over.id) dispatch({ type: 'move', id: String(event.active.id), overId: String(event.over.id) })
  }
  function changeDay(offset: number) {
    const date = new Date(`${activityDay}T12:00:00`)
    date.setDate(date.getDate() + offset)
    setActivityDay(dayKey(date))
  }
  async function togglePin() {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      await getCurrentWindow().setAlwaysOnTop(!pinned)
      setPinned(!pinned)
    } catch (error) { setNotice(`Window control failed: ${String(error)}`) }
  }

  if (compact) return <main className={`focus-overlay${running ? ' running' : ''}`} aria-label="Compact focus" onPointerDown={event => {
    if (event.button === 0 && !(event.target as Element).closest('button')) {
      void dragOverlay().catch(error => setNotice(`Could not move overlay: ${String(error)}`))
    }
  }}>
    <div className="overlay-title" title={candidate?.title ?? 'Queue complete'}>{candidate?.title ?? 'Queue complete'}</div>
    <div className="overlay-bottom">
      <div className="overlay-clock" title={running ? 'Focusing' : pausedByLock ? 'Paused when Windows locked' : 'Paused'}><span className="overlay-indicator" /><span aria-label="Focus time">{clock(candidate ? taskMilliseconds(state, candidate.id, now) : 0)}</span>{!running && candidate && <Pause size={11} aria-label={pausedByLock ? 'Paused when Windows locked' : 'Paused'} />}</div>
      <div className="overlay-controls">
        {(saveError || notice) && <IconButton label={saveError ? saveStatus : notice} onClick={() => { void changeMode(false) }}><TriangleAlert /></IconButton>}
        <IconButton label={running ? 'Pause focus' : 'Resume focus'} disabled={!candidate || modeBusy || screenLocked} onClick={() => candidate && dispatch(running ? { type: 'pause' } : { type: 'focus', id: candidate.id })}>{running ? <Pause /> : <Play />}</IconButton>
        <IconButton label="Complete and load next task" disabled={!candidate || modeBusy || screenLocked} onClick={() => candidate && dispatch({ type: 'complete-next', id: candidate.id })}><Check /></IconButton>
        <IconButton label="Expand to full view" disabled={modeBusy} onClick={() => { void changeMode(false) }}><Maximize2 /></IconButton>
      </div>
    </div>
  </main>

  return <div className="app-shell">
    <header className="app-header">
      <div className="brand"><div className="brand-mark"><img src="/app.png" width="37" height="37" alt="" /></div><div><h1>Priority Queue</h1><span className="brand-subtitle">PERSONAL WORKSPACE</span></div></div>
      <div className="header-actions"><IconButton label="Compact overlay (Ctrl+Shift+M)" disabled={modeBusy} onClick={() => { void changeMode(true) }}><Minimize2 /></IconButton>{desktop && <IconButton label={pinned ? 'Unpin window' : 'Keep window on top'} active={pinned} onClick={() => { void togglePin() }}>{pinned ? <Pin /> : <PinOff />}</IconButton>}<button className="primary-button" aria-label="New task" title="New task (Ctrl+K)" onClick={() => setDialog({ kind: 'edit' })}><Plus size={17} /><span>New task</span></button></div>
    </header>

    <main>
      <section className={`focus-band${running ? ' is-running' : ''}`} aria-label="Current focus">
        <div className="focus-heading"><span className="eyebrow"><span className={`status-light${running ? ' live' : ''}`} />{running ? 'IN FOCUS' : pausedByLock ? 'PAUSED ON LOCK' : focus ? 'FOCUS PAUSED' : 'READY WHEN YOU ARE'}</span><span className="focus-date">{new Date(now).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</span></div>
        <div className="focus-main"><div className="focus-description"><h2>{candidate?.title ?? 'A little room to focus.'}</h2><div className="focus-meta">{candidate ? <><span>{focus ? 'Current task' : 'Next in queue'}</span>{candidate.tags.map(tag => <span key={tag}>#{tag}</span>)}</> : <span>0 tasks in your queue</span>}</div></div>
          <div className="focus-timer"><span className="timer" aria-label="Focus time">{clock(candidate ? taskMilliseconds(state, candidate.id, now) : 0)}</span><div className="timer-actions"><button className={`focus-toggle${running ? ' running' : ''}`} disabled={!candidate} title="Start or pause focus (Ctrl+Shift+Space)" onClick={() => candidate && dispatch(running ? { type: 'pause' } : { type: 'focus', id: candidate.id })}>{running ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}{running ? 'Pause' : focus ? 'Resume' : 'Start focus'}</button><IconButton label="Complete focus task (Ctrl+Shift+Enter)" disabled={!focus} onClick={() => focus && dispatch({ type: 'complete', id: focus.id })}><Check size={19} /></IconButton></div></div>
        </div>
        <div className="focus-baseline"><span className={running ? 'active-line' : ''} /></div>
      </section>

      <div className="today-strip"><span className="eyebrow">TODAY</span><span><Clock3 size={13} /><strong>{duration(summary.milliseconds)}</strong><span className="stat-label">focused</span></span><span><CheckCheck size={14} /><strong>{summary.completed}</strong><span className="stat-label">completed</span></span><button title="View daily activity" aria-label="View daily activity" onClick={() => changeView('activity')}><ArrowUpRight size={16} /></button></div>

      <nav className="view-tabs" aria-label="Task views">
        {([{ id: 'queued', title: 'Queue', icon: ListOrdered }, { id: 'completed', title: 'Completed', icon: CheckCheck }, { id: 'archived', title: 'Archive', icon: Archive }, { id: 'activity', title: 'Activity', icon: Activity }] as const).map(tab => <button key={tab.id} aria-current={view === tab.id ? 'page' : undefined} onClick={() => changeView(tab.id)}><tab.icon size={15} /><span>{tab.title}</span>{tab.id !== 'activity' && <span className="tab-count">{counts[tab.id]}</span>}</button>)}
      </nav>

      {view !== 'activity' ? <section className="queue-section" aria-label={`${view} tasks`}>
        <div className="list-toolbar"><div className="search-field"><Search size={15} /><input ref={searchRef} aria-label="Search tasks" placeholder="Search tasks" value={search} onChange={event => setSearch(event.target.value)} />{search && <IconButton label="Clear search" onClick={() => setSearch('')}><X size={13} /></IconButton>}</div><select aria-label="Filter by tag" value={tag} onChange={event => setTag(event.target.value)}><option value="">All tags</option>{allTags.map(tag => <option key={tag} value={tag}>#{tag}</option>)}</select><select aria-label="Filter by due date" value={due} onChange={event => setDue(event.target.value)}><option value="">Any date</option><option value="today">Due today</option><option value="overdue">Overdue</option><option value="none">No date</option></select></div>
        <div className="list-heading"><span>{view === 'queued' ? 'YOUR QUEUE' : view === 'completed' ? 'COMPLETED TASKS' : 'ARCHIVED TASKS'}</span><span>{visible.length} {visible.length === 1 ? 'TASK' : 'TASKS'}</span></div>
        {visible.length ? <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={dragEnd}><SortableContext items={visible.map(task => task.id)} strategy={verticalListSortingStrategy}><ul className="task-list">{visible.map((task, index) => <TaskRow key={task.id} task={task} index={index} state={state} now={now} dispatch={dispatch} edit={() => setDialog({ kind: 'edit', task })} remove={() => setDialog({ kind: 'delete', task })} previous={visible[index - 1]?.id} next={visible[index + 1]?.id} />)}</ul></SortableContext></DndContext> : <div className="empty-state">{search || tag || due ? <Search /> : view === 'queued' ? <ListOrdered /> : view === 'completed' ? <CheckCheck /> : <Archive />}<h3>{search || tag || due ? 'No matching tasks.' : view === 'queued' ? 'Your queue is clear.' : view === 'completed' ? 'Nothing completed yet.' : 'Nothing archived yet.'}</h3>{search || tag || due ? <button className="secondary-button" onClick={() => { setSearch(''); setTag(''); setDue('') }}>Clear filters</button> : view === 'queued' && <button className="text-button" onClick={() => setDialog({ kind: 'edit' })}><Plus size={15} />Add a task</button>}</div>}
        {!!visible.length && view === 'queued' && <button className="add-row" onClick={() => setDialog({ kind: 'edit' })}><Plus size={16} />Add a task</button>}
      </section> : <section className="activity-section" aria-label="Daily activity">
        <div className="activity-header"><div><span className="eyebrow">DAILY ACTIVITY</span><h2>{activityDay === today ? 'Today, in focus.' : new Date(`${activityDay}T12:00:00`).toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}</h2></div><div className="date-controls"><IconButton label="Previous day" onClick={() => changeDay(-1)}><ChevronLeft /></IconButton><input aria-label="Activity date" type="date" max={today} value={activityDay} onChange={event => { if (event.target.value && event.target.value <= today) setActivityDay(event.target.value) }} /><IconButton label="Next day" disabled={activityDay >= today} onClick={() => changeDay(1)}><ChevronRight /></IconButton></div></div>
        <div className="activity-stats"><div><span>Focus time</span><strong>{duration(daySummary.milliseconds)}</strong></div><div><span>Tasks completed</span><strong>{daySummary.completed.toString().padStart(2, '0')}</strong></div><div><span>Tasks focused</span><strong>{daySummary.byTask.length.toString().padStart(2, '0')}</strong></div></div>
        <div className="week-chart" aria-label="Focus time over seven days">{week.map(day => <button className={dayKey(day.date) === activityDay ? 'selected' : ''} key={dayKey(day.date)} title={`${day.date.toLocaleDateString()}: ${duration(day.milliseconds)}`} onClick={() => setActivityDay(dayKey(day.date))}><span className="chart-value">{duration(day.milliseconds)}</span><span className="bar-track"><span style={{ height: `${Math.max(2, day.milliseconds / maxTime * 100)}%` }} /></span><span>{day.date.toLocaleDateString(undefined, { weekday: 'short' })}</span></button>)}</div>
        <div className="list-heading"><span>FOCUS BREAKDOWN</span><span>TIME</span></div>{daySummary.byTask.length ? <ul className="breakdown-list">{daySummary.byTask.map(([id, entry]) => <li key={id}><span>{entry.title}</span><strong>{duration(entry.milliseconds)}</strong></li>)}</ul> : <div className="empty-state small"><Clock3 /><h3>No focus time recorded.</h3></div>}
      </section>}
    </main>
    {notice && <div className="notice" role="alert"><span>{notice}</span><IconButton label="Dismiss message" onClick={() => setNotice('')}><X /></IconButton></div>}
    <footer className={`app-footer${saveError ? ' save-error' : ''}`}><span role="status"><span className="storage-dot" />{saveStatus}</span>{saveError ? <button className="text-button" onClick={() => { void persist(current.current).catch(() => undefined) }}>Retry save</button> : <span>PRIORITY QUEUE <span className="version">/ 01</span></span>}</footer>
    {dialog?.kind === 'edit' && <TaskEditor task={dialog.task} close={() => setDialog(null)} submit={(title, tags, due) => { dispatch(dialog.task ? { type: 'edit', id: dialog.task.id, title, tags, due } : { type: 'add', task: makeTask(title, tags, due) }); setDialog(null) }} />}
    {dialog?.kind === 'delete' && <Modal label="Delete task" close={() => setDialog(null)}><header className="dialog-header"><h2>Delete task?</h2><IconButton label="Close" onClick={() => setDialog(null)}><X /></IconButton></header><p className="delete-title">{dialog.task.title}</p><footer className="dialog-footer"><button className="secondary-button" autoFocus onClick={() => setDialog(null)}>Cancel</button><button className="danger-button" onClick={() => { dispatch({ type: 'delete', id: dialog.task.id }); setDialog(null) }}><Trash2 size={15} />Delete</button></footer></Modal>}
  </div>
}