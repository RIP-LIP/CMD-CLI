<script setup lang="ts">
/**
 * 章节总表。数据来自 data/modules.ts —— 与侧边栏同源，
 * 不存在「侧边栏加了新章、首页总表忘了更新」的可能。
 */
import { computed } from 'vue'
import { MODULES, PART_META, byTrack, linkTo, indexById, type Track } from '../../data/modules'

const props = defineProps<{ track: Track }>()

interface Row {
  id: string
  title: string
  part: string
  link: string
  minutes: number
  difficulty: string
  commands: number
  terminal: boolean
  done: boolean
  score: number
}

const rows = computed<Row[]>(() => {
  // 进度要在客户端读，SSR 期一律按未完成渲染
  const ids = byTrack(props.track)
  let store: Record<string, { done: boolean; bestScore: number }> = {}
  if (typeof window !== 'undefined') {
    try {
      const raw = window.localStorage.getItem(`commandcraft.v2.${props.track}`)
      store = raw ? JSON.parse(raw).modules ?? {} : {}
    } catch { store = {} }
  }

  return ids.map((m) => ({
    id: m.id,
    title: m.title,
    part: PART_META[m.part].name,
    link: linkTo(m),
    minutes: m.minutes,
    difficulty: m.difficulty === 'easy' ? '入门' : m.difficulty === 'med' ? '进阶' : '高级',
    commands: m.commandCount,
    terminal: m.hasTerminal,
    done: !!store[m.id]?.done,
    score: store[m.id]?.bestScore ?? 0,
  }))
})

const total = computed(() => rows.value.length)
const finished = computed(() => rows.value.filter((r) => r.done).length)
</script>

<template>
  <div>
    <p style="font-size: 14px; color: var(--vp-c-text-2)">
      共 {{ total }} 章，已完成 <b>{{ finished }}</b> 章。
      <template v-if="finished === total && total > 0">🎉 这条线全部通关了。</template>
    </p>

    <table class="chapter-table">
      <thead>
        <tr>
          <th style="width: 34px"></th>
          <th>章节</th>
          <th>所属</th>
          <th style="width: 56px">命令</th>
          <th style="width: 62px">时长</th>
          <th style="width: 58px">难度</th>
          <th style="width: 70px">状态</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in rows" :key="r.id">
          <td class="num">{{ r.id.split('-')[0] }}</td>
          <td><a :href="r.link">{{ r.title }}</a></td>
          <td>{{ r.part }}</td>
          <td>{{ r.commands }}</td>
          <td class="dur">{{ r.minutes }} 分钟</td>
          <td>{{ r.difficulty }}</td>
          <td>
            <span v-if="r.done">✅ {{ r.score }} 分</span>
            <span v-else>⬜ 未完成</span>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
