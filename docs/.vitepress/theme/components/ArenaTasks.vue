<script setup lang="ts">
/**
 * 实战演练任务清单。
 *
 * 任务定义从 lib/tasks-*.ts 按 moduleId 取，页面里只写一句 <ArenaTasks module-id="01-intro" />。
 * 好处：任务正则集中在 TS 里，能被引擎自检脚本覆盖；markdown 只管叙事。
 *
 * SSR 期渲染出完整的 ⏳ 任务列表 —— 首屏 HTML 有真实内容，
 * 搜索引擎能抓到，JS 失败时读者也知道该做什么。
 */
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { loadTasks, saveTasks, markDone, getRecord } from '../../lib/store'
import { LINUX_TASKS } from '../../lib/tasks-linux'
import { WINDOWS_TASKS } from '../../lib/tasks-windows'
import { indexById } from '../../data/modules'

const props = defineProps<{ moduleId: string }>()

const def = computed(() => indexById(props.moduleId))

const tasks = computed(() => {
  if (!def.value) return []
  const table = def.value.track === 'linux' ? LINUX_TASKS : WINDOWS_TASKS
  return (table[props.moduleId] ?? []).map((t) => ({ id: t.id, label: t.label }))
})

const state = ref<Record<string, boolean>>({})
const finished = ref(false)

const doneCount = computed(() => tasks.value.filter((t) => state.value[t.id]).length)
const pct = computed(() => (tasks.value.length ? Math.round((doneCount.value / tasks.value.length) * 100) : 0))
const allDone = computed(() => tasks.value.length > 0 && doneCount.value === tasks.value.length)

onMounted(() => {
  if (!def.value) return
  const saved = loadTasks(props.moduleId)
  const next: Record<string, boolean> = {}
  for (const t of tasks.value) next[t.id] = !!saved[t.id]
  state.value = next

  const rec = getRecord(def.value.track, props.moduleId)
  finished.value = !!rec.done

  const onHit = (e: Event) => {
    const d = (e as CustomEvent).detail
    if (d.moduleId !== props.moduleId) return
    if (!state.value[d.taskId]) {
      state.value = { ...state.value, [d.taskId]: true }
      saveTasks(props.moduleId, state.value)
    }
  }
  window.addEventListener('cc-task-hit', onHit)
  onUnmounted(() => window.removeEventListener('cc-task-hit', onHit))
})

function undo() {
  window.dispatchEvent(new CustomEvent('cc-term-undo'))
}

function reset() {
  state.value = Object.fromEntries(tasks.value.map((t) => [t.id, false]))
  saveTasks(props.moduleId, state.value)
  finished.value = false
  window.dispatchEvent(new CustomEvent('cc-term-reset'))
}

function finish() {
  if (!def.value) return
  const cur = getRecord(def.value.track, props.moduleId)
  // 演练完成给 80 分，已有更高分时不覆盖（幂等）
  markDone(def.value.track, props.moduleId, Math.max(cur.score, 80), def.value.badge)
  finished.value = true
}
</script>

<template>
  <section v-if="def" class="arena">
    <h2>🎮 实战演练</h2>
    <p style="margin: 0 0 12px; font-size: 14px; color: var(--vp-c-text-2)">
      在下面这个终端里真敲一遍。虚拟文件系统会跟着你的命令变，点重置可恢复初始状态。
    </p>

    <ul style="list-style: none; padding: 0; margin: 0">
      <li v-for="(t, i) in tasks" :key="t.id" class="arena-task" :class="{ done: state[t.id] }">
        <span class="num">{{ state[t.id] ? '✓' : i + 1 }}</span>
        <span class="text">{{ t.label }}</span>
      </li>
    </ul>

    <p style="margin: 12px 0 4px; font-size: 13px; color: var(--vp-c-text-2)">
      已完成 {{ doneCount }} / {{ tasks.length }} 个任务
    </p>
    <div class="arena-bar"><i :style="{ width: pct + '%' }" /></div>

    <div class="arena-actions">
      <button @click="undo">⏪ 撤销上一步</button>
      <button @click="reset">🔄 重置演练</button>
      <button class="primary" :disabled="!allDone || finished" @click="finish">
        {{ finished ? '✅ 已标记完成' : '🏁 标记完成' }}
      </button>
    </div>

    <p v-if="finished" style="margin: 12px 0 0; font-size: 14px">
      🎉 演练完成，进度已记到
      <a :href="`/${def.track}/reference/progress`">进度页</a>。
    </p>
    <p v-else-if="!allDone" style="margin: 12px 0 0; font-size: 13px; color: var(--vp-c-text-2)">
      全部 {{ tasks.length }} 个任务完成后，「标记完成」才会解锁。
    </p>
  </section>
</template>
