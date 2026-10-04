<script setup lang="ts">
/**
 * 静态伪终端：把命令与输出按 `.term` 样式渲染出来，带逐 token 上色。
 *
 * 用法：
 *   <TerminalBlock>
 *     <span class="p">$</span> <span class="c">ls -la</span>
 *     <span class="o">total 4</span>
 *   </TerminalBlock>
 */
defineProps<{ title?: string }>()
</script>

<template>
  <div class="term">
    <div class="term-bar">
      <span class="term-dots"><i></i><i></i><i></i></span>
      <span>{{ title ?? '~ terminal' }}</span>
    </div>
    <div class="term-body"><slot /></div>
  </div>
</template>
