/**
 * 进度存储。
 *
 * 两个必须做对的地方：
 *
 * 1. **降级**：localStorage 在隐私模式、配额满、被策略禁用时会抛错。
 *    这里所有读写都包 try/catch，失败后退化为纯内存态，页面照常能用。
 *    旧站没有这层，隐私模式下会直接静默丢进度。
 *
 * 2. **键位迁移**：旧站用 commandcraft.*.v1，新站用 commandcraft.v2.*。
 *    迁移只在读到旧键时执行，写新键成功后才删旧键，中断可续跑。
 *
 * 本文件是 lib/ 下唯一允许碰 localStorage 的地方。
 */

import type { Track } from '../data/modules'

export interface ModuleRecord {
  done: boolean
  score: number
  attempts: number
  bestScore: number
  lastTry: number
}

export interface TrackState {
  modules: Record<string, ModuleRecord>
  badges: string[]
}

const PREFIX = 'commandcraft.v2'
const OLD_PREFIX = 'commandcraft'

export const trackKey = (track: Track): string => `${PREFIX}.${track}`
export const historyKey = (id: string): string => `${PREFIX}.history.${id}`
export const tasksKey = (id: string): string => `${PREFIX}.tasks.${id}`
export const winStateKey = (id: string): string => `${PREFIX}.winstate.${id}`

const emptyRecord = (): ModuleRecord => ({
  done: false, score: 0, attempts: 0, bestScore: 0, lastTry: 0,
})

const emptyState = (): TrackState => ({ modules: {}, badges: [] })

/** localStorage 是否可用。模块加载时探测一次，之后不再重复 try/catch 探测 */
let storageOK = true
try {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(`${PREFIX}.probe`, '1')
    localStorage.removeItem(`${PREFIX}.probe`)
  }
} catch {
  storageOK = false
}

export function isPersistent(): boolean {
  return storageOK
}

function readJSON<T>(key: string, fallback: T): T {
  // ⚠️ 必须走 rawGet 而不是直接 localStorage.getItem：
  //    storageOK 为 false 时（隐私模式 / 配额满）数据在内存 Map 里，
  //    直接读 localStorage 会永远返回 null，用户记的进度当场蒸发。
  const raw = rawGet(key)
  if (!raw) return fallback
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as T) : fallback
  } catch {
    // 数据损坏时回退到默认值，不让坏数据卡住整页
    return fallback
  }
}

function writeJSON(key: string, value: unknown): boolean {
  // 同上：rawSet 会先写内存再尝试落盘，存储不可用时进度仍保留在本会话内
  rawSet(key, JSON.stringify(value))
  return storageOK
}

/** 内存态兜底：storageOK 为 false 时所有读写走这里 */
const memory = new Map<string, string>()

function rawGet(key: string): string | null {
  if (!storageOK) return memory.get(key) ?? null
  try {
    return localStorage.getItem(key)
  } catch {
    return memory.get(key) ?? null
  }
}

function rawSet(key: string, value: string): void {
  memory.set(key, value)
  if (!storageOK) return
  try {
    localStorage.setItem(key, value)
  } catch {
    storageOK = false
  }
}

function rawRemove(key: string): void {
  memory.delete(key)
  if (!storageOK) return
  try {
    localStorage.removeItem(key)
  } catch {
    storageOK = false
  }
}

// ── 键位迁移 ────────────────────────────────────────────────────

/**
 * 旧站 → 新站。幂等：已迁移过的键会因为旧键不存在而跳过。
 * 写新键成功后才删旧键，中途失败下次继续。
 */
export function migrateLegacy(track: Track): boolean {
  const oldKey = `${OLD_PREFIX}.${track}.v1`
  const raw = rawGet(oldKey)
  if (!raw) return false

  try {
    const old = JSON.parse(raw) as Partial<TrackState>

    // ⚠️ 必须**合并**而不是「新键已存在就跳过」。
    //    用户可能先在新站存了进度（哪怕只有一个模块的练习分），此时新键已存在。
    //    若此时跳过迁移并删掉旧键，他的旧进度就永久丢了 ——
    //    这正是「顺手清旧键」最容易造成的静默数据丢失。
    const existingRaw = rawGet(trackKey(track))
    let state: TrackState = emptyState()
    if (existingRaw) {
      try {
        const parsed = JSON.parse(existingRaw) as Partial<TrackState>
        state = { modules: parsed.modules ?? {}, badges: parsed.badges ?? [] }
      } catch {
        state = emptyState()
      }
    }

    for (const [id, rec] of Object.entries(old.modules ?? {})) {
      const r = rec as Partial<ModuleRecord>
      const cur = state.modules[id]
      const migrated: ModuleRecord = {
        done: !!r.done,
        score: r.score ?? 0,
        attempts: r.attempts ?? 0,
        bestScore: r.bestScore ?? r.score ?? 0,
        // 旧记录没有 lastTry，视为极早，避免迁移后立刻被新写入覆盖
        lastTry: r.lastTry ?? 0,
      }
      // 已有的新记录优先，但成绩取两者里更高的，不倒退
      state.modules[id] = cur
        ? {
            ...cur,
            bestScore: Math.max(cur.bestScore, migrated.bestScore),
            attempts: Math.max(cur.attempts, migrated.attempts),
            done: cur.done || migrated.done,
          }
        : migrated
    }

    for (const b of old.badges ?? []) {
      if (!state.badges.includes(b)) state.badges.push(b)
    }

    rawSet(trackKey(track), JSON.stringify(state))
    rawRemove(oldKey)
    return true
  } catch {
    // 旧数据坏了就留着不动，不猜
    return false
  }
}

