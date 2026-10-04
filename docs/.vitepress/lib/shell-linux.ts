/**
 * ToyShell —— Linux 命令行模拟引擎。
 *
 * ⚠️ 零 DOM 依赖。不得 import 任何触碰 window / document 的东西。
 *
 * 移植自旧站 shell.js，但**逐条核对过行为**，不是照抄：
 *  - parseMode 对无法识别的权限串返回 null 并报错（旧版静默返回 0，
 *    等于把看不懂的输入当成 000，比报错危险）
 *  - rm 拒绝删除根目录
 *  - cp / mv 目标是已存在目录时放进目录内，而不是覆盖它
 *  - 未注册命令的提示与真实 bash 一致：bash: xxx: command not found
 */

import { VFS, formatMode, formatSize, parseMode, type VNode } from './vfs-linux'

export interface ExecResult {
  stdout: string
  stderr: string
  exit: number
  /** 终端收到该标记时执行 clear */
  clear?: boolean
  exitShell?: boolean
}

export interface TaskCheckCtx {
  cwd: string
}

export interface TaskDef {
  id: string
  label: string
  check: (line: string, result: ExecResult, ctx: TaskCheckCtx) => boolean
}

type CmdFn = (args: string[]) => ExecResult
interface UndoEntry {
  type: 'mkdir' | 'touch' | 'rm'
  path: string
  mode?: number
  oldContent?: string
  oldMtime?: number
  oldMode?: number
  existed?: boolean
  wasDir?: boolean
  children?: Record<string, VNode>
}

const ok = (stdout = ''): ExecResult => ({ stdout, stderr: '', exit: 0 })
const fail = (stderr: string, exit = 1): ExecResult => ({ stdout: '', stderr, exit })

export class Shell {
  vfs: VFS
  env: Record<string, string>
  history: string[] = []
  lastExit = 0
  undoStack: UndoEntry[] = []
  undoLimit = 50
  private commands: Record<string, CmdFn> = {}

  constructor(vfs?: VFS) {
    this.vfs = vfs ?? new VFS()
    this.env = {
      HOME: this.vfs.home,
      USER: this.vfs.user,
      SHELL: '/bin/bash',
      PATH: '/usr/local/bin:/usr/bin:/bin',
      LANG: 'C.UTF-8',
      TERM: 'xterm-256color',
    }
    this.registerCore()
    this.registerExtras()
    this.registerService()
  }

  /** 支持引号与转义的简单分词 */
  parse(line: string): string[] {
    const tokens: string[] = []
    let cur = ''
    let quote: '"' | "'" | null = null
    let started = false

    for (let i = 0; i < line.length; i++) {
      const c = line[i]
      if (quote) {
        if (c === quote) quote = null
        else cur += c
        continue
      }
      if (c === '"' || c === "'") {
        quote = c
        started = true
        continue
      }
      if (c === '\\' && i + 1 < line.length) {
        cur += line[i + 1]
        i++
        started = true
        continue
      }
      if (/\s/.test(c)) {
        if (cur || started) tokens.push(cur)
        cur = ''
        started = false
        continue
      }
      cur += c
      started = true
    }
    if (cur || started) tokens.push(cur)
    return tokens
  }

  exec(line: string): ExecResult {
    const tokens = this.parse(line)
    if (!tokens.length) return ok()

    const [cmd, ...args] = tokens
    this.history.push(line)
    this.lastExit = 0

    // 内建命令不走注册表，因为它们需要访问 shell 自身状态
    switch (cmd) {
      case 'cd': return this.cmdCd(args)
      case 'exit': return { ...ok(), exitShell: true }
      case 'history': return this.cmdHistory()
      case 'export': return this.cmdExport(args)
      case 'unset': return this.cmdUnset(args)
      case 'type': return this.cmdType(args)
      case 'help': return this.cmdHelp()
      default: break
    }

    const fn = this.commands[cmd]
    if (!fn) {
      // 真实 bash 对未知命令返回 127，这个数字会被脚本的 $? 读到，不能填 1
      const r = fail(`bash: ${cmd}: command not found`, 127)
      this.lastExit = 127
      return r
    }

    // 重定向：> 覆盖、>> 追加。命令本身看不到重定向目标
    const redirect = this.parseRedirect(tokens)
    if (redirect) {
      const r = fn(redirect.args)
      this.lastExit = r.exit
      const target = this.vfs.normalize(redirect.dest)

      // 覆盖写之前存快照，撤销才能还原原内容
      const existing = this.vfs.getNode(target)
      if (existing && existing.type === 'file' && redirect.mode === 'overwrite') {
        this.pushUndo({
          type: 'touch',
          path: target,
          existed: true,
          oldContent: existing.content,
          oldMtime: existing.mtime,
          oldMode: existing.mode,
        })
      }

      if (redirect.mode === 'stderr') {
        if (!r.stderr) return ok('')
        const target2 = this.vfs.normalize(redirect.dest)
        const w = this.vfs.append(target2, r.stderr + '\n')
        return w.ok ? ok('') : fail(`bash: ${redirect.dest}: ${w.err}`)
      }
      if (r.stderr) return r
      const w = redirect.mode === 'append' ? this.vfs.append(target, r.stdout) : this.vfs.write(target, r.stdout)
      return w.ok ? ok('') : fail(`bash: ${redirect.dest}: ${w.err}`)
    }

    const r = fn(args)
    this.lastExit = r.exit
    return r
  }

  /** 拆出 `> file` / `>> file` / `2> file`，目标含空格时已在分词阶段被引号包住 */
  private parseRedirect(tokens: string[]): { args: string[]; dest: string; mode: 'overwrite' | 'append' | 'stderr' } | null {
    for (let i = 1; i < tokens.length; i++) {
      const t = tokens[i]
      if (t === '>' || t === '>>') {
        const dest = tokens[i + 1]
        if (!dest) return null
        return { args: tokens.slice(0, i), dest, mode: t === '>' ? 'overwrite' : 'append' }
      }
      if (t === '2>') {
        const dest = tokens[i + 1]
        if (!dest) return null
        return { args: tokens.slice(0, i), dest, mode: 'stderr' }
      }
    }
    return null
  }

  // ── 内建 ────────────────────────────────────────────────────

  private cmdCd(args: string[]): ExecResult {
    const target = args[0] || '~'
    const r = this.vfs.cd(target)
    return r.ok ? ok(this.vfs.displayPath()) : fail(`bash: cd: ${r.err}`)
  }

  private cmdHistory(): ExecResult {
    if (!this.history.length) return ok()
    return ok(this.history.map((h, i) => `${String(i + 1).padStart(4)}  ${h}`).join('\n'))
  }

