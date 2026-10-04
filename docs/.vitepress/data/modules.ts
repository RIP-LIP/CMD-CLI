/**
 * 全站唯一章节数据源。
 *
 * 侧边栏、首页章节总表、进度页统计、徽章授予全部从这里派生。
 * 加一章只改这一处，不存在「改了侧边栏忘了首页」的可能。
 *
 * id 一律用文件名（'01-intro'），两轨各自命名空间，绝不复用。
 * 章节编号（原文站的 M01 / W02 之类）已废弃 —— 旧站三处文件对
 * 「M04」含义互相矛盾，编号本身就是 bug 来源。
 */

export type Track = 'linux' | 'windows'
export type Part = 'guide' | 'howto' | 'internals'
export type Difficulty = 'easy' | 'med' | 'adv'

export interface ModuleDef {
  id: string
  track: Track
  title: string
  /** 一句话说清这章解决什么，会进 meta description 与搜索结果 */
  summary: string
  part: Part
  /** 该段内序号，从 1 开始 */
  order: number
  minutes: number
  difficulty: Difficulty
  commandCount: number
  /** 是否挂浏览器内终端 */
  hasTerminal: boolean
  hasQuiz: boolean
  hasArena: boolean
  /** 徽章名，唯一来源 */
  badge: string
}

const L = (
  id: string,
  title: string,
  summary: string,
  part: Part,
  order: number,
  minutes: number,
  difficulty: Difficulty,
  commandCount: number,
  hasTerminal: boolean,
  hasArena: boolean,
  badge: string,
): ModuleDef => ({
  id, track: 'linux', title, summary, part, order, minutes,
  difficulty, commandCount, hasTerminal, hasQuiz: true, hasArena, badge,
})

const W = (
  id: string,
  title: string,
  summary: string,
  part: Part,
  order: number,
  minutes: number,
  difficulty: Difficulty,
  commandCount: number,
  hasTerminal: boolean,
  hasArena: boolean,
  badge: string,
): ModuleDef => ({
  id, track: 'windows', title, summary, part, order, minutes,
  difficulty, commandCount, hasTerminal, hasQuiz: true, hasArena, badge,
})

