<script setup lang="ts">
/**
 * 浏览器内 Windows 终端（ToyWin）。
 *
 * 与 ToyShellTerminal 同样的 SSR 纪律：引擎静态 import（零 DOM），
 * xterm 在 onMounted 动态 import，fitAddon 存进闭包供 resize 与卸载共用。
 *
 * VFS 快照会存进 localStorage，刷新后虚拟目录还在 ——
 * 旧站的 W01–W04 就是这么做的，这里保留。
 */
import { ref, computed, nextTick, onMounted, onUnmounted, shallowRef } from 'vue'
import { WinShell } from '../../lib/shell-windows'
import { loadHistory, saveHistory, loadWinState, saveWinState } from '../../lib/store'
import { WINDOWS_TASKS } from '../../lib/tasks-windows'
import { indexById } from '../../data/modules'

// ⚠️ xterm 样式必须静态 import，动态 import 在 dev 下不注入，字符会不可见
import 'xterm/css/xterm.css'

const props = defineProps<{ moduleId: string }>()

const tasks = computed(() => WINDOWS_TASKS[props.moduleId] ?? [])
const def = computed(() => indexById(props.moduleId))

/** 引擎真正实现了哪些命令 —— 如实告知，避免「敲了报不是内部命令」误判成自己敲错 */
const available = ref<string[]>([])

const host = ref<HTMLElement | null>(null)
const status = ref<'loading' | 'ready' | 'failed'>('loading')
const errorMsg = ref('')

const termRef = shallowRef<any>(null)
const fitRef = shallowRef<any>(null)
let ro: ResizeObserver | null = null
let shell: WinShell | null = null
/** 事件解绑函数，onMounted 里注册、在外层 onUnmounted 统一执行 */
let cleanupFns: (() => void)[] = []

function promptStr(s: WinShell): string {
  return `\x1b[1;37m${s.vfs.cwd}>\x1b[0m `
}

function banner(t: any) {
  t.writeln('\x1b[1;37mCommandCraft 实战演练 · ToyWin\x1b[0m')
  t.writeln('\x1b[90m▸ CMD 与 PowerShell 两种写法都认；help 查看命令\x1b[0m')
  t.writeln('\x1b[90m▸ Ctrl+L 清屏 · Ctrl+C 中断 · ↑↓ 翻历史\x1b[0m')
  t.writeln('')
}

onMounted(async () => {
  if (!host.value) return
  try {
    const [{ Terminal }, { FitAddon }] = await Promise.all([
      import('xterm'),
      import('@xterm/addon-fit'),
    ])

    shell = new WinShell()
    available.value = shell.supportedCommands()

    // 恢复上次的虚拟目录快照
    const snapshot = loadWinState<Record<string, unknown>>(props.moduleId)
    if (snapshot) {
      try { shell.vfs.restore(snapshot as never) } catch { /* 快照损坏就用默认目录 */ }
    }

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: '"JetBrains Mono", Consolas, "Courier New", monospace',
      theme: {
        background: '#0f172a',
        foreground: '#e2e8f0',
        cursor: '#f9fafb',
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
    fitRef.value = fit
    termRef.value = term

    try { fit.fit() } catch { /* 布局未稳定 */ }

    banner(term)
    term.write(promptStr(shell))

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
    const persist = () => {
      try { saveWinState(props.moduleId, shell!.vfs.serialize()) } catch { /* 快照失败不影响使用 */ }
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

      const ctx = { cwd: shell.cwd }
      for (const t of tasks.value) {
        try {
          if (t.check(line, result, ctx)) {
            window.dispatchEvent(new CustomEvent('cc-task-hit', { detail: { moduleId: props.moduleId, taskId: t.id } }))
          }
        } catch { /* 单条任务出错不影响终端 */ }
      }

      persist()
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
          term.write('^C')
          buffer = ''
          term.writeln('')
          drawPrompt()
        } else if (code === 12) {
          term.clear()
          banner(term)
          drawPrompt()
        } else if (code === 21) {
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
        try { fitRef.value?.fit() } catch { /* 布局未稳定 */ }
      })
      ro.observe(host.value)
    }

    const onUndo = () => {
      if (!shell) return
      const r = shell.undo()
      term.writeln(r.stdout || r.stderr || '没有可撤销的操作')
      persist()
      drawPrompt()
    }
    const onReset = () => {
      shell = new WinShell()
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
    // 宿主 div 始终在 DOM 中（见模板），这里等布局稳定后补一次 fit，
    // 否则 open() 时量到 0 宽高，屏幕会空白。
    await nextTick()
    try { fitRef.value?.fit() } catch { /* 忽略 */ }
  } catch (e) {
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
  try { termRef.value?.dispose() } catch { /* 已 dispose */ }
  termRef.value = null
  fitRef.value = null
  shell = null
})
</script>

<template>
  <div class="live-term">
    <div class="live-term-head">
      <span>&gt;_ toywin</span>
      <span v-if="status === 'ready'">{{ moduleId }}</span>
    </div>

    <div v-if="status === 'failed'" class="live-term-fallback">
      <p><b>终端没能加载。</b>通常是网络问题，或浏览器拦截了本地模块。</p>
      <p>这一章的命令都在正文里写全了，可以照着敲在本地终端里练：</p>
      <p><a href="/windows/reference/cheatsheet">打开 Windows 命令速查表 →</a></p>      <p v-if="errorMsg" style="opacity:.6;font-size:12px">技术细节：{{ errorMsg }}</p>
    </div>

    <!-- 宿主 div 必须始终存在于 DOM 中。
         用 v-show 会在 xterm open() 时是 display:none，量到的宽高为 0，终端一片空白。 -->
    <div v-show="status !== 'failed'" ref="host" class="live-term-host" />

    <div v-if="status === 'loading'" class="live-term-overlay">终端加载中…</div>

    <div v-if="status === 'ready'" class="live-term-hint">
      <span><b>↑↓</b> 历史</span>
      <span><b>Ctrl+L</b> 清屏</span>
      <span><b>Ctrl+C</b> 中断</span>
      <span><b>help</b> 看所有命令</span>
    </div>

    <details v-if="status === 'ready' && available.length" class="live-term-note">
      <summary>这个终端实现了哪些命令（敲 <code>help</code> 也能看到）</summary>
      <p>
        本模拟器只实现教学需要的命令子集。正文里出现但这里没有的命令
        （比如 <code>robocopy</code>、<code>Get-Service</code>、<code>schtasks</code>），
        敲进去会回「不是内部或外部命令」—— 那是模拟器的边界，不是你敲错了。
        这些命令的用法在正文里写全了，可以在自己电脑上练。
      </p>
      <p class="cmds">{{ available.join('  ') }}</p>
    </details>
  </div>
</template>