/** 迁移某章的历史与任务状态 */
export function migrateLegacyPerModule(id: string): void {
  const pairs: [string, string][] = [
    [`${OLD_PREFIX}.history.${id}`, historyKey(id)],
    [`${OLD_PREFIX}.tasks.${id}`, tasksKey(id)],
    [`${OLD_PREFIX}.toywin.state.${id}`, winStateKey(id)],
  ]
  for (const [oldKey, newKey] of pairs) {
    const raw = rawGet(oldKey)
    if (!raw) continue
    if (!rawGet(newKey)) rawSet(newKey, raw)
    rawRemove(oldKey)
  }
}

// ── 进度读写 ────────────────────────────────────────────────────

export function loadTrack(track: Track): TrackState {
  migrateLegacy(track)
  const state = readJSON<TrackState>(trackKey(track), emptyState())
  return {
    modules: state.modules ?? {},
    badges: state.badges ?? [],
  }
}

export function saveTrack(track: Track, state: TrackState): void {
  writeJSON(trackKey(track), state)
}

export function getRecord(track: Track, id: string): ModuleRecord {
  return loadTrack(track).modules[id] ?? emptyRecord()
}

/**
 * 标记完成。三条路径（测验 / 演练完成 / 手动标记）都走这里。
 *
 * 不变量：
 *  - done 一旦为 true 不回退
 *  - bestScore 单调不减
 *  - 徽章去重
 *  - 并发写按 lastTry 取较新者，避免另一标签页的高分被覆盖
 */
export function markDone(track: Track, id: string, score: number, badge?: string | null): TrackState {
  const state = loadTrack(track)
  const cur = state.modules[id] ?? emptyRecord()
  const now = Date.now()

  // 另一标签页写过更新的记录，且分数更高 —— 不覆盖
  if (cur.lastTry > now && cur.bestScore > score) {
    return state
  }

  state.modules[id] = {
    done: true,
    score: Math.max(cur.score, score),
    attempts: cur.attempts + 1,
    bestScore: Math.max(cur.bestScore, score),
    lastTry: now,
  }

  if (badge && !state.badges.includes(badge)) state.badges.push(badge)
  saveTrack(track, state)
  return state
}

/** 只记录一次作答，不必然判完成（低于 60 分时走这条） */
export function recordAttempt(track: Track, id: string, score: number): TrackState {
  const state = loadTrack(track)
  const cur = state.modules[id] ?? emptyRecord()
  state.modules[id] = {
    ...cur,
    score,
    attempts: cur.attempts + 1,
    bestScore: Math.max(cur.bestScore, score),
    lastTry: Date.now(),
  }
  saveTrack(track, state)
  return state
}

export function doneCount(track: Track): number {
  const state = loadTrack(track)
  return Object.values(state.modules).filter((m) => m.done).length
}

export function avgScore(track: Track): number {
  const scores = Object.values(loadTrack(track).modules)
    .filter((m) => m.bestScore > 0)
    .map((m) => m.bestScore)
  if (!scores.length) return 0
  return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
}

// ── 终端相关状态 ────────────────────────────────────────────────

export function loadHistory(id: string): string[] {
  migrateLegacyPerModule(id)
  return readJSON<string[]>(historyKey(id), [])
}

export function saveHistory(id: string, lines: string[]): void {
  writeJSON(historyKey(id), lines.slice(-100))
}

export function loadTasks(id: string): Record<string, boolean> {
  migrateLegacyPerModule(id)
  return readJSON<Record<string, boolean>>(tasksKey(id), {})
}

export function saveTasks(id: string, state: Record<string, boolean>): void {
  writeJSON(tasksKey(id), state)
}

export function loadWinState<T>(id: string): T | null {
  migrateLegacyPerModule(id)
  return readJSON<T | null>(winStateKey(id), null)
}

export function saveWinState<T>(id: string, state: T): void {
  writeJSON(winStateKey(id), state)
}

/** 清空某条线的全部进度（进度页的「重置」按钮用） */
export function resetTrack(track: Track): void {
  rawSet(trackKey(track), JSON.stringify(emptyState()))
}
