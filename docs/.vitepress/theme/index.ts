/**
 * 主题入口。
 *
 * 引擎（lib/）零 DOM 依赖，组件里的终端在 onMounted 动态 import，
 * 这样 SSR 阶段不会碰到 window / document / Terminal。
 */

import DefaultTheme from 'vitepress/theme'
import type { Theme } from 'vitepress'

import ArenaTasks from './components/ArenaTasks.vue'
import QuizBlock from './components/QuizBlock.vue'
import TerminalBlock from './components/TerminalBlock.vue'
import ToyShellTerminal from './components/ToyShellTerminal.vue'
import ToyWinTerminal from './components/ToyWinTerminal.vue'
import ProgressRing from './components/ProgressRing.vue'
import ModuleMeta from './components/ModuleMeta.vue'
import ChapterTable from './components/ChapterTable.vue'
import BadgeWall from './components/BadgeWall.vue'

import './custom.css'

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('ToyShellTerminal', ToyShellTerminal)
    app.component('ToyWinTerminal', ToyWinTerminal)
    app.component('ArenaTasks', ArenaTasks)
    app.component('QuizBlock', QuizBlock)
    app.component('TerminalBlock', TerminalBlock)
    app.component('ProgressRing', ProgressRing)
    app.component('ModuleMeta', ModuleMeta)
    app.component('ChapterTable', ChapterTable)
    app.component('BadgeWall', BadgeWall)
  },
} satisfies Theme
