<script setup lang="ts">
/**
 * 章节元信息条：命令数 / 预计时长 / 难度 / 是否可实操。
 * 全部从 data/modules.ts 取，不在页面里手写，避免与导航不一致。
 */
import { computed } from 'vue'
import { indexById } from '../../data/modules'

const props = defineProps<{ moduleId: string }>()

const def = computed(() => indexById(props.moduleId))
const diffLabel = computed(() => {
  switch (def.value?.difficulty) {
    case 'easy': return '入门'
    case 'med': return '进阶'
    default: return '高级'
  }
})
</script>

<template>
  <div v-if="def" class="mod-meta">
    <span>📁 {{ def.commandCount }} 个核心命令</span>
    <span>⏱ 约 {{ def.minutes }} 分钟</span>
    <span>{{ diffLabel }}</span>
    <span v-if="def.hasTerminal">🖥 可实操</span>
    <span v-if="def.hasArena">🎮 含实战演练</span>
  </div>
</template>