  private cmdExport(args: string[]): ExecResult {
    if (!args.length) {
      return ok(Object.entries(this.env).map(([k, v]) => `declare -x ${k}="${v}"`).join('\n'))
    }
    for (const a of args) {
      const eq = a.indexOf('=')
      if (eq === -1) continue
      const k = a.slice(0, eq)
      const v = a.slice(eq + 1)
      this.env[k] = v
      if (k === 'HOME') this.vfs.home = v
      if (k === 'USER') this.vfs.user = v
    }
    return ok()
  }

  private cmdUnset(args: string[]): ExecResult {
    for (const k of args) delete this.env[k]
    return ok()
  }

  private cmdType(args: string[]): ExecResult {
    if (!args.length) return fail('bash: type: missing operand')
    const out: string[] = []
    for (const a of args) {
      if (['cd', 'exit', 'history', 'export', 'unset', 'type', 'help'].includes(a)) {
        out.push(`${a} is a shell builtin`)
      } else if (this.commands[a]) {
        out.push(`${a} is /usr/bin/${a}`)
      } else {
        out.push(`bash: type: ${a}: not found`)
      }
    }
    return ok(out.join('\n'))
  }

  private cmdHelp(): ExecResult {
    const groups: [string, string[]][] = [
      ['文件与目录', ['pwd', 'ls', 'cd', 'mkdir', 'touch', 'rm', 'cp', 'mv', 'tree', 'cat', 'less']],
      ['查看内容', ['head', 'tail', 'grep', 'wc', 'sort', 'uniq', 'find']],
      ['权限', ['chmod', 'chown']],
      ['压缩归档', ['tar', 'gzip', 'zip', 'unzip']],
      ['网络', ['ping', 'curl', 'wget', 'ssh', 'scp', 'smbclient', 'wsl']],
      ['系统信息', ['ps', 'top', 'kill', 'free', 'df', 'du', 'uptime', 'hostname', 'whoami', 'date']],
      ['软件包', ['apt']],
      ['其他', ['echo', 'which', 'man', 'clear', 'history', 'export', 'unset', 'type', 'exit']],
    ]
    const lines = groups.map(([g, cmds]) => `── ${g} ──\n${cmds.join('  ')}`)
    lines.push('', '输入命令名可以看用法，例如：man chmod')
    return ok(lines.join('\n'))
  }

  // ── 撤销 ────────────────────────────────────────────────────

  private pushUndo(entry: UndoEntry) {
    this.undoStack.push(entry)
    if (this.undoStack.length > this.undoLimit) this.undoStack.shift()
  }

  undo(): ExecResult {
    const inv = this.undoStack.pop()
    if (!inv) return fail('没有可撤销的操作')

    switch (inv.type) {
      case 'mkdir': {
        const r = this.vfs.rm(inv.path, { r: true })
        return r.ok ? ok(`已撤销：rmdir ${inv.path}`) : fail(`撤销失败：${r.err}`)
      }
      case 'touch': {
        if (inv.existed) {
          this.vfs.write(inv.path, inv.oldContent ?? '')
          const n = this.vfs.getNode(inv.path)
          if (n) {
            n.mtime = inv.oldMtime ?? n.mtime
            n.mode = inv.oldMode ?? n.mode
          }
          return ok(`已撤销：恢复 ${inv.path} 的原内容`)
        }
        const r = this.vfs.rm(inv.path)
        return r.ok ? ok(`已撤销：删除 ${inv.path}`) : fail(`撤销失败：${r.err}`)
      }
      case 'rm': {
        this.vfs.mkdir(inv.path, inv.mode ?? 0o755)
        const n = this.vfs.getNode(inv.path)
        if (n && n.type === 'dir' && inv.children) n.children = JSON.parse(JSON.stringify(inv.children))
        return ok(`已撤销：恢复 ${inv.path}`)
      }
      default:
        return fail('没有可撤销的操作')
    }
  }

  undoCount(): number {
    return this.undoStack.length
  }

  // ── 核心命令 ────────────────────────────────────────────────

  private fmtLsLine(node: VNode, path: string, long: boolean, all: boolean, human: boolean): string {
    if (!long) return path.split('/').filter(Boolean).pop() || '/'
    const isDir = node.type === 'dir'
    const mode = formatMode(node.mode)
    const size = node.type === 'file' ? (human ? formatSize(node.content.length) : String(node.content.length)) : '4096'
    const owner = (node as VNode & { owner?: string }).owner || this.vfs.user
    const group = (node as VNode & { group?: string }).group || this.vfs.user
    const d = new Date(node.mtime)
    const mon = d.toLocaleString('en-US', { month: 'short' }).padEnd(3)
    const day = String(d.getDate()).padStart(2, ' ')
    const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    return `${isDir ? 'd' : '-'}${mode} 1 ${owner} ${group} ${size.padStart(8)} ${mon} ${day} ${time} ${path.split('/').filter(Boolean).pop() || '/'}`
  }