export const MODULES: ModuleDef[] = [
  // ── Linux · 上手篇 ─────────────────────────────────────────
  L('01-intro', '在终端里不迷路：定位与创建文件',
    'pwd / ls / cd / mkdir / touch / rm 六个命令，加上一套判断「我现在在哪、这里有什么」的固定动作。',
    'guide', 1, 20, 'easy', 7, true, true, 'files-explorer'),

  L('02-view', '读文件：什么时候该用 cat，什么时候必须用 less',
    'cat / less / head / tail 的选择依据，以及 less 里最常用的六个按键。',
    'guide', 2, 18, 'easy', 6, true, true, 'file-reader'),

  L('03-search', '找文件和找内容：find 与 grep 各自的边界',
    '按名字找和按内容找是两件事，find 与 grep 组合起来才是完整的定位动作。',
    'guide', 3, 20, 'easy', 6, true, true, 'search-master'),

  L('08-archive', '压缩归档与装软件：tar 与包管理器',
    'tar 的三个必记选项，以及 apt / dnf 装包前该先确认什么。',
    'guide', 4, 22, 'easy', 6, false, false, 'archive-keeper'),

  // ── Linux · 场景篇 ─────────────────────────────────────────
  L('04-permission', '权限：读懂 ls -l 的第一列，以及 rwx 不够用的时候',
    '八进制权限位怎么读，chmod 与 chown 分别在什么场景下用。',
    'howto', 1, 25, 'med', 6, true, true, 'permission-guardian'),

  L('05-process', '进程与资源：谁在跑、占了多少、怎么停',
    'ps / top / kill / free / df 的排查顺序，以及「进程还在但磁盘满了」怎么定位。',
    'howto', 2, 25, 'med', 7, true, true, 'process-controller'),

  L('06-network', '网络：机器通不通、端口开没开、配置对不对',
    'ping / curl / ss / dig 分工，DNS 解析失败时先查哪一样。',
    'howto', 3, 28, 'med', 7, false, false, 'network-pilot'),

  L('07-text', '文本三件套：grep / sed / awk 各自负责哪一段',
    '管道把三个工具串起来，常见需求对应的组合写法。',
    'howto', 4, 30, 'med', 7, false, false, 'text-wizard'),

  L('09-cross-platform', '跨平台协作：WSL、Samba 与远程桌面',
    'Linux 和 Windows 互相传文件的几种方式，各自的坑在哪。',
    'howto', 5, 28, 'adv', 5, false, false, 'bridge-builder'),

  L('10-shell-script', 'Shell 脚本：把一串手动操作固化成可重跑的东西',
    '变量、条件、循环、函数四个必备结构，以及脚本里最容易出错的三处引号。',
    'howto', 6, 35, 'adv', 9, false, false, 'script-author'),

  // ── Linux · 原理篇 ─────────────────────────────────────────
  L('11-systemd', 'systemd：服务起不来时按什么顺序查',
    'unit 文件的三段结构、journalctl 的过滤写法，以及 failed 之后该看哪几行。',
    'internals', 1, 28, 'adv', 5, true, true, 'systemd-manager'),

  L('12-docker', 'Docker：镜像、容器、卷三者的关系',
    '容器和虚拟机的实际差别，docker compose 从零到跑起来，以及容器起不来的排查顺序。',
    'internals', 2, 35, 'adv', 9, true, true, 'docker-operator'),

  L('13-ssh-key', 'SSH 与密钥：免密登录与主机验证',
    '密钥对生成与推送、known_hosts 的作用，以及「第一次连接时的那个 yes/no」到底在确认什么。',
    'internals', 3, 30, 'adv', 6, false, false, 'key-master'),

  L('14-cron', '计划任务：crontab 的五个字段与环境变量陷阱',
    '为什么 cron 里的脚本找不到命令，以及排查任务没执行的固定顺序。',
    'internals', 4, 25, 'adv', 6, true, true, 'cron-master'),

  L('15-acl', 'ACL：rwx 不够用时的精细授权',
    'getfacl / setfacl 的读写方式，以及 ACL 与 umask 的叠加效应。',
    'internals', 5, 28, 'adv', 5, true, true, 'acl-master'),

  // ── Windows · 上手篇 ───────────────────────────────────────
  W('01-file-system', 'CMD 与 PowerShell 基础命令',
    '两条 shell 各说什么、怎么互相翻译，以及路径里那些必须加引号的时刻。',
    'guide', 1, 22, 'easy', 8, true, true, 'win-file-system'),

  W('02-file-ops', '文件操作：复制、移动、删除',
    'CMD 与 PowerShell 的等价写法，以及删除操作真正删掉了什么。',
    'guide', 2, 22, 'easy', 9, true, true, 'win-file-ops'),

  W('03-batch-script', '批处理脚本：变量、条件与循环',
    '.bat 的基本结构与延迟展开陷阱，末尾附 PowerShell 的对应写法。',
    'guide', 3, 35, 'med', 12, true, true, 'win-batch'),

  W('04-powershell-intro', 'PowerShell：对象管道与别名体系',
    '为什么 PowerShell 的管道和 Unix 的不一样，以及别名让你少记一半命令。',
    'guide', 4, 30, 'med', 8, true, true, 'win-ps-intro'),

  // ── Windows · 场景篇 ───────────────────────────────────────
  W('05-process-service', '进程与服务：两套不同的管理模型',
    '进程和服务不是一回事，tasklist / Get-Process 与 sc / Get-Service 各管一层。',
    'howto', 1, 28, 'med', 8, false, false, 'win-proc-svc'),

  W('06-network', '网络诊断：从通不通到端口开没开',
    'ping / tracert / Test-NetConnection / ipconfig 组成的排查顺序。',
    'howto', 2, 30, 'med', 10, false, false, 'win-network'),

  W('07-text-processing', '文本处理：Findstr 与 Select-String',
    '两条 shell 各自的文本搜索写法，以及编码导致的「明明有却搜不到」。',
    'howto', 3, 28, 'med', 9, false, false, 'win-text'),

  W('08-pipeline', '管道与对象：PowerShell 的真正优势',
    '九组管道命令的组合用法，以及为什么这里不能照搬 Unix 的写法。',
    'howto', 4, 35, 'med', 12, false, false, 'win-pipeline'),

  // ── Windows · 原理篇 ───────────────────────────────────────
  W('09-registry', '注册表：改之前先导出',
    '注册表路径缩写、常见键值类型，以及任何修改之前的备份动作。',
    'internals', 1, 30, 'adv', 13, false, false, 'win-registry'),

  W('10-system-admin', '计划任务、事件日志与环境变量',
    'schtasks 与 Register-ScheduledTask 的区别，事件日志的过滤写法。',
    'internals', 2, 32, 'adv', 16, false, false, 'win-sysadmin'),

  W('11-remote', 'WinRM 与远程会话',
    'PSSession 怎么建立的，凭据与跳板机分别怎么配。',
    'internals', 3, 30, 'adv', 9, false, false, 'win-remote'),

  W('12-powershell-script', 'PowerShell 脚本：参数、作用域与错误处理',
    '参数绑定的坑、函数的作用域规则，以及 try/catch 为什么常被写错。',
    'internals', 4, 35, 'adv', 11, false, false, 'win-ps-script'),
]

// ── 派生工具 ──────────────────────────────────────────────────

export const TRACKS: Track[] = ['linux', 'windows']

export const TRACK_META: Record<Track, { name: string; icon: string; blurb: string }> = {
  linux: { name: 'Linux', icon: '🐧', blurb: '15 章 · 浏览器内 ToyShell 终端' },
  windows: { name: 'Windows', icon: '🪟', blurb: '12 章 · CMD 与 PowerShell 双轨' },
}

export const PART_META: Record<Part, { name: string; caption: string }> = {
  guide: { name: '上手篇', caption: '按顺序读，从零把命令敲顺' },
  howto: { name: '场景篇', caption: '遇到具体麻烦时查' },
  internals: { name: '原理篇', caption: '出故障时读，能自己定位' },
}

const PART_ORDER: Part[] = ['guide', 'howto', 'internals']

export function byTrack(track: Track): ModuleDef[] {
  return MODULES.filter((m) => m.track === track)
}

export function byPart(track: Track, part: Part): ModuleDef[] {
  return MODULES.filter((m) => m.track === track && m.part === part)
}

/** 进度环分母的唯一来源 —— 旧站这里硬编码 10 而 storage 里是 15，环永远到不了 100% */
export function totalFor(track: Track): number {
  return MODULES.filter((m) => m.track === track).length
}

export function indexById(id: string): ModuleDef | undefined {
  return MODULES.find((m) => m.id === id)
}

/** 站点内链接一律不带 .html 后缀 */
export function linkTo(m: ModuleDef): string {
  return `/${m.track}/${m.part}/${m.id}`
}

export function partsOf(track: Track): Part[] {
  return PART_ORDER.filter((p) => byPart(track, p).length > 0)
}
