<script setup lang="ts">
/**
 * 进度环。
 *
 * 分母与 doneCount 都取自同一个 totalFor(track) —— 旧站这里
 * 分母在 storage.js 里是 15、页面文字却写 10，环永远到不了 100%。
 * 这里两端数字来自同一函数，不可能再对不上。
 */
import { ref, computed, onMounted } from 'vue'
import { loadTrack } from '../../lib/store'
import { totalFor, type Track } from '../../data/modules'

const props = withDefaults(defineProps<{ track: Track; size?: number }>(), { size: 120 })

const done = ref(0)
const avg = ref(0)
const badges = ref(0)

const total = computed(() => totalFor(props.track))
const pct = computed(() => (total.value ? Math.round((done.value / total.value) * 100) : 0))

const R = computed(() => props.size / 2 - 10)
const C = computed(() => 2 * Math.PI * R.value)
const dash = computed(() => `${(pct.value / 100) * C.value} ${C.value}`)

onMounted(() => {
  // store 是纯同步读，直接静态调用即可；
  // 动态 import 反而会让打包器把它和别处的静态 import 混成一块，产出无效分包警告。
  const st = loadTrack(props.track)
  done.value = Object.values(st.modules).filter((m) => m.done).length
  const scores = Object.values(st.modules).filter((m) => m.bestScore > 0).map((m) => m.bestScore)
  avg.value = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0
  badges.value = st.badges.length
})
</script>

<template>
  <div class="ring-wrap">
    <svg :width="size" :height="size" :viewBox="`0 0 ${size} ${size}`">
      <circle
        :cx="size / 2" :cy="size / 2" :r="R"
        class="ring-track" fill="none" stroke-width="10"
      />
      <circle
        :cx="size / 2" :cy="size / 2" :r="R"
        class="ring-bar" fill="none" stroke-width="10" stroke-linecap="round"
        :stroke-dasharray="dash"
        :transform="`rotate(-90 ${size / 2} ${size / 2})`"
      />
      <text :x="size / 2" :y="size / 2" text-anchor="middle" dominant-baseline="middle" class="ring-label">
        {{ pct }}%
      </text>
    </svg>

    <div class="stat-row" style="margin: 0">
      <div class="stat"><b>{{ done }} / {{ total }}</b><span>已完成章节</span></div>
      <div class="stat"><b>{{ avg }}</b><span>平均分</span></div>
      <div class="stat"><b>{{ badges }}</b><span>徽章</span></div>
    </div>
  </div>
</template>