  private registerCore() {
    const vfs = () => this.vfs

    this.commands.pwd = () => ok(vfs().cwd)

    this.commands.echo = (args) => ok(args.join(' '))

    this.commands.whoami = () => ok(vfs().user)

    this.commands.hostname = () => {
      const n = vfs().getNode('/etc/hostname')
      return ok(n && n.type === 'file' ? n.content.trim() : 'localhost')
    }

    this.commands.date = () => ok(new Date().toString())

    this.commands.clear = () => ({ ...ok(), clear: true })

    this.commands.uptime = () => {
      const n = vfs().getNode('/proc/uptime')
      const sec = n && n.type === 'file' ? parseFloat(n.content.trim().split(/\s+/)[0]) : 0
      const h = Math.floor(sec / 3600)
      const m = Math.floor((sec % 3600) / 60)
      return ok(` ${new Date().toString()}  up ${h}h ${m}m, 1 user, load average: 0.10, 0.08, 0.05`)
    }

    this.commands.which = (args) => {
      if (!args.length) return ok()
      const out: string[] = []
      for (const a of args) {
        if (this.commands[a] || ['cd', 'export', 'history'].includes(a)) out.push(`/usr/bin/${a}`)
        else out.push(`${a} not found`)
      }
      return ok(out.join('\n'))
    }

    this.commands.ls = (args) => {
      const flags = args.filter((a) => a.startsWith('-')).join('')
      const long = /l/.test(flags)
      const all = /a/.test(flags)
      const human = /h/.test(flags)
      const targets = args.filter((a) => !a.startsWith('-'))
      const paths = targets.length ? targets : [vfs().cwd]

      const out: string[] = []
      for (const t of paths) {
        const abs = vfs().normalize(t)
        const node = vfs().getNode(abs)
        if (!node) {
          out.push(`ls: cannot access '${t}': No such file or directory`)
          continue
        }
        if (node.type === 'file') {
          out.push(this.fmtLsLine(node, abs, long, all, human))
          continue
        }
        if (paths.length > 1) out.push(`${t}:`)

        let names = Object.keys(node.children).sort()
        if (!all) names = names.filter((n) => !n.startsWith('.'))
        if (long) out.push(`total ${names.length}`)

        for (const n of names) {
          const child = node.children[n]
          const childPath = `${abs === '/' ? '' : abs}/${n}`
          out.push(this.fmtLsLine(child, childPath, long, all, human))
        }
      }
      return out.some((l) => l.startsWith('ls: cannot access'))
        ? { stdout: '', stderr: out.filter((l) => l.startsWith('ls: cannot access')).join('\n'), exit: 2 }
        : ok(out.join('\n'))
    }

    this.commands.mkdir = (args) => {
      const targets = args.filter((a) => !a.startsWith('-'))
      const recursive = args.some((a) => a.startsWith('-') && a.includes('p'))
      if (!targets.length) return fail('mkdir: missing operand')
      for (const t of targets) {
        const abs = vfs().normalize(t)
        const existed = vfs().exists(abs)
        const r = vfs().mkdir(abs, 0o755, recursive)
        if (!r.ok) return fail(r.err!)
        if (!existed) this.pushUndo({ type: 'mkdir', path: abs, mode: 0o755 })
      }
      return ok()
    }

    this.commands.rm = (args) => {
      const flags = args.filter((a) => a.startsWith('-')).join('')
      const recursive = /[rR]/.test(flags)
      const force = flags.includes('f')
      const targets = args.filter((a) => !a.startsWith('-'))
      if (!targets.length) return force ? ok() : fail('rm: missing operand')

      const errs: string[] = []
      for (const t of targets) {
        const abs = vfs().normalize(t)
        if (abs === '/') {
          if (!force) errs.push('rm: it is dangerous to operate recursively on \'/\'\nrm: use --no-preserve-root to override')
          continue
        }
        const node = vfs().getNode(abs)
        if (!node) {
          if (!force) errs.push(`rm: cannot remove '${t}': No such file or directory`)
          continue
        }
        // 存快照才能撤销删除
        const loc = vfs().parentOf(abs)
        this.pushUndo({
          type: 'rm',
          path: abs,
          mode: node.mode,
          wasDir: node.type === 'dir',
          children: node.type === 'dir' ? node.children : undefined,
        })
        void loc
        const r = vfs().rm(abs, { r: recursive })
        if (!r.ok && !force) errs.push(r.err!)
      }
      return errs.length ? fail(errs.join('\n')) : ok()
    }

    this.commands.touch = (args) => {
      const targets = args.filter((a) => !a.startsWith('-'))
      if (!targets.length) return fail('touch: missing file operand')
      for (const t of targets) {
        const abs = vfs().normalize(t)
        const node = vfs().getNode(abs)
        if (node?.type === 'dir') return fail(`touch: cannot touch '${t}': Is a directory`)
        if (node?.type === 'file') {
          node.mtime = Date.now()
          continue
        }
        this.pushUndo({
          type: 'touch',
          path: abs,
          existed: false,
        })
        const r = vfs().write(abs, '')
        if (!r.ok) return fail(r.err!)
      }
      return ok()
    }

    this.commands.cp = (args) => {
      const targets = args.filter((a) => !a.startsWith('-'))
      if (targets.length < 2) return fail('cp: missing destination file operand')
      const dest = targets[targets.length - 1]
      const sources = targets.slice(0, -1)
      const destIsDir = vfs().isDir(dest)
      if (sources.length > 1 && !destIsDir) return fail(`cp: target '${dest}' is not a directory`)

      const errs: string[] = []
      for (const s of sources) {
        const r = vfs().cp(s, dest)
        if (!r.ok) errs.push(r.err!)
      }
      return errs.length ? fail(errs.join('\n')) : ok()
    }

    this.commands.mv = (args) => {
      const targets = args.filter((a) => !a.startsWith('-'))
      if (targets.length < 2) return fail('mv: missing destination file operand')
      const dest = targets[targets.length - 1]
      const sources = targets.slice(0, -1)
      const destIsDir = vfs().isDir(dest)
      if (sources.length > 1 && !destIsDir) return fail(`mv: target '${dest}' is not a directory`)

      const errs: string[] = []
      for (const s of sources) {
        const r = vfs().mv(s, dest)
        if (!r.ok) errs.push(r.err!)
      }
      return errs.length ? fail(errs.join('\n')) : ok()
    }

    this.commands.cat = (args) => {
      const targets = args.filter((a) => !a.startsWith('-'))
      if (!targets.length) return fail('cat: missing file operand')
      const out: string[] = []
      const errs: string[] = []
      for (const t of targets) {
        const r = vfs().read(t)
        if (r.ok) out.push(r.content!)
        else errs.push(r.err!)
      }
      return errs.length ? { stdout: out.join(''), stderr: errs.join('\n'), exit: 1 } : ok(out.join(''))
    }

    this.commands.head = (args) => this.headTail(args, 'head')
    this.commands.tail = (args) => this.headTail(args, 'tail')

    this.commands.less = (args) => {
      const targets = args.filter((a) => !a.startsWith('-'))
      if (!targets.length) return fail('less: missing file operand')
      // 模拟器里 less 等价于输出全文，学习者该记住的是按键而不是行为
      const r = this.commands.cat(targets)
      if (r.exit) return r
      const lines = r.stdout.split('\n')
      return ok(lines.slice(0, 20).join('\n'))
    }

    this.commands.wc = (args) => {
      const targets = args.filter((a) => !a.startsWith('-'))
      if (!targets.length) return fail('wc: missing file operand')
      const lines = args.filter((a) => a.startsWith('-')).join('')
      const out: string[] = []
      for (const t of targets) {
        const r = vfs().read(t)
        if (!r.ok) return fail(r.err!)
        const content = r.content!
        const row: string[] = []
        if (lines.includes('l')) row.push(String(content.split('\n').length))
        if (lines.includes('w')) row.push(String(content.split(/\s+/).filter(Boolean).length))
        if (lines.includes('c')) row.push(String(content.length))
        if (!row.length) row.push(String(content.split('\n').length), String(content.split(/\s+/).filter(Boolean).length), String(content.length))
        out.push(`${row.join(' ')} ${t}`)
      }
      return ok(out.join('\n'))
    }

    this.commands.tree = (args) => {
      const root = vfs().normalize(args[0] || '.')
      const node = vfs().getNode(root)
      if (!node) return fail(`tree: '${args[0] || '.'}': No such file or directory`)
      const lines = [root]
      const rec = (n: VNode, prefix: string) => {
        if (n.type !== 'dir') return
        const names = Object.keys(n.children).sort()
        names.forEach((name, i) => {
          const last = i === names.length - 1
          lines.push(`${prefix}${last ? '└── ' : '├── '}${name}`)
          rec(n.children[name], `${prefix}${last ? '    ' : '│   '}`)
        })
      }
      rec(node, '')
      return ok(lines.join('\n'))
    }

    this.commands.man = (args) => {
      if (!args.length) return fail('What manual page do you want?')
      const name = args[0]
      if (!this.commands[name] && !['cd', 'export'].includes(name)) {
        return fail(`No manual entry for ${name}`)
      }
      return ok(`${name.toUpperCase()}(1)                     User Commands\n\nNAME\n     ${name} — 教学模拟环境中的 ${name}\n\nDESCRIPTION\n     这是模拟器，实现的是教学所需的子集。完整语义请查官方文档。`)
    }

    this.commands.chmod = (args) => {
      const pos = args.filter((a) => !a.startsWith('-'))
      if (pos.length < 2) return fail('chmod: missing operand')
      const [modeStr, ...targets] = pos
      const mode = parseMode(modeStr)
      if (mode === null) return fail(`chmod: invalid mode: '${modeStr}'`)
      const errs: string[] = []
      for (const t of targets) {
        const abs = vfs().normalize(t)
        const node = vfs().getNode(abs)
        const oldMode = node?.mode
        const r = vfs().chmod(abs, mode)
        if (!r.ok) errs.push(r.err!)
        else if (oldMode !== undefined) {
          this.pushUndo({ type: 'touch', path: abs, existed: true, oldMode, oldContent: '', oldMtime: node!.mtime })
        }
      }
      return errs.length ? fail(errs.join('\n')) : ok()
    }

    this.commands.chown = (args) => {
      const pos = args.filter((a) => !a.startsWith('-'))
      if (pos.length < 2) return fail('chown: missing operand')
      const [spec, ...targets] = pos
      const [user, group] = spec.includes(':') ? spec.split(':') : [spec, undefined]
      const errs: string[] = []
      for (const t of targets) {
        const r = vfs().chown(t, user, group)
        if (!r.ok) errs.push(r.err!)
      }
      return errs.length ? fail(errs.join('\n')) : ok()
    }
  }

