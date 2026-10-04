<script setup lang="ts">
/**
 * 徽章墙。
 *
 * 徽章名只有一个来源：data/modules.ts 里的 badge 字段。
 * 旧站有两处互相独立的徽章定义（quiz.js 的 badgeMap 与各模块内联的
 * BADGE 常量），且 Windows 侧从未调用 addBadge —— 徽章墙永远是 0/12。
 * 这里按 modules.ts 派生，两条线一视同仁。
 */
import { ref, computed, onMounted } from 'vue'
import { byTrack, indexById, type Track } from '../../data/modules'

const props = defineProps<{ track: Track }>()

const unlocked = ref<string[]>([])

onMounted(() => {
  try {
    const raw = window.localStorage.getItem(`commandcraft.v2.${props.track}`)
    unlocked.value = raw ? JSON.parse(raw).badges ?? [] : []
  } catch {
    unlocked.value = []
  }
})

const items = computed(() =>
  byTrack(props.track).map((m) => ({
    badge: m.badge,
    title: m.title,
    got: unlocked.value.includes(m.badge),
  })),
)

const gotCount = computed(() => items.value.filter((i) => i.got).length)
</script>

<template>
  <div>
    <p style="font-size: 14px; color: var(--vp-c-text-2)">
      已点亮 <b>{{ gotCount }}</b> / {{ items.length }} 枚。
      每章练习过线或完成实战演练即可解锁。
    </p>
    <div class="badge-grid">
      <div v-for="i in items" :key="i.badge" class="badge-item" :class="{ locked: !i.got }">
        <span>{{ i.got ? '🏅' : '🔒' }}</span>
        <span>
          {{ i.title }}
          <small style="display: block; color: var(--vp-c-text-3); font-size: 11px">{{ i.badge }}</small>
        </span>
      </div>
    </div>
  </div>
</template>
