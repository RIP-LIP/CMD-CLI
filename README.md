# CommandCraft

Linux 与 Windows 命令行学习站。27 章分两条线，每章带浏览器内终端，可以真敲命令、做完练习、留下进度。

## 跑起来

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # 产物在 docs/.vitepress/dist
npm run preview  # 预览生产构建
```

Node ≥ 18。

## 站点结构

```
docs/
├─ index.md              首页
├─ linux/                Linux 线（15 章）
│  ├─ guide/             上手篇 · 按顺序读
│  ├─ howto/             场景篇 · 遇到麻烦查
│  ├─ internals/         原理篇 · 出故障时读
│  └─ reference/         速查表
└─ windows/              Windows 线（12 章），结构同上
```

## 浏览器内终端

每个标了「可实操」的章节底部有一个真能敲的终端：

- **Linux 线**用 ToyShell（`lib/shell-linux.ts`）：虚拟文件系统 + 58 条命令 + 撤销栈
- **Windows 线**用 ToyWin（`lib/shell-windows.ts`）：虚拟文件系统 + 75 条 CMD/PowerShell 命令

终端下方有一个可展开的「这个终端实现了哪些命令」，列的是引擎真实支持的范围。正文里出现但模拟器没实现的命令，敲进去会报 not found —— 那是模拟器的边界，用法在正文里写全了，可以在自己电脑上练。

命令敲错会报错，任务做完会打勾，进度存在浏览器本地。

::: warning 终端是练习场，不是真机器
模拟器只实现教学需要的命令子集，行为以章节正文为准。要在真机上验证，请用章节里的命令清单自己跑。
:::

## 部署到 GitHub Pages

站点已配置为项目页：`base` 是 `'/CMD-CLI/'`，对应 https://RIP-LIP.github.io/CMD-CLI/ 。

**换仓库名时必须同步改 `docs/.vitepress/config.mts` 里的 `base`。** 不改的症状是：首页能开，点任何链接都是 404，静态资源全部加载失败。

`.github/workflows/deploy.yml` 已配好，推 `main` 分支触发构建。首次使用需要在仓库 **Settings → Pages** 把 Source 选成 **GitHub Actions**。

## 章节清单

章节清单只有一份数据源：`docs/.vitepress/data/modules.ts`。侧边栏、首页总表、进度页、徽章全部由它派生。加一章只需改这一处。

## 许可

代码 MIT，见 [LICENSE](./LICENSE)。