  /**
   * 服务与容器类命令。
   *
   * ⚠️ 这几个命令原先缺失，但 11-systemd / 12-docker / 14-cron / 15-acl 四章
   *    的正文和演练任务都以它们为主角。读者在终端里敲 `systemctl status nginx`
   *    却得到 command not found，而任务照样打勾 —— 页面写着「真敲一遍」，
   *    实际教不出任何东西。这里补上，输出格式对齐各章正文里的描述。
   */
  private registerService() {
    const vfs = () => this.vfs

    interface Unit { desc: string; state: 'active' | 'failed' | 'inactive'; sub: string; mainPid: number }
    const units: Record<string, Unit> = {
      'nginx.service': { desc: 'A high performance web server', state: 'active', sub: 'running', mainPid: 1180 },
      'docker.service': { desc: 'Docker Application Container Engine', state: 'active', sub: 'running', mainPid: 980 },
      'ssh.service': { desc: 'OpenBSD Secure Shell server', state: 'active', sub: 'running', mainPid: 812 },
      'cron.service': { desc: 'Regular background program processing daemon', state: 'active', sub: 'running', mainPid: 704 },
      'app.service': { desc: '示例应用服务', state: 'failed', sub: 'failed', mainPid: 0 },
    }
    let crontabText = [
      '# 分 时 日 月 周  命令',
      '0  3  *  *  *  /usr/bin/backup-db.sh',
      '*/15 *  *  *  *  /usr/bin/check-disk.sh',
      '',
    ].join('\n')

    this.commands.systemctl = (args) => {
      // `systemctl --failed` 单独出现时没有动词，必须先判掉，
      // 否则 --failed 被过滤掉后 pos 为空，只会打出一句用法。
      if (args.includes('--failed') || args.includes('--state=failed')) {
        const failed = Object.entries(units).filter(([, u]) => u.state === 'failed')
        if (!failed.length) {
          return ok('  UNIT LOADED ACTIVE SUB     DESCRIPTION\n\n0 loaded units listed.')
        }
        return ok(
          [
            '  UNIT LOADED ACTIVE SUB DESCRIPTION',
            ...failed.map(([n, u]) => `● ${n} loaded failed failed  ${u.desc}`),
            '',
            '1 failed units listed.',
          ].join('\n'),
        )
      }

      const pos = args.filter((a) => !a.startsWith('-'))
      // 真实 systemctl 里 `status nginx` 与 `status nginx.service` 等价，
      // 省略 .service 后缀是绝大多数人的写法，这里做同样的归一化。
      const normalizeUnit = (n: string) => (n && !n.includes('.') ? n + '.service' : n)
      const verb = pos[0]
      if (!verb) return fail('用法: systemctl status|start|stop|restart|enable|disable|is-active|list-units|show [--failed] 单元')
      if (verb === 'show' && pos[1]) {
        const u = units[normalizeUnit(pos[1])]
        if (!u) return fail(`Unit ${pos[1]} could not be found.`)
        return ok([
          `Id=${pos[1]}`,
          `Description=${u.desc}`,
          `LoadState=loaded`,
          `ActiveState=${u.state}`,
          `SubState=${u.sub}`,
          `MainPID=${u.mainPid}`,
          'ExecMainStatus=0',
          'TimeoutStartUSec=1min 30s',
        ].join('\n'))
      }
      if (verb === 'list-units') {
        return ok(
          [
            'UNIT                      LOAD   ACTIVE SUB     DESCRIPTION',
            ...Object.entries(units).map(([n, u]) =>
              `${n.padEnd(26)} loaded ${u.state.padEnd(6)} ${u.sub.padEnd(8)} ${u.desc}`),
          ].join('\n'),
        )
      }

      const name = normalizeUnit(pos[1] ?? '')
      if (!name) return fail('用法: systemctl ' + verb + ' 单元')
      const u = units[name]
      if (!u) return fail(`Unit ${name} could not be found.`)

      switch (verb) {
        case 'status':
          return ok([
            `● ${name} - ${u.desc}`,
            `     Loaded: loaded (/lib/systemd/system/${name}; enabled)`,
            `     Active: ${u.state} (${u.sub})`,
            u.state === 'failed'
              ? `     Main PID: ${u.mainPid || '-'}`
              : `     Main PID: ${u.mainPid}`,
            '     Tasks: 1 (limit: 38330)',
            u.state === 'failed' ? '     Process: 0 ExecMainPID=0' : '     CGroup: /system.slice/' + name,
            '',
            u.state === 'failed'
              ? 'Jul 21 10:05:12 devbox systemd[1]: ' + name + ' failed with result \'exit-code\'.'
              : 'Jul 21 10:00:01 devbox systemd[1]: Started ' + name + '.',
          ].join('\n'))
        case 'start':
        case 'restart':
        case 'reload':
          u.state = 'active'; u.sub = 'running'
          return ok(verb === 'reload' ? `Reloading ${name}...` : 'Job for ' + name + ' done.')
        case 'stop':
          u.state = 'inactive'; u.sub = 'dead'
          return ok(`Job for ${name} done.`)
        case 'enable':
        case 'disable':
          return ok(
            verb === 'enable'
              ? `Created symlink /etc/systemd/system/multi-user.target.wants/${name} → /lib/systemd/system/${name}.`
              : `Removed /etc/systemd/system/multi-user.target.wants/${name}.`,
          )
        case 'is-active':
          return { stdout: u.state + '\n', stderr: '', exit: u.state === 'active' ? 0 : 3 }
        default:
          return fail(`Unknown operation ' + '.`)
      }
    }

    this.commands.journalctl = (args) => {
      const unit = args.find((a, i) => args[i - 1] === '-u' || args[i - 1] === '--unit')
      const nMatch = args.join(' ').match(/-n\s*(\d+)/)
      const n = nMatch ? parseInt(nMatch[1], 10) : 10
      const lines = [
        'Jul 21 10:00:01 devbox systemd[1]: Started nginx.service.',
        'Jul 21 10:00:01 devbox nginx[1180]: start worker processes',
        'Jul 21 10:00:01 devbox nginx[1181]: worker process started',
        'Jul 21 10:12:44 devbox nginx[1181]: signal process exited (on signal 15)',
      ]
      if (args.includes('-f')) {
        return ok(lines.slice(-n).map((l) => (unit ? `${l} ` : l)).join('\n'))
      }
      return ok(lines.slice(-n).join('\n'))
    }

    this.commands.crontab = (args) => {
      if (args.includes('-l')) {
        return ok(crontabText.trimEnd())
      }
      if (args.includes('-e')) {
        return ok([
          'no changes made to crontab (使用 crontab -l 查看当前任务)',
          '',
          '在编辑器里加一行，例如：',
          '  */5 * * * *  /usr/bin/check-disk.sh',
        ].join('\n'))
      }
      if (args.includes('-r')) {
        crontabText = ''
        return ok()
      }
      // crontab 文件名参数：读取该用户的任务表
      const file = args.find((a) => !a.startsWith('-'))
      if (file) {
        const r = vfs().read(file)
        return r.ok ? ok(r.content!.trimEnd()) : fail(`crontab: ${file}: No such file or directory`)
      }
      return fail('usage: crontab [-l|-e|-r]')
    }

    this.commands.docker = (args) => {
      // `docker compose <子命令>` 是 12-docker 章的主线，必须能用
      if (args[0] === 'compose' || args[0] === 'docker-compose') {
        const sub2 = args[1]
        if (!sub2) return fail("用法: docker compose up|ps|down|logs|build")
        if (sub2 === 'up') {
          return ok([
            ' Network web_default  Creating',
            ' Network web_default  Created',
            ' Container web-db-1   Starting',
            ' Container web-db-1   Started',
            ' Container web-app-1  Starting',
            ' Container web-app-1  Started',
            '',
            '本地镜像没有改动时，up 会直接复用已有镜像，不会重新 build。',
          ].join('\n'))
        }
        if (sub2 === 'ps') {
          return ok(
            [
              'NAME           IMAGE          COMMAND                  SERVICE   CREATED          STATUS          PORTS',
              'web-app-1      app:latest     "node server.js"         app       5 seconds ago    Up 4 seconds    0.0.0.0:8080->80/tcp',
              'web-db-1       postgres:16    "docker-entrypoint.s…"   db        5 seconds ago    Up 4 seconds    5432/tcp',
            ].join('\n'),
          )
        }
        if (sub2 === 'down') {
          return ok([
            ' Container web-app-1  Removed',
            ' Container web-db-1   Removed',
            ' Network web_default  Removed',
          ].join('\n'))
        }
        if (sub2 === 'logs') {
          return ok('app-1  | node server listening on :8080\ndb-1   | database system is ready to accept connections')
        }
        if (sub2 === 'build') return ok('Successfully built\napp:latest')
        return fail(`docker compose: '${sub2}' is not supported by this simulator.`)
      }

      const sub = args[0]
      if (!sub) return fail("用法: docker ps|images|run|logs|stop|rm|info")
      if (sub === 'ps') {
        const all = args.includes('-a')
        const rows = [
          'CONTAINER ID   IMAGE          COMMAND                  STATUS          PORTS                    NAMES',
          '9f3a1c2b7d10   nginx:latest   "/docker-entrypoint.…"   Up 3 hours      0.0.0.0:8080->80/tcp     web',
          '4b7e2a9c1f83   redis:7        "redis-server"          Up 3 hours      0.0.0.0:6379->6379/tcp   cache',
        ]
        if (all) {
          rows.push('c1d3f5a8b204   app:latest    "node server.js"       Exited (137) 1 second ago            job-worker')
        }
        return ok(rows.join('\n'))
      }
      if (sub === 'images') {
        return ok([
          'REPOSITORY   TAG       IMAGE ID       CREATED         SIZE',
          'nginx        latest    8b1c2d3e4f50   3 days ago      187MB',
          'redis        7         a1b2c3d4e5f60   2 weeks ago     117MB',
          'app          latest    d4e5f6a7b8c9   5 hours ago     242MB',
        ].join('\n'))
      }
      if (sub === 'run') {
        return ok(
          [
            'Unable to find image \'nginx:latest\' locally',
            'latest: Pulling from library/nginx',
            'Digest: sha256:4b7e2a9c1f83a0b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6',
            'Status: Downloaded newer image for nginx:latest',
            '',
            'CONTAINER ID   IMAGE          COMMAND                  STATUS         PORTS                    NAMES',
            '7a1b2c3d4e5f   nginx:latest   "/docker-entrypoint.…"   Up 2 seconds    0.0.0.0:80->80/tcp       hopeful_hopper',
          ].join('\n'),
        )
      }
      if (sub === 'logs') {
        const n = args.find((a) => /^\d/.test(a)) || 'app'
        return ok([
          `172.17.0.1 - - [21/Jul/2026:10:00:03 +0000] "GET / HTTP/1.1" 200 615 "-"`,
          `172.17.0.1 - - [21/Jul/2026:10:05:17 +0000] "GET /health HTTP/1.1" 200 2 "-"`,
          `node server listening on :8080`,
        ].join('\n'))
      }
      if (sub === 'stop' || sub === 'rm') {
        const t = args.find((a) => !a.startsWith('-') && a !== sub) || 'container'
        return ok(t)
      }
      if (sub === 'info') {
        return ok([
          'Client: Docker Engine - Community',
          ' Version:    27.3.1',
          '',
          'Server:',
          ' Containers: 3',
          '  Running: 2',
          '  Paused: 0',
          '  Stopped: 1',
          ' Server Version: 27.3.1',
          ' Storage Driver: overlay2',
          ' Logging Driver: json-file',
        ].join('\n'))
      }
      return fail(`docker: '${sub}' is not supported by this simulator.`)
    }

    // ── ACL ───────────────────────────────────────────────
    const permsOf = (mode: number) => formatMode(mode)
    const baseEntries = (node: VNode) => {
      const perms = permsOf(node.mode)
      return [
        { type: 'user' as const, name: '', perms: perms[0] + perms[1] + perms[2] },
        { type: 'group' as const, name: '', perms: perms[3] + perms[4] + perms[5] },
        { type: 'other' as const, name: '', perms: perms[6] + perms[7] + perms[8] },
      ]
    }

    this.commands.getfacl = (args) => {
      const targets = args.filter((a) => !a.startsWith('-'))
      if (!targets.length) return fail('getfacl: 缺少文件参数')
      const out: string[] = []
      for (const t of targets) {
        const node = vfs().getNode(t)
        if (!node) return fail(`getfacl: 移除前导"/"时: 没有那个文件或目录: ${vfs().normalize(t)}`)
        const abs = vfs().normalize(t)
        out.push(`# file: ${abs}`)
        if (node.type === 'dir') out.push('# owner: ' + (node.owner || 'max'))
        if (node.type === 'dir') out.push('# group: ' + (node.group || 'max'))
        for (const e of baseEntries(node)) {
          out.push(`${e.type}::${e.perms}`)
        }
        const maskEntry = (node.acl ?? []).find((e) => e.type === 'mask')
        for (const e of node.acl ?? []) {
          if (e.type === 'mask') continue
          let line = `${e.type}:${e.name}:${e.perms}`
          // mask 存在时，命名条目的实际生效权限受 mask 限制
          if (maskEntry) {
            const eff =
              (e.perms[0] === 'r' && maskEntry.perms[0] === 'r' ? 'r' : '-') +
              (e.perms[1] === 'w' && maskEntry.perms[1] === 'w' ? 'w' : '-') +
              (e.perms[2] === 'x' && maskEntry.perms[2] === 'x' ? 'x' : '-')
            if (eff !== e.perms) line += `\t\t#effective:${eff}`
          }
          out.push(line)
        }
        if (maskEntry) out.push(`mask::${maskEntry.perms}`)
        out.push('')
      }
      return ok(out.join('\n'))
    }

    this.commands.setfacl = (args) => {
      // 真实写法是 `setfacl -m u:max:r-- 文件`：-m 与规则串是两个独立参数，
      // 分词后落在相邻两个 token，不能只找一个以 -m 开头的串。
      const flagIdx = args.findIndex((a) => a === '-m' || a === '-x' || a === '--set' || a === '--remove')
      if (flagIdx === -1) return fail('setfacl: 缺少 -m 或 -x')
      const isRemove = args[flagIdx] === '-x' || args[flagIdx] === '--remove'
      const body = args[flagIdx + 1]
      if (!body) return fail(`setfacl: ${args[flagIdx]} 需要一个规则参数`)
      const m = body.match(/^([ugm]):([^:]*):(.*)$/)
      if (!m) {
        // 真实 setfacl 允许 -x 省略权限段（u:alice 就够了），-m 省略会报格式错
        const short = body.match(/^([ug]):([^:]+)$/)
        if (isRemove && short) {
          const [, t2, n2] = short
          const targets2 = args.slice(flagIdx + 2).filter((a) => !a.startsWith('-'))
          if (!targets2.length) return fail('setfacl: 缺少文件参数')
          for (const t of targets2) {
            const node = vfs().getNode(t)
            if (!node) return fail(`setfacl: ${vfs().normalize(t)}: 没有那个文件或目录`)
            node.acl = (node.acl ?? []).filter((e) => !(e.type === t2 && e.name === n2))
          }
          return ok()
        }
        return fail(`setfacl: 格式错误: ${body}`)
      }
      const [, typeRaw, name, perms] = m
      // 输入用缩写 u/g/m，存储与输出必须用全名 user/group/mask，
      // 否则 getfacl 会打成 `u:alice:rwx`，且 mask 条目匹配不到，
      // #effective 注释就永远出不来。
      const type = typeRaw === 'u' ? 'user' : typeRaw === 'g' ? 'group' : 'mask'
      if (!isRemove && !/^[rwx-]{1,3}$/.test(perms)) {
        return fail(`setfacl: 只允许 rwx 权限: ${perms}`)
      }

      const targets = args.slice(flagIdx + 2).filter((a) => !a.startsWith('-'))
      if (!targets.length) return fail('setfacl: 缺少文件参数')

      for (const t of targets) {
        const node = vfs().getNode(t)
        if (!node) return fail(`setfacl: ${vfs().normalize(t)}: 没有那个文件或目录`)
        const list = node.acl ?? []
        if (isRemove) {
          node.acl = list.filter((e) => !(e.type === type && e.name === name))
        } else {
          const idx = list.findIndex((e) => e.type === type && e.name === name)
          const entry = { type: type as 'user' | 'group' | 'mask', name, perms }
          if (idx >= 0) list[idx] = entry
          else list.push(entry)
          node.acl = list
        }
      }
      return ok()
    }
  }

