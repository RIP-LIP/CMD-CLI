import { defineConfig } from 'vitepress'
import { MODULES, TRACKS, TRACK_META, PART_META, byPart, partsOf, linkTo } from './data/modules'

/**
 * 站点唯一配置源。
 *
 * 侧边栏与顶部导航**由 data/modules.ts 派生**，不在这里手写。
 * 原因：旧站把章节清单手抄在 index / practice / progress 三个文件里，
 * 已经漂移出「M04 指哪一章」三种答案。派生是唯一的根治办法。
 *
 * ⚠️ 部署到 GitHub Pages 项目页前必须改 base 为 '/仓库名/'。
 *    不改的症状：首页能开，点任何链接都 404。
 */

const sidebar = Object.fromEntries(
  TRACKS.map((track) => {
    const groups = partsOf(track).map((part) => ({
      text: `${PART_META[part].name} · ${PART_META[part].caption}`,
      collapsed: false,
      items: byPart(track, part).map((m) => ({
        text: m.title,
        link: linkTo(m),
      })),
    }))

    groups.push({
      text: '速查表',
      collapsed: false,
      items: [{ text: `${TRACK_META[track].name} 命令速查`, link: `/${track}/reference/cheatsheet` }],
    })

    groups.push({
      text: '学习进度',
      collapsed: false,
      items: [{ text: `${TRACK_META[track].name} 进度与徽章`, link: `/${track}/reference/progress` }],
    })

    return [`/${track}/`, groups]
  }),
)

/** 仓库名即 Pages 路径。改仓库名时只改这一个常量。 */
const BASE = '/CMD-CLI/'

export default defineConfig({
  title: 'CommandCraft',
  description: 'Linux 与 Windows 命令行学习站：27 章分两条线，每章带浏览器内终端，可以真敲命令。',

  // GitHub Pages 项目页路径。仓库名是 CMD-CLI，站点挂在
  // https://RIP-LIP.github.io/CMD-CLI/ 下，所以 base 必须带仓库名。
  // ⚠️ 改仓库名时这里要同步改，否则首页能开、点任何链接都是 404。
  base: BASE,

  cleanUrls: false,
  lastUpdated: true,
  appearance: true,

  head: [
    // ⚠️ logo / favicon 这类路径 VitePress 不会自动加 base（导航链接会加），
    //    项目页下不手动拼就是 404。BASE 抽成常量，改仓库名时只改这一处。
    ['link', { rel: 'icon', href: `${BASE}logo.svg` }],
    ['meta', { property: 'og:title', content: 'CommandCraft · 命令行学习站' }],
    ['meta', { property: 'og:description', content: '27 章分两条线，每章带浏览器内终端，可以真敲命令。' }],
  ],

  themeConfig: {
    logo: `${BASE}logo.svg`,
    siteTitle: false,

    // 双轨下 nav 只回答「我要进哪条线」，段内跳转交给侧边栏。
    // 速查表不加 activeMatch —— 它同时属于两条线，加了会两边同时高亮。
    nav: [
      { text: 'Linux', link: '/linux/guide/01-intro', activeMatch: '^/linux/(guide|howto|internals)/' },
      { text: 'Windows', link: '/windows/guide/01-file-system', activeMatch: '^/windows/(guide|howto|internals)/' },
      { text: 'Linux 速查', link: '/linux/reference/cheatsheet' },
      { text: 'Windows 速查', link: '/windows/reference/cheatsheet' },
    ],

    outline: { level: [2, 3], label: '目录' },

    sidebar,

    search: {
      provider: 'local',
      options: {
        translations: {
          button: { buttonText: '搜索章节与命令', buttonAriaLabel: '搜索章节与命令' },
          modal: {
            displayDetails: '显示详细列表',
            resetButtonTitle: '清除查询条件',
            backButtonTitle: '关闭搜索',
            noResultsText: '没有找到相关内容',
            footer: { selectText: '选择', navigateText: '切换', closeText: '关闭' },
          },
        },
      },
    },

    // 上传到 GitHub 后填上真实仓库地址；留空数组则不显示
    socialLinks: [] as { icon: string; link: string }[],

    docFooter: { prev: '上一页', next: '下一页' },
    lastUpdatedText: '最后更新',

    footer: {
      message: '进度保存在你自己的浏览器里，不上传任何数据',
      copyright: 'CommandCraft · 命令行学习站',
    },
  },

  // 保证 data/modules.ts 在 SSR 与客户端被解析成同一份数据
  vite: {
    define: {
      __MODULE_COUNT__: JSON.stringify(MODULES.length),
    },
  },

  markdown: {
    // Shiki 默认不带 cron / sshconfig 这两个语言，不映射的话每段都会打印
    // "not loaded, falling back to txt" 警告。映射到最接近的高亮器即可。
    config(md) {
      const fence = md.renderer.rules.fence!
      md.renderer.rules.fence = (...args) => {
        const [tokens, idx, options, env, self] = args
        const alias: Record<string, string> = {
          cron: 'bash',
          crontab: 'bash',
          sshconfig: 'ini',
          ini: 'ini',
        }
        const token = tokens[idx]
        const lang = token.info?.trim().split(/\s+/)[0]
        if (lang && alias[lang]) {
          token.info = token.info.replace(lang, alias[lang])
        }
        return fence(tokens, idx, options, env, self)
      }
    },
  },
})
