<script setup lang="ts">
/**
 * 浏览器内 Linux 终端（ToyShell）。
 *
 * SSR 纪律：
 *  - 引擎从 lib/ 静态 import（零 DOM 依赖，SSR 安全）
 *  - xterm 在 onMounted 里动态 import，SSR 期完全不会碰到 window / Terminal
 *  - fitAddon 存进闭包供 ResizeObserver 与 onUnmounted 共用
 *    （旧站把 fitAddon 声明在局部、回调里调 term.fit()，而 xterm 5.x 的
 *     fit 在 FitAddon 上，Terminal 没有这个方法 —— 缩放静默失效）
 */
import { ref, computed, nextTick, onMounted, onUnmounted, shallowRef } from 'vue'
import { Shell } from '../../lib/shell-linux'
import { loadHistory, saveHistory } from '../../lib/store'
import { LINUX_TASKS } from '../../lib/tasks-linux'
import { indexById } from '../../data/modules'

// ⚠️ xterm 的样式必须**静态** import。
// 放在 onMounted 里 `await import('xterm/css/xterm.css')` 在 Vite dev 下不会可靠注入，
// 结果是终端有滚动条、有输入框，但字符全是不可见的 —— 看起来就是一片空白。
// CSS 会被构建期提取，静态 import 不会影响 SSR。
import 'xterm/css/xterm.css'

const props = defineProps<{ moduleId: string }>()

/** 任务正则从 lib/tasks-linux 取，markdown 里不重复维护 */
const tasks = computed(() => LINUX_TASKS[props.moduleId] ?? [])
const def = computed(() => indexById(props.moduleId))

/** 引擎真正实现了哪些命令 —— 如实告诉读者，避免「敲了报 not found」以为是自己敲错了 */
const available = ref<string[]>([])

const host = ref<HTMLElement | null>(null)
const status = ref<'loading' | 'ready' | 'failed'>('loading')
const errorMsg = ref('')

const termRef = shallowRef<any>(null)
const fitRef = shallowRef<any>(null)
let ro: ResizeObserver | null = null
let shell: Shell | null = null
/** 事件解绑函数，onMounted 里注册、在外层 onUnmounted 统一执行 */
let cleanupFns: (() => void)[] = []

function promptStr(s: Shell): string {
  return `\x1b[1;36m${s.vfs.user}@devbox:${s.vfs.displayPath()}\x1b[0m$ `
}

function banner(t: any) {
  t.writeln('\x1b[1;36mCommandCraft 实战演练 · ToyShell\x1b[0m')
  t.writeln('\x1b[90m▸ 输入命令后回车执行；help 查看全部命令\x1b[0m')
  t.writeln('\x1b[90m▸ Ctrl+L 清屏 · Ctrl+C 中断 · Ctrl+Z 撤销 · ↑↓ 翻历史\x1b[0m')
  t.writeln('')
}