  private headTail(args: string[], which: 'head' | 'tail'): ExecResult {
    const flags = args.filter((a) => a.startsWith('-')).join('')
    const m = flags.match(/n?(\d+)/)
    const n = m ? parseInt(m[1], 10) : 10
    const targets = args.filter((a) => !a.startsWith('-'))
    if (!targets.length) return fail(`${which}: missing file operand`)

    const out: string[] = []
    for (const t of targets) {
      const r = this.vfs.read(t)
      if (!r.ok) return fail(r.err!)
      const lines = r.content!.split('\n')
      out.push(which === 'head' ? lines.slice(0, n).join('\n') : lines.slice(-n).join('\n'))
    }
    return ok(out.join('\n'))
  }

  // ── 扩展命令 ────────────────────────────────────────────────

  private registerExtras() {
    const vfs = () => this.vfs

    this.commands.grep = (args) => {
      const flags = args.filter((a) => a.startsWith('-'))
      const rest = args.filter((a) => !a.startsWith('-'))
      const invert = flags.some((f) => /v/.test(f))
      const ci = flags.some((f) => f.includes('i'))
      const showLineNo = flags.some((f) => /n/.test(f))
      const countOnly = flags.some((f) => /c/.test(f))
      const recursive = flags.some((f) => /r/.test(f))
      if (!rest.length) return fail('usage: grep [-i] [-v] [-n] [-c] [-r] PATTERN FILE')

      const pattern = rest[0]
      const targets = rest.slice(1)
      let re: RegExp
      try {
        re = new RegExp(pattern, ci ? 'i' : '')
      } catch {
        return fail(`grep: invalid pattern: ${pattern}`)
      }

      // 没给文件参数就是从 stdin 读；本模拟器没有管道 stdin，直接报用法错误
      if (!targets.length) return fail('usage: grep [-i] [-v] [-n] [-c] [-r] PATTERN FILE')

      const lines: { text: string; source: string; no: number }[] = []
      const errs: string[] = []
      for (const t of targets) {
        const node = vfs().getNode(t)
        if (!node) {
          errs.push(`grep: ${t}: No such file or directory`)
          continue
        }
        if (node.type === 'dir') {
          // 真实 grep 搜目录必须加 -r，否则报 Is a directory —— 这正是文档强调的差别
          if (!recursive) {
            errs.push(`grep: ${t}: Is a directory`)
            continue
          }
          for (const e of vfs().walk(t)) {
            if (e.node.type === 'file') {
              e.node.content.split('\n').forEach((l, i) => lines.push({ text: l, source: e.path, no: i + 1 }))
            }
          }
        } else {
          node.content.split('\n').forEach((l, i) => lines.push({ text: l, source: t, no: i + 1 }))
        }
      }
      if (errs.length) return { stdout: '', stderr: errs.join('\n'), exit: 2 }

      const hits = lines.filter(({ text }) => (re.test(text) ? true : false) !== invert)

      if (countOnly) return ok(String(hits.length))

      // ⚠️ 没有匹配时必须返回 1，不能返回 0。
      //    章节 03-search 与速查表都专门讲这一点（脚本里 if grep 会因此走错分支），
      //    模拟器若返回 0，等于教出和文档相反的结论。
      if (!hits.length) return { stdout: '', stderr: '', exit: 1 }

      const multi = targets.length > 1
      return ok(
        hits
          .map(({ text, source, no }) => {
            const prefix = multi ? `${source}:` : ''
            const num = showLineNo ? `${no}:` : ''
            return `${prefix}${num}${text}`
          })
          .join('\n'),
      )
    }

    this.commands.sort = (args) => {
      const targets = args.filter((a) => !a.startsWith('-'))
      const numeric = args.some((a) => a.startsWith('-') && a.includes('n'))
      const rev = args.some((a) => a.startsWith('-') && a.includes('r'))
      if (!targets.length) return fail('sort: missing operand')
      const r = vfs().read(targets[0])
      if (!r.ok) return fail(r.err!)
      let lines = r.content!.split('\n')
      lines = lines.sort((a, b) => {
        const r = numeric ? parseFloat(a) - parseFloat(b) : a.localeCompare(b)
        return rev ? -r : r
      })
      return ok(lines.join('\n'))
    }

    this.commands.uniq = (args) => {
      const targets = args.filter((a) => !a.startsWith('-'))
      if (!targets.length) return fail('uniq: missing operand')
      const r = vfs().read(targets[0])
      if (!r.ok) return fail(r.err!)
      const out: string[] = []
      for (const l of r.content!.split('\n')) {
        if (out[out.length - 1] !== l) out.push(l)
      }
      return ok(out.join('\n'))
    }

    this.commands.find = (args) => {
      if (!args.length) return fail('find: missing path')
      const root = vfs().normalize(args[0])
      if (!vfs().exists(root)) return fail(`find: '${args[0]}': No such file or directory`)
      const rest = args.slice(1)
      const nameIdx = rest.indexOf('-name')
      const namePat = nameIdx !== -1 ? rest[nameIdx + 1] : null
      const typeIdx = rest.indexOf('-type')
      const type = typeIdx !== -1 ? rest[typeIdx + 1] : null

      const re = namePat ? new RegExp('^' + namePat.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$') : null

      const out = vfs().walk(root)
        .filter((e) => {
          if (type === 'f' && e.node.type !== 'file') return false
          if (type === 'd' && e.node.type !== 'dir') return false
          if (re) {
            const base = e.path.split('/').filter(Boolean).pop() || ''
            if (!re.test(base)) return false
          }
          return true
        })
        .map((e) => e.path)

      return ok(out.join('\n'))
    }

    this.commands.ps = () => {
      const rows = [
        '  PID TTY          TIME CMD',
        ' 1024 pts/0    00:00:00 bash',
        ' 1180 pts/0    00:00:00 ps',
      ]
      return ok(rows.join('\n'))
    }

    this.commands.top = () => ok(
      'top - 10:32:14 up 0:57,  1 user,  load average: 0.10, 0.08, 0.05\n' +
      'Tasks:  92 total,   1 running,  91 sleeping\n' +
      '%Cpu(s):  3.1 us,  1.2 sy,  0.0 ni, 95.7 id\n' +
      'MiB Mem :  16225.6 total,   2056.2 free,   9925.1 used\n\n' +
      '（模拟输出：真实环境用 top -b -n1 跑一次）',
    )

    this.commands.kill = (args) => {
      const sig = args.filter((a) => a.startsWith('-')).join('')
      const pids = args.filter((a) => !a.startsWith('-'))
      if (!pids.length) return fail('usage: kill [-9] PID')
      return ok(pids.map((p) => (sig === '-9' ? `已强制终止进程 ${p}` : `已向进程 ${p} 发送 SIGTERM`)).join('\n'))
    }

    this.commands.free = () => {
      const mem = vfs().getNode('/proc/meminfo')
      let total = '16225584', avail = '10234752'
      if (mem && mem.type === 'file') {
        const get = (k: string) => mem.content.match(new RegExp(`${k}:\\s+(\\d+)`))?.[1]
        total = get('MemTotal') || total
        avail = get('MemAvailable') || avail
      }
      const used = (parseInt(total, 10) - parseInt(avail, 10)).toString()
      return ok(
        '               total        used        free      shared  buff/cache   available\n' +
        `Mem:        ${total.padStart(11)} ${used.padStart(12)} ${avail.padStart(12)}            0        2056 ${avail.padStart(12)}\n` +
        'Swap:            0           0           0',
      )
    }

    this.commands.df = () => {
      const used = Math.round(vfs().du('/'))
      return ok('Filesystem     1K-blocks     Used Available Use% Mounted on\n' +
        `/dev/sda1       1030808   ${String(used).padStart(6)}   952144 ${String(Math.round((used / 1030808) * 100)).padStart(3)}% /`)
    }

    this.commands.du = (args) => {
      const root = vfs().normalize(args[0] || '.')
      if (!vfs().exists(root)) return fail(`du: cannot access '${args[0]}': No such file or directory`)
      const rows = vfs().walk(root)
        .filter((e) => e.path !== root)
        .map((e) => `${Math.max(4, Math.ceil(vfs().du(e.path) / 1024) * 4)}\t${e.path}`)
      return ok(rows.join('\n'))
    }

    this.commands.tar = (args) => {
      const create = args.some((a) => a.startsWith('-') && a.includes('c'))
      const extract = args.some((a) => a.startsWith('-') && a.includes('x'))
      const list = args.some((a) => a.startsWith('-') && a.includes('t'))

      if (create) {
        const files = args.filter((a) => !a.startsWith('-'))
        if (files.length < 2) return fail('tar: 选项 \'--file\' 之后需要参数')
        const archive = vfs().normalize(files[0])
        const payload = files.slice(1).map((f) => `${vfs().normalize(f)}`).join('\n')
        const r = vfs().write(archive, `TAR-ARCHIVE\n${payload}\n`)
        return r.ok ? ok('') : fail(r.err!)
      }
      if (extract || list) {
        const files = args.filter((a) => !a.startsWith('-'))
        if (!files.length) return fail('tar: 选项 \'--file\' 之后需要参数')
        const r = vfs().read(vfs().normalize(files[0]))
        if (!r.ok) return fail(r.err!)
        const entries = r.content!.replace(/^TAR-ARCHIVE\n/, '').trim().split('\n').filter(Boolean)
        return ok(entries.join('\n'))
      }
      return fail("tar: 尝试猜测压缩格式\n请用 -cxf / -tf / -xf 明确指定")
    }

    this.commands.gzip = (args) => {
      const targets = args.filter((a) => !a.startsWith('-'))
      if (!targets.length) return fail('gzip: missing operand')
      const abs = vfs().normalize(targets[0])
      const r = vfs().read(abs)
      if (!r.ok) return fail(`gzip: ${targets[0]}: No such file or directory`)
      return vfs().write(abs + '.gz', r.content!).ok
        ? ok('')
        : fail('gzip: 写入失败')
    }

    this.commands.zip = (args) => {
      const files = args.filter((a) => !a.startsWith('-'))
      if (files.length < 2) return fail('zip: 指定了无效或不存在的文件')
      const archive = vfs().normalize(files[0])
      const r = vfs().write(archive, files.slice(1).map((f) => vfs().normalize(f)).join('\n'))
      return r.ok ? ok(`  adding: ${files.slice(1).join(' ')}\n  created: ${files[0]}`) : fail(r.err!)
    }

    this.commands.unzip = (args) => {
      const files = args.filter((a) => !a.startsWith('-'))
      if (!files.length) return fail('unzip: missing file operand')
      const r = vfs().read(vfs().normalize(files[0]))
      if (!r.ok) return fail(`unzip: cannot find ${files[0]}`)
      return ok(r.content!.split('\n').map((l) => `  inflating: ${l}`).join('\n'))
    }

    this.commands.ping = (args) => {
      const host = args[0]
      if (!host) return fail('ping: usage: ping [-c count] host')
      const countMatch = args.join(' ').match(/-c\s*(\d+)/)
      const count = countMatch ? parseInt(countMatch[1], 10) : 4
      const lines = [`PING ${host}: 56 data bytes`]
      for (let i = 0; i < count; i++) {
        lines.push(`64 bytes from ${host}: icmp_seq=${i} ttl=57 time=${(12.3 + i * 1.7).toFixed(2)} ms`)
      }
      lines.push(`--- ${host} ping statistics ---`,
        `${count} packets transmitted, ${count} received, 0% packet loss, time 3002ms`)
      return ok(lines.join('\n'))
    }

    this.commands.curl = (args) => {
      const url = args.find((a) => /^https?:\/\//.test(a))
      if (!url) return fail('curl: try \'curl --help\'')
      const showHeaders = args.includes('-I') || args.includes('-i')
      const lines = [`*   Trying 93.184.216.34:80...`, `* Connected to ${url}`]
      lines.push('< HTTP/1.1 200 OK')
      lines.push('< Content-Type: text/html; charset=utf-8')
      lines.push('< Content-Length: 1256')
      if (!showHeaders) {
        lines.push('---')
        lines.push('<!doctype html>')
        lines.push('<title>Example Domain</title>')
        lines.push('<h1>Example Domain</h1>')
      }
      return ok(lines.join('\n'))
    }

    this.commands.wget = (args) => {
      const url = args.find((a) => /^https?:\/\//.test(a))
      if (!url) return fail('wget: missing URL')
      const name = url.split('/').filter(Boolean).pop() || 'index.html'
      const r = vfs().write(name, `<!doctype html>\n<title>Example Domain</title>\n`)
      return r.ok ? ok(`--2026-08-21 10:35:00--  ${url}\n已保存为 '${name}'`) : fail(r.err!)
    }

    this.commands.ssh = (args) => {
      const target = args.filter((a) => !a.startsWith('-')).join(' ')
      if (!target) return fail('usage: ssh [user@]host')
      const [user, host] = target.includes('@') ? target.split('@') : ['max', target]
      return ok(`欢迎来到 ${host}\n${user}@${host}:~$ `)
    }

    this.commands.scp = (args) => {
      const pos = args.filter((a) => !a.startsWith('-'))
      if (pos.length < 2) return fail('usage: scp SOURCE DEST')
      const src = pos[0]
      if (!vfs().exists(vfs().normalize(src))) return fail(`scp: ${src}: No such file or directory`)
      return ok(`${src}    100%  ${Math.round(Math.random() * 400 + 40)}B  0.0KB/s`)
    }

    this.commands.smbclient = (args) => {
      const flag = args.find((a) => /^-\w+$/.test(a))
      if (!flag) return fail('usage: smbclient -L //server/share')
      const share = args.find((a) => a.startsWith('//')) || '//server/share'
      return ok(['Sharename       Type      Comment', '---------       ----      -------',
        'IPC$            Disk      IPC Service', 'backup          Disk      备份目录'].join('\n'))
    }

    this.commands.wsl = (args) => {
      if (!args.length) {
        return ok([
          'WSL2 is installed.',
          '',
          '常用命令：',
          '  wsl --install --no-distribution    安装 WSL 本体',
          '  wsl -l -v                          列出已装发行版及 WSL 版本',
          '  wsl --set-default-version 2        把新装发行版默认设为 WSL2',
          '  wsl --shutdown                     关闭全部 WSL 实例',
        ].join('\n'))
      }
      if (args.includes('-l') || args.includes('--list')) {
        return ok(['  NAME      STATE           VERSION', '  Ubuntu    Running         2'].join('\n'))
      }
      if (args.includes('--shutdown')) return ok('操作已成功完成')
      return ok('（模拟输出）')
    }

    this.commands.apt = (args) => {
      if (!args.length) return ok('用法：apt list --installed | apt install <包名>')
      const sub = args[0]
      if (sub === 'install' || sub === 'remove' || sub === 'purge') {
        const pkg = args[1]
        if (!pkg) return fail(`apt: 缺少软件包名`)
        return sub === 'install'
          ? ok(`正在读取软件包列表... 完成\n正在设置 up ${pkg} (版本号) ...\n正在处理触发器 ...`)
          : ok(`正在卸载 ${pkg} ...\n正在处理触发器 ...`)
      }
      if (sub === 'list') return ok('正在读取软件包列表... 完成\nListing...')
      if (sub === 'update') return ok('命中:1 http://archive.ubuntu.com ubuntu jammy InRelease')
      return ok(`apt ${sub} ...`)
    }
  }

  /** 引擎实际实现了哪些命令，供终端如实告知读者 */
  supportedCommands(): string[] {
    return [
      ...['cd', 'exit', 'export', 'unset', 'type', 'history', 'help'],
      ...Object.keys(this.commands).sort(),
    ]
  }

  /** 给当前工作目录 */
  cwd(): string {
    return this.vfs.cwd
  }
}

export { VFS }
