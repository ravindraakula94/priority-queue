import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { checkpoint, dailySummary, emptyState, persistedState, restoreState, taskMilliseconds, transition, type QueueState, type QueueTask } from './model.ts'

const first: QueueTask = { id: 'first', title: 'First task', tags: ['work'], due: '', status: 'queued', createdAt: 0, completedAt: null }
const second: QueueTask = { ...first, id: 'second', title: 'Second task' }
function setup(): QueueState { return { ...emptyState(), tasks: [first, second] } }

describe('queue and focus', () => {
  it('allows only one running task and accounts for switching exactly once', () => {
    let state = transition(setup(), { type: 'focus', id: 'first' }, 1000)
    state = transition(state, { type: 'focus', id: 'second' }, 6000)
    assert.equal(taskMilliseconds(state, 'first', 9000), 5000)
    assert.equal(taskMilliseconds(state, 'second', 9000), 3000)
    assert.equal(state.focusId, 'second')
  })

  it('pauses and resumes without charging the break', () => {
    let state = transition(setup(), { type: 'focus', id: 'first' }, 1000)
    state = transition(state, { type: 'pause' }, 6000)
    state = transition(state, { type: 'focus', id: 'first' }, 10000)
    assert.equal(taskMilliseconds(state, 'first', 12000), 7000)
  })

  it('completion stops tracking without starting the next task', () => {
    let state = transition(setup(), { type: 'focus', id: 'first' }, 1000)
    state = transition(state, { type: 'complete', id: 'first' }, 11000)
    assert.equal(state.focusId, null)
    assert.equal(state.runningSince, null)
    assert.equal(state.tasks[0].status, 'completed')
    assert.equal(state.tasks[0].completedAt, 11000)
    assert.equal(taskMilliseconds(state, 'first', 20000), 10000)
  })

  it('reorders without altering focus', () => {
    let state = transition(setup(), { type: 'focus', id: 'first' }, 1000)
    state = transition(state, { type: 'move', id: 'second', overId: 'first' }, 2000)
    assert.deepEqual(state.tasks.map(task => task.id), ['second', 'first'])
    assert.equal(state.focusId, 'first')
  })

  it('compact completion continues with the first queued task only when running', () => {
    const running = transition(setup(), { type: 'focus', id: 'second' }, 1000)
    const next = transition(running, { type: 'complete-next', id: 'second' }, 6000)
    assert.equal(next.focusId, 'first')
    assert.equal(next.runningSince, 6000)
    assert.equal(taskMilliseconds(next, 'second', 10000), 5000)
    assert.equal(taskMilliseconds(next, 'first', 10000), 4000)
    const done = transition(next, { type: 'complete-next', id: 'first' }, 10000)
    assert.equal(done.focusId, null)
    assert.equal(done.runningSince, null)
  })

  it('compact completion loads the next item paused when not running', () => {
    const next = transition(setup(), { type: 'complete-next', id: 'first' }, 1000)
    assert.equal(next.focusId, 'second')
    assert.equal(next.runningSince, null)
    assert.equal(taskMilliseconds(next, 'second', 99999), 0)
  })

  it('screen lock pauses at the native timestamp and never charges locked time', () => {
    const running = transition(setup(), { type: 'focus', id: 'first' }, 1000)
    const locked = transition(running, { type: 'lock', at: 6000 }, 10000)
    assert.equal(locked.focusId, 'first')
    assert.equal(locked.runningSince, null)
    assert.equal(taskMilliseconds(locked, 'first', 20000), 5000)
    const resumed = transition(locked, { type: 'focus', id: 'first' }, 20000)
    assert.equal(taskMilliseconds(resumed, 'first', 22000), 7000)
  })

  it('a delayed lock event removes checkpoints recorded after Windows locked', () => {
    const running = transition(setup(), { type: 'focus', id: 'first' }, 1000)
    const delayed = checkpoint(running, 15000)
    const locked = transition(delayed, { type: 'lock', at: 6000 }, 16000)
    assert.equal(taskMilliseconds(locked, 'first', 99999), 5000)
    assert.equal(locked.runningSince, null)
  })

  it('restores paused, retains measured time and never charges downtime', () => {
    const running = transition(setup(), { type: 'focus', id: 'first' }, 1000)
    const saved = persistedState(checkpoint(running, 11000))
    const restored = restoreState(JSON.parse(JSON.stringify(saved)))
    assert.equal(restored.runningSince, null)
    assert.equal(restored.focusId, 'first')
    assert.equal(taskMilliseconds(restored, 'first', 999999), 10000)
  })

  it('merges periodic checkpoints without double counting', () => {
    let state = transition(setup(), { type: 'focus', id: 'first' }, 1000)
    state = checkpoint(checkpoint(state, 6000), 11000)
    assert.equal(state.sessions.length, 1)
    assert.equal(taskMilliseconds(state, 'first', 16000), 15000)
  })

  it('splits sessions at local midnight for daily summaries', () => {
    const start = new Date(2026, 8, 15, 23, 59).getTime()
    const end = new Date(2026, 8, 16, 0, 2).getTime()
    const state = transition(setup(), { type: 'focus', id: 'first' }, start)
    assert.equal(dailySummary(state, new Date(2026, 8, 15), end).milliseconds, 60000)
    assert.equal(dailySummary(state, new Date(2026, 8, 16), end).milliseconds, 120000)
  })

  it('permanently deletes a running task and all of its session history', () => {
    let state = transition(setup(), { type: 'focus', id: 'first' }, 1000)
    state = transition(state, { type: 'pause' }, 2000)
    state = transition(state, { type: 'edit', id: 'first', title: 'Renamed private task', tags: [], due: '' }, 2500)
    state = transition(state, { type: 'focus', id: 'first' }, 3000)
    state = transition(state, { type: 'delete', id: 'first' }, 5000)
    assert.equal(state.focusId, null)
    assert.equal(state.runningSince, null)
    assert.deepEqual(state.sessions, [])
    assert.deepEqual(state.tasks, [second])
    const restored = restoreState(JSON.parse(JSON.stringify(persistedState(state))))
    assert.deepEqual(restored.sessions, [])
    assert.equal(JSON.stringify(restored).includes('Renamed private task'), false)
    assert.equal(JSON.stringify(restored).includes('First task'), false)
  })

  it('deletes completed and archived history without disturbing another running task', () => {
    for (const status of ['complete', 'archive'] as const) {
      let state = transition(setup(), { type: 'focus', id: 'first' }, 1000)
      state = transition(state, { type: status, id: 'first' }, 2000)
      state = transition(state, { type: 'focus', id: 'second' }, 3000)
      state = transition(state, { type: 'delete', id: 'first' }, 5000)
      assert.deepEqual(state.tasks, [second])
      assert.equal(state.focusId, 'second')
      assert.equal(state.runningSince, 5000)
      assert.equal(state.sessions.every(session => session.taskId === 'second'), true)
      assert.equal(taskMilliseconds(state, 'second', 6000), 3000)
      assert.equal(taskMilliseconds(state, 'first', 6000), 0)
    }
  })

  it('explicitly purges legacy deleted history while retaining archived and current tasks', () => {
    const state: QueueState = {
      ...setup(),
      tasks: [{ ...first, status: 'archived' }, second],
      sessions: [
        { taskId: 'deleted', title: 'Removed private task', start: 0, end: 1000 },
        { taskId: 'first', title: 'First task', start: 1000, end: 2000 },
        { taskId: 'second', title: 'Second task', start: 2000, end: 3000 },
      ],
    }
    const cleaned = transition(state, { type: 'purge-deleted-history' }, 4000)
    assert.deepEqual(cleaned.tasks, state.tasks)
    assert.deepEqual(cleaned.sessions.map(session => session.taskId), ['first', 'second'])
    assert.equal(JSON.stringify(cleaned).includes('Removed private task'), false)
    assert.deepEqual(transition(cleaned, { type: 'purge-deleted-history' }, 5000), cleaned)
  })

  it('does not start completed tasks or accept corrupt saved state', () => {
    const state = transition(setup(), { type: 'complete', id: 'first' }, 1000)
    assert.equal(transition(state, { type: 'focus', id: 'first' }, 2000).focusId, null)
    assert.throws(() => restoreState({ version: 2 }))
    assert.throws(() => restoreState({ ...setup(), tasks: [first, first] }))
  })
})