onMounted(async () => {
  if (!host.value) return
  try {
    const [{ Terminal }, { FitAddon }] = await Promise.all([
      import('xterm'),
      import('@xterm/addon-fit'),
    ])

    shell = new Shell()
    available.value = shell.supportedCommands()

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: '"JetBrains Mono", Consolas, "Courier New", monospace',
      theme: {
        background: '#0f172a',
        foreground: '#e2e8f0',
        cursor: '#7dd3fc',
        cursorAccent: '#0f172a',
        selectionBackground: '#475569',
      },
      cols: 80,
      rows: 20,
      convertEol: true,
      scrollback: 200,
    })
    term.open(host.value)

    const fit = new FitAddon()
    term.loadAddon(fit)
    // 存进 shallowRef，ResizeObserver 与卸载逻辑都能拿到 —— 修掉旧站的缩放失效
    fitRef.value = fit
    termRef.value = term

    try {
      fit.fit()
    } catch { /* 容器还没布局好，下一轮 resize 会再试 */ }

    banner(term)
    term.write(promptStr(shell))

    // ── 输入处理 ──────────────────────────────────────────
    let buffer = ''
    const history = loadHistory(props.moduleId)
    let hIdx = history.length

    const drawPrompt = () => term.write(promptStr(shell!))
    const resetLine = () => {
      while (buffer.length > 0) {
        buffer = buffer.slice(0, -1)
        term.write('\b \b')
      }
    }

    const run = (line: string) => {
      if (!shell || !line.trim()) {
        drawPrompt()
        return
      }
      const result = shell.exec(line)
      if (result.clear) {
        term.clear()
        banner(term)
        drawPrompt()
        return
      }
      term.writeln('')
      if (result.stdout) term.write(result.stdout.replace(/\n/g, '\r\n') + '\r\n')
      if (result.stderr) term.write('\x1b[31m' + result.stderr.replace(/\n/g, '\r\n') + '\x1b[0m\r\n')

      // 任务检测：把执行结果喂给宿主组件
      const ctx = { cwd: shell.cwd() }
      for (const t of tasks.value) {
        try {
          if (t.check(line, result, ctx)) {
            window.dispatchEvent(new CustomEvent('cc-task-hit', { detail: { moduleId: props.moduleId, taskId: t.id } }))
          }
        } catch { /* 单条任务正则出错不能影响终端 */ }
      }

      history.push(line)
      saveHistory(props.moduleId, history)
      hIdx = history.length
      drawPrompt()
    }

    term.onData((data: string) => {
      for (let i = 0; i < data.length; i++) {
        const ch = data[i]
        const code = ch.charCodeAt(0)

        if (ch === '\r') {
          const line = buffer
          buffer = ''
          run(line)
        } else if (code === 127 || ch === '\b') {
          if (buffer.length > 0) {
            buffer = buffer.slice(0, -1)
            term.write('\b \b')
          }
        } else if (code === 3) {
          // Ctrl+C
          term.write('^C')
          buffer = ''
          term.writeln('')
          drawPrompt()
        } else if (code === 26) {
          // Ctrl+Z 撤销
          if (!shell) return
          const r = shell.undo()
          if (r.stdout) term.writeln(r.stdout)
          if (r.stderr) term.writeln('\x1b[31m' + r.stderr + '\x1b[0m')
          term.writeln('')
          drawPrompt()
        } else if (code === 12) {
          // Ctrl+L
          term.clear()
          banner(term)
          drawPrompt()
        } else if (code === 21) {
          // Ctrl+U 清空当前行
          resetLine()
        } else if (ch === '\x1b' && data[i + 1] === '[') {
          const k = data[i + 2]
          i += 2
          if (k === 'A') {
            if (hIdx > 0) {
              hIdx--
              resetLine()
              buffer = history[hIdx] || ''
              term.write(buffer)
            }
          } else if (k === 'B') {
            if (hIdx < history.length) {
              hIdx++
              resetLine()
              buffer = history[hIdx] || ''
              term.write(buffer)
            }
          }
        } else if (code >= 32 && code !== 127) {
          buffer += ch
          term.write(ch)
        }
      }
    })

    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => {
        // 调 fitAddon.fit()，不是 term.fit() —— Terminal 上没有 fit 方法
        try { fitRef.value?.fit() } catch { /* 布局未稳定时忽略 */ }
      })
      ro.observe(host.value)
    }

    // 宿主组件的重置 / 撤销按钮通过事件触发
    const onUndo = () => {
      if (!shell) return
      const r = shell.undo()
      term.writeln(r.stdout || r.stderr || '没有可撤销的操作')
      drawPrompt()
    }
    const onReset = () => {
      shell = new Shell()
      buffer = ''
      term.clear()
      banner(term)
      drawPrompt()
    }
    window.addEventListener('cc-term-undo', onUndo)
    window.addEventListener('cc-term-reset', onReset)
    cleanupFns = [
      () => window.removeEventListener('cc-term-undo', onUndo),
      () => window.removeEventListener('cc-term-reset', onReset),
    ]

    status.value = 'ready'
    // xterm 是在 status 还是 'loading' 时 open 的。
    // 若那时容器靠 v-show 处于 display:none，xterm 量到的宽高是 0，屏幕会一片空白。
    // 所以宿主 div 始终渲染（见模板），这里等布局稳定后再补一次 fit。
    await nextTick()
    try { fitRef.value?.fit() } catch { /* 忽略 */ }
  } catch (e) {
    // 离线或依赖加载失败：给明确出口，不留一片空白
    status.value = 'failed'
    errorMsg.value = e instanceof Error ? e.message : String(e)
  }
})

onUnmounted(() => {
  for (const fn of cleanupFns) {
    try { fn() } catch { /* 忽略 */ }
  }
  cleanupFns = []
  ro?.disconnect()
  ro = null
  // 不 dispose 会泄漏 xterm 的 DOM 监听器与 ResizeObserver（SPA 导航下组件会反复挂载）
  try { termRef.value?.dispose() } catch { /* 已 dispose */ }
  termRef.value = null
  fitRef.value = null
  shell = null
})
</script>

<template>
  <div class="live-term">
    <div class="live-term-head">
      <span>~ toyshell</span>
      <span v-if="status === 'ready'">{{ moduleId }}</span>
    </div>

    <div v-if="status === 'failed'" class="live-term-fallback">
      <p><b>终端没能加载。</b>通常是网络问题，或浏览器拦截了本地模块。</p>
      <p>这一章的命令都在正文里写全了，可以照着敲在本地终端里练：</p>
      <p><a :href="`/${def?.track ?? 'linux'}/reference/cheatsheet`">打开命令速查表 →</a></p>
      <p v-if="errorMsg" style="opacity:.6;font-size:12px">技术细节：{{ errorMsg }}</p>
    </div>

    <!-- 宿主 div 必须始终存在于 DOM 中。
         用 v-show 会在 xterm open() 时是 display:none，量到的宽高为 0，终端一片空白。 -->
    <div v-show="status !== 'failed'" ref="host" class="live-term-host" />

    <div v-if="status === 'loading'" class="live-term-overlay">终端加载中…</div>

    <div v-if="status === 'ready'" class="live-term-hint">
      <span><b>↑↓</b> 历史</span>
      <span><b>Ctrl+L</b> 清屏</span>
      <span><b>Ctrl+C</b> 中断</span>
      <span><b>Ctrl+Z</b> 撤销</span>
      <span><b>help</b> 看所有命令</span>
    </div>

    <details v-if="status === 'ready' && available.length" class="live-term-note">
      <summary>这个终端实现了哪些命令（敲 <code>help</code> 也能看到）</summary>
      <p>
        本模拟器只实现教学需要的命令子集。正文里出现但这里没有的命令
        （比如 <code>sed</code>、<code>awk</code>、<code>pgrep</code>），
        敲进去会回 <code>command not found</code> —— 那是模拟器的边界，不是你敲错了。
        这些命令的用法在正文里写全了，可以在自己电脑上练。
      </p>
      <p class="cmds">{{ available.join('  ') }}</p>
    </details>
  </div>
</template>
