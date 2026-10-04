/**
 * ToyWin —— Windows 命令行模拟引擎。
 *
 * ⚠️ 零 DOM 依赖。
 *
 * 移植自旧站 toywin.js，逐条核对行为：
 *  - 路径与文件名比较忽略大小写（Windows 真实行为）
 *  - rd / rmdir 删非空目录会失败，除非 /s
 *  - del 只能删文件，删目录会失败
 *  - cd 到不存在的目录返回「系统找不到指定的路径。」
 *  - 已移除旧站 `undo` 命令的对外暴露，撤销统一走 Shell.undo()
 */

import { WinVFS, type WinNode } from './vfs-windows'

export interface WinExecResult {
  stdout: string
  stderr: string
  exit: number
  clear?: boolean
  exitShell?: boolean
}

export interface WinTaskCheckCtx {
  cwd: string
}

export interface WinTaskDef {
  id: string
  label: string
  /** 同时接受 CMD 与 PowerShell 两种写法 */
  check: (line: string, result: WinExecResult, ctx: WinTaskCheckCtx) => boolean
}

type CmdFn = (args: string[], raw: string) => WinExecResult

const ok = (stdout = ''): WinExecResult => ({ stdout, stderr: '', exit: 0 })
const fail = (stderr: string, exit = 1): WinExecResult => ({ stdout: '', stderr, exit })

/**
 * 从 PowerShell 风格参数里取路径。
 *
 * `new-item -itemtype directory -path C:\x` 里路径跟在 `-path` 后面，
 * 直接取第一个非选项参数会拿到 `-itemtype` 当路径 —— 这是 PowerShell
 * 新手最常踩的解析坑，模拟器必须按真规则取，否则练出来的习惯是错的。
 */
function flagValue(args: string[], ...names: string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    for (const n of names) {
      if (a.toLowerCase() === n) return args[i + 1]
      if (a.toLowerCase().startsWith(n + ':')) return a.slice(n.length + 1)
      if (a.toLowerCase().startsWith(n + '=')) return a.slice(n.length + 1)
    }
  }
  return undefined
}

function fmtSize(n: number): string {
  if (n < 1024) return String(n)
  if (n < 1024 * 1024) return `${Math.round(n / 1024)}K`
  return `${(n / 1024 / 1024).toFixed(1)}M`
}

function fmtDate(ms: number): string {
  const d = new Date(ms)
  const two = (x: number) => String(x).padStart(2, '0')
  return `${two(d.getMonth() + 1)}/${two(d.getDate())}/${d.getFullYear()}  ${two(d.getHours())}:${two(d.getMinutes())}`
}

export class WinShell {
  vfs: WinVFS
  env: Record<string, string> = {}
  history: string[] = []
  lastExit = 0
  undoStack: { kind: string; payload: unknown }[] = []
  private commands: Record<string, CmdFn> = {}

  constructor(vfs?: WinVFS) {
    this.vfs = vfs ?? new WinVFS()
    this.env = {
      SystemRoot: 'C:\\Windows',
      USERPROFILE: 'C:\\Users\\MAX',
      COMPUTERNAME: this.vfs.computer,
      ComSpec: 'C:\\Windows\\System32\\cmd.exe',
      Path: 'C:\\Windows\\System32;C:\\Windows;C:\\Windows\\System32\\Wbem',
    }
    this.register()
  }

  /** CMD 分词：引号包裹，整串作为一个参数 */
  parse(line: string): string[] {
    const tokens: string[] = []
    let cur = ''
    let quote = false
    let started = false
    for (let i = 0; i < line.length; i++) {
      const c = line[i]
      if (c === '"') {
        quote = !quote
        started = true
        continue
      }
      if (/\s/.test(c) && !quote) {
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

  exec(line: string): WinExecResult {
    const tokens = this.parse(line)
    if (!tokens.length) return ok()
    const [cmdRaw, ...args] = tokens
    this.history.push(line)
    const cmd = cmdRaw.toLowerCase()

    if (cmd === 'exit') return { ...ok(), exitShell: true }
    if (cmd === 'cls' || cmd === 'clear') return { ...ok(), clear: true }
    if (cmd === 'powershell' || cmd === 'pwsh') return this.cmdPowershell()

    // 管道：`a | b` 把 a 的输出按行喂给 b。
    // 04-powershell-intro 的核心教学点就是对象管道，模拟器必须真的能跑。
    if (tokens.includes('|')) {
      return this.execPipeline(line, tokens)
    }

    const fn = this.commands[cmd]
    if (!fn) {
      // CMD 对未知命令返回 9009，不是 1 —— 脚本靠这个码判断「命令是否存在」
      const r = fail(`'${cmdRaw}' 不是内部或外部命令，也不是可运行的程序。`, 9009)
      this.lastExit = 9009
      return r
    }
    const r = fn(args, line)
    this.lastExit = r.exit
    return r
  }

  /**
   * 极简管道：左边输出按行变成右边的参数。
   * 真实 PowerShell 传的是对象，这里传字符串 —— 够教学用，但不假装是同一回事。
   */
  private execPipeline(line: string, tokens: string[]): WinExecResult {
    const segs: string[][] = []
    let cur: string[] = []
    for (const t of tokens) {
      if (t === '|') { segs.push(cur); cur = [] }
      else cur.push(t)
    }
    segs.push(cur)

    let carried: string[] = []
    let last = ok('')
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i]
      if (!seg.length) continue
      const isLast = i === segs.length - 1
      // 左边带上管道的输出；右边不传（由 carried 提供）
      const segLine = seg.join(' ')
      const r = isLast && carried.length
        ? this.runWithInput(seg[0], seg.slice(1), segLine, carried)
        : this.exec(segLine)
      if (r.exit !== 0 && r.stderr) return r
      last = r
      carried = r.stdout.split('\r\n').map(s => s.trim()).filter(Boolean)
    }
    return last
  }

  /** 把上游输出作为额外参数喂给某个命令 */
  private runWithInput(cmdRaw: string, args: string[], raw: string, input: string[]): WinExecResult {
    const cmd = cmdRaw.toLowerCase()
    const fn = this.commands[cmd]
    if (!fn) return fail(`'${cmdRaw}' 不是内部或外部命令，也不是可运行的程序。`, 9009)
    // 只把管道里还没被显式参数覆盖的部分接上去
    const merged = args.length ? args : input.slice(0, 20)
    const r = fn(merged, raw)
    this.lastExit = r.exit
    return r
  }

  private register() {
    const vfs = () => this.vfs

    // ── 目录 ────────────────────────────────────────────────
    this.commands.cd = (args) => {
      const r = vfs().cd(args[0] || '')
      return r.ok ? ok(vfs().cwd) : fail(r.err!)
    }
    this.commands.chdir = this.commands.cd
    this.commands.mkdir = (args) => {
      const targets = args.filter((a) => !a.startsWith('/') && !a.startsWith('-'))
      if (!targets.length) return fail('文件名、目录名或卷标语法不正确。')
      for (const t of targets) {
        const r = vfs().mkdir(t)
        if (!r.ok) return fail(r.err!)
      }
      return ok()
    }
    this.commands.md = this.commands.mkdir
    this.commands.rmdir = (args) => {
      const recursive = args.some((a) => /^\/s$/i.test(a))
      const quiet = args.some((a) => /^\/q$/i.test(a))
      const targets = args.filter((a) => !a.startsWith('/'))
      if (!targets.length) return fail('缺少路径。')
      for (const t of targets) {
        if (!vfs().isDir(t)) return fail('系统找不到指定的文件。')
        const r = vfs().rm(t, { recursive, force: quiet })
        if (!r.ok) return fail(r.err!)
      }
      return ok()
    }
    this.commands.rd = this.commands.rmdir

    // ── 文件 ────────────────────────────────────────────────
    this.commands.dir = (args) => {
      const target = vfs().normalize(args.find((a) => !a.startsWith('/')) || '.')
      const r = vfs().list(target)
      if (!r.ok) return fail(r.err!)

      let files = 0
      let dirs = 0
      let bytes = 0
      const rows = r.nodes.map(({ name, node }) => {
        const d = fmtDate(node.mtime)
        if (node.type === 'dir') {
          dirs++
          return `${d}    <DIR>          ${name}`
        }
        files++
        bytes += node.content.length
        return `${d}    ${String(node.content.length).padStart(13)} ${name}`
      })

      let out = ` 驱动器 C 中的卷没有标签\n 卷序列号是 8E4A-1C2B\n\n 目录 C:\\Users\\MAX\n\n`
      out += rows.join('\n')
      out += `\n${String(files).padStart(15)} 个文件             ${String(bytes).padStart(14)} 字节\n`
      out += `${String(dirs).padStart(15)} 个目录\n`
      out += `${String(vfs().walk(target).length).padStart(16)} 个文件\n`
      return ok(out)
    }
    this.commands.ls = this.commands.dir

    this.commands.type = (args) => {
      const t = args.filter((a) => !a.startsWith('/'))
      if (!t.length) return fail('')
      const r = vfs().read(t[0])
      return r.ok ? ok(r.content!) : fail(r.err!)
    }
    this.commands.cat = this.commands.type
    this.commands.more = this.commands.type

    this.commands.echo = (args, raw) => {
      // echo 自身的参数后面若跟 > / >> 就是重定向
      const m = raw.match(/^echo\s+(.*?)(?:\s*(>>|>)\s*(\S+))?\s*$/i)
      if (!m) return ok('')
      const text = m[1] ?? ''
      const op = m[2]
      const dest = m[3]
      if (dest) {
        const r = vfs().write(dest, text, op === '>>')
        return r.ok ? ok('') : fail(r.err!)
      }
      return ok(text)
    }

    this.commands.copy = (args) => {
      const t = args.filter((a) => !a.startsWith('/'))
      if (t.length < 2) return fail('缺少文件操作数。')
      const r = vfs().cp(t[0], t[t.length - 1])
      return r.ok ? ok('        1 个文件已复制。') : fail(r.err!)
    }

    this.commands.move = (args) => {
      const t = args.filter((a) => !a.startsWith('/'))
      if (t.length < 2) return fail('缺少文件操作数。')
      const r = vfs().mv(t[0], t[t.length - 1])
      return r.ok ? ok('        1 个文件已移动。') : fail(r.err!)
    }
    this.commands.ren = (args) => {
      const t = args.filter((a) => !a.startsWith('/'))
      if (t.length < 2) return fail('缺少文件操作数。')
      // ren 只改同一目录里的文件名，第二个参数是**新名字**，不是目标路径。
      // 直接交给 mv 处理相对路径会挪到当前工作目录去，那是错的。
      const src = vfs().normalize(t[0])
      const newName = t[1].split('\\').filter(Boolean).pop() || t[1]
      const dir = src.slice(0, src.lastIndexOf('\\') + 1)
      const r = vfs().mv(src, dir + newName)
      return r.ok ? ok('') : fail(r.err!)
    }
    this.commands.rename = this.commands.ren

    this.commands.del = (args) => {
      const targets = args.filter((a) => !a.startsWith('/'))
      if (!targets.length) return fail('缺少文件名。')
      for (const t of targets) {
        const node = vfs().getNode(t)
        if (!node) return fail('找不到 ' + vfs().normalize(t))
        // del 只能删文件。给目录时 Windows 报「拒绝访问」，
        // 这是它和 rm -r 最容易被误解的差别：删目录必须用 rd /s。
        if (node.type === 'dir') return fail('拒绝访问。')
        const r = vfs().rm(t)
        if (!r.ok) return fail(r.err!)
      }
      return ok('')
    }
    this.commands.erase = this.commands.del

    this.commands.newfile = (args) => {
      const name = args.filter((a) => !a.startsWith('/'))[0]
      if (!name) return fail('缺少文件名。')
      const r = vfs().write(name, '')
      return r.ok ? ok('') : fail(r.err!)
    }
    this.commands.setcontent = (args, raw) => {
      const m = raw.match(/^setcontent\s+(\S+)\s+(.*)$/i)
      if (!m) return fail('用法: setcontent <文件> <内容>')
      const r = vfs().write(m[1], m[2])
      return r.ok ? ok('') : fail(r.err!)
    }

    // ── 提示符与信息 ────────────────────────────────────────
    this.commands.prompt = (args, raw) => {
      const t = args.filter((a) => !a.startsWith('$'))
      if (!t.length) return ok('C:\\Users\\MAX>')
      return ok(t.join(' '))
    }
    this.commands.cd_ = this.commands.prompt

    this.commands.whoami = () => ok(`${vfs().computer}\\${vfs().user.toLowerCase()}`)

    this.commands.hostname = () => ok(vfs().computer)

    this.commands.ver = () => ok(
      '\nMicrosoft Windows [版本 10.0.22631.2861]\n' +
      '(c) Microsoft Corporation。保留所有权利。\n',
    )

    this.commands.systeminfo = () => ok(
      [
        '主机名:            DESKTOP-DEVBOX',
        'OS 名称:           Microsoft Windows 11 专业版',
        'OS 版本:           10.0.22631 N/A Build 22631',
        '系统制造商:        Microsoft Corporation',
        '系统类型:          x64-based PC',
        '处理器:            基于 x64 的 Intel64 Family 6 Model 158 Stepping 9, GenuineIntel',
        '逻辑处理器:        12',
        'BIOS 版本:         American Megatrends Inc. F20',
      ].join('\n'),
    )

    this.commands.date = () => ok('当前日期: 2026/08/21')
    this.commands.time = () => ok('当前时间: 10:38:42.16')

    this.commands.set = (args) => {
      if (!args.length) {
        return ok(Object.entries(this.env).map(([k, v]) => `${k}=${v}`).join('\n'))
      }
      for (const a of args) {
        const eq = a.indexOf('=')
        if (eq === -1) continue
        this.env[a.slice(0, eq)] = a.slice(eq + 1)
      }
      return ok('环境变量 "' + args[0].split('=')[0] + '" 定义（或值）已更改。')
    }

    this.commands.help = () => ok(
      [
        '主要命令：',
        '  cd / chdir     切换目录',
        '  dir / ls       列出目录内容',
        '  type / cat     输出文件内容',
        '  copy / xcopy   复制文件',
        '  move / ren     移动或重命名',
        '  del / erase    删除文件',
        '  md / mkdir     新建目录',
        '  rd / rmdir     删除目录（非空需加 /s）',
        '  echo           回显，> 与 >> 可重定向到文件',
        '  ipconfig       网络配置',
        '  ping           连通性测试',
        '  netstat        连接与端口',
        '  tasklist       进程列表',
        '  taskkill       结束进程',
        '  systeminfo     系统信息',
        '  powershell    切到 PowerShell（本模拟器内等效提示符）',
        '  cls            清屏',
      ].join('\n'),
    )

    // ── 网络 ────────────────────────────────────────────────
    this.commands.ipconfig = () => ok(
      [
        'Windows IP 配置',
        '',
        '以太网适配器 以太网:',
        '',
        '   连接特定的 DNS 后缀 . . . . . . : lan',
        '   IPv6 地址 . . . . . . . . . . : fe80::1c2b:3d4e:5f60:7a8b',
        '   IPv4 地址 . . . . . . . . . . : 192.168.1.50',
        '   子网掩码  . . . . . . . . . . : 255.255.255.0',
        '   默认网关. . . . . . . . . . . : 192.168.1.1',
        '',
        '隧道适配器 隧道:',
        '   连接特定的 DNS 后缀 . . . . . . :',
        '   IPv4 地址 . . . . . . . . . . : 127.0.0.1',
        '   子网掩码  . . . . . . . . . . : 255.0.0.0',
      ].join('\n'),
    )

    this.commands.ping = (args) => {
      const host = args.find((a) => !a.startsWith('-')) || args[0]
      if (!host) return fail('缺少主机名。')
      const countMatch = args.join(' ').match(/-n\s*(\d+)/)
      const count = countMatch ? parseInt(countMatch[1], 10) : 4
      const lines = [`正在 Ping ${host} [93.184.216.34] 具有 32 字节的数据:`]
      for (let i = 0; i < count; i++) {
        lines.push(`来自 93.184.216.34 的回复: 字节=32 时间=${13 + i * 2}ms TTL=57`)
      }
      lines.push('', `${host} 的 Ping 统计信息:`,
        `    数据包: 已发送 = ${count}，已接收 = ${count}，丢失 = 0 (0% 丢失)，`)
      return ok(lines.join('\n'))
    }

    this.commands.netstat = (args) => {
      const filter = args.find((a) => !a.startsWith('-'))?.toLowerCase()
      const rows = [
        '',
        '活动连接',
        '',
        '  Proto  本地地址          外部地址           状态',
        '  TCP    0.0.0.0:135        0.0.0.0:0          LISTENING',
        '  TCP    0.0.0.0:445        0.0.0.0:0          LISTENING',
        '  TCP    0.0.0.0:5040       0.0.0.0:0          LISTENING',
        '  TCP    192.168.1.50:52134  93.184.216.34:443   ESTABLISHED',
        '  TCP    127.0.0.1:49670     127.0.0.1:49671    ESTABLISHED',
      ]
      const out = filter ? rows.filter((r) => r.toLowerCase().includes(filter)) : rows
      return ok(out.join('\n'))
    }

    // ── 进程 ────────────────────────────────────────────────
    this.commands.tasklist = (args) => ok(
      [
        '映像名称                       PID 会话名              会话#       内存使用',
        '========================= ======== ================ =========== ============',
        'System Idle Process              0 Services              0              8 K',
        'System                           4 Services              0          112 K',
        'smss.exe                       312 Services              0        1,528 K',
        'csrss.exe                      404 Services              0        8,704 K',
        'winlogon.exe                   612 Services              0        4,032 K',
        'explorer.exe                  2841 Console              1       88,192 K',
        'pwsh.exe                      5120 Console              1       142,336 K',
        'node.exe                      6344 Console              1       198,656 K',
      ].join('\n'),
    )

    this.commands.taskkill = (args) => {
      const pid = args.find((a) => /^\d+$/.test(a))
      const byName = args.find((a) => a.toLowerCase().endsWith('.exe'))
      const force = args.some((a) => /^\/f$/i.test(a))
      if (!pid && !byName) return fail('ERROR: 无效参数/缺少参数。')
      const target = byName || `PID ${pid}`
      return ok(`成功: 已终止进程 "${target}"${force ? '（强制）' : ''}。`)
    }

    // PowerShell 桥。
    // ⚠️ 必须用箭头函数包一层：直接 `this.commands.x = this.cmdY` 会丢掉 this 绑定，
    //    命令被调用时 this 为 undefined，访问 this.vfs 立刻抛错。
    this.commands['get-childitem'] = (args) => this.cmdDir(args)
    this.commands['gci'] = (args) => this.cmdDir(args)
    this.commands['ls'] = (args) => this.cmdDir(args)
    this.commands['get-content'] = (args) => this.cmdType(args)
    this.commands['gc'] = (args) => this.cmdType(args)
    this.commands['cat'] = (args) => this.cmdType(args)
    this.commands['new-item'] = (args) => this.cmdNewItem(args)
    this.commands['ni'] = (args) => this.cmdNewItem(args)
    this.commands['remove-item'] = (args) => this.cmdRemoveItem(args)
    this.commands['rm'] = (args) => this.cmdRemoveItem(args)
    // ⚠️ 故意不覆盖 `del`。
    //    PowerShell 里 del 是 Remove-Item 的别名，但 CMD 里 del 是独立命令，
    //    只能删文件、给目录报「拒绝访问」。本模拟器双轨共存，覆盖掉会让
    //    CMD 用户练出错误习惯 —— PowerShell 侧请用 rm。
    this.commands['copy-item'] = (args) => this.commands.copy(args, '')
    this.commands.cp = (args) => this.commands.copy(args, '')
    this.commands['move-item'] = (args) => this.commands.move(args, '')
    this.commands.mv = (args) => this.commands.move(args, '')
    this.commands['get-location'] = () => ok(vfs().cwd)
    this.commands.gl = () => ok(vfs().cwd)
    // 速查表把 pwd 列为 PowerShell 别名，01-file-system 的演练也接受它
    this.commands.pwd = () => ok(vfs().cwd)

    // 查命令到底是什么 —— 04-powershell-intro 的核心工具，演练里要用。
    // ⚠️ 在 PowerShell 里 dir/ls/gci/cat/type/del/rd/md 全是别名，没有对应的 exe；
    //    拿「外部程序」当默认答案会把这一章的教学点讲反。
    const PS_ALIAS: Record<string, [string, string]> = {
      'dir': ['Get-ChildItem', 'Microsoft.PowerShell.Management'],
      'ls': ['Get-ChildItem', 'Microsoft.PowerShell.Management'],
      'gci': ['Get-ChildItem', 'Microsoft.PowerShell.Management'],
      'cat': ['Get-Content', 'Microsoft.PowerShell.Management'],
      'type': ['Get-Content', 'Microsoft.PowerShell.Management'],
      'gc': ['Get-Content', 'Microsoft.PowerShell.Management'],
      'pwd': ['Get-Location', 'Microsoft.PowerShell.Management'],
      'gl': ['Get-Location', 'Microsoft.PowerShell.Management'],
      'cd': ['Set-Location', 'Microsoft.PowerShell.Management'],
      'chdir': ['Set-Location', 'Microsoft.PowerShell.Management'],
      'sl': ['Set-Location', 'Microsoft.PowerShell.Management'],
      'ni': ['New-Item', 'Microsoft.PowerShell.Management'],
      'md': ['New-Item', 'Microsoft.PowerShell.Management'],
      'mkdir': ['New-Item', 'Microsoft.PowerShell.Management'],
      'ri': ['Remove-Item', 'Microsoft.PowerShell.Management'],
      'rm': ['Remove-Item', 'Microsoft.PowerShell.Management'],
      'del': ['Remove-Item', 'Microsoft.PowerShell.Management'],
      'erase': ['Remove-Item', 'Microsoft.PowerShell.Management'],
      'rd': ['Remove-Item', 'Microsoft.PowerShell.Management'],
      'rmdir': ['Remove-Item', 'Microsoft.PowerShell.Management'],
      'ren': ['Rename-Item', 'Microsoft.PowerShell.Management'],
      'cp': ['Copy-Item', 'Microsoft.PowerShell.Management'],
      'copy': ['Copy-Item', 'Microsoft.PowerShell.Management'],
      'mv': ['Move-Item', 'Microsoft.PowerShell.Management'],
      'move': ['Move-Item', 'Microsoft.PowerShell.Management'],
      'echo': ['Write-Output', 'Microsoft.PowerShell.Core'],
      'set': ['Set-Variable', 'Microsoft.PowerShell.Utility'],
      'cls': ['Clear-Host', 'Microsoft.PowerShell.Core'],
      'where': ['Where-Object', 'Microsoft.PowerShell.Core'],
      'sort': ['Sort-Object', 'Microsoft.PowerShell.Core'],
      'gps': ['Get-Process', 'Microsoft.PowerShell.Management'],
      'tasklist': ['Get-Process', 'Microsoft.PowerShell.Management'],
    }
    const PS_CMDLETS: Record<string, [string, string]> = {
      'get-childitem': ['Get-ChildItem', 'Microsoft.PowerShell.Management'],
      'get-content': ['Get-Content', 'Microsoft.PowerShell.Management'],
      'get-location': ['Get-Location', 'Microsoft.PowerShell.Management'],
      'set-location': ['Set-Location', 'Microsoft.PowerShell.Management'],
      'new-item': ['New-Item', 'Microsoft.PowerShell.Management'],
      'remove-item': ['Remove-Item', 'Microsoft.PowerShell.Management'],
      'copy-item': ['Copy-Item', 'Microsoft.PowerShell.Management'],
      'move-item': ['Move-Item', 'Microsoft.PowerShell.Management'],
      'rename-item': ['Rename-Item', 'Microsoft.PowerShell.Management'],
      'get-process': ['Get-Process', 'Microsoft.PowerShell.Management'],
      'get-command': ['Get-Command', 'Microsoft.PowerShell.Utility'],
      'get-help': ['Get-Help', 'Microsoft.PowerShell.Core'],
      'select-string': ['Select-String', 'Microsoft.PowerShell.Utility'],
      'test-netconnection': ['Test-NetConnection', 'Microsoft.PowerShell.NetworkAdapter'],
      'test-path': ['Test-Path', 'Microsoft.PowerShell.Management'],
    }
    /** 解析成 [名称, 模块]，解析不到返回 null */
    const resolveCommand = (name: string): [string, string] | null => {
      const n = name.toLowerCase()
      return PS_ALIAS[n] ?? PS_CMDLETS[n] ?? null
    }
    this.commands['get-command'] = (args) => {
      const n = args.find((a) => !a.startsWith('-'))
      if (!n) return fail('缺少参数。')
      const r = resolveCommand(n)
      if (r) return ok(`${r[0].padEnd(20)}${r[1]}`)
      return fail(`Get-Command : 无法将“${n}”项识别为 cmdlet、函数、脚本或可运行程序的名称。`)
    }
    this.commands.gcm = (args) => this.commands['get-command'](args)
    this.commands.where = (args) => {
      const n = args.find((a) => !a.startsWith('/'))
      if (!n) return fail('缺少参数。')
      // 真实 where 只列**外部可执行程序**。别名不是程序，所以这里查不到 ——
      // 这个差别正是本章要让读者亲眼看到的。
      if (resolveCommand(n)) {
        return ok([
          `信息: 用提供的模式未找到文件。`,
          '',
          `「${n}」在 PowerShell 里是别名，where 只列 exe，`,
          `所以要查别名指向哪个 cmdlet 请用 Get-Command ${n}。`,
        ].join('\n'))
      }
      return ok(`C:\\Windows\\System32\\${n}.exe`)
    }
    this.commands['get-help'] = (args) => {
      const n = args.find((a) => !a.startsWith('-'))
      if (!n) return fail('缺少参数。')
      const r = resolveCommand(n)
      if (!r) return fail(`Get-Help : 找不到 “${n}” 的帮助。`)
      return ok([
        `主题: ${r[0]}`,
        '',
        '概要',
        `    ${r[0]}`,
        '',
        '说明',
        '    这是教学模拟器里的实现，只覆盖常用子集。',
        '    完整参数请在本机运行 Get-Help <命令> -Detailed 查看。',
      ].join('\n'))
    }
    this.commands['select-string'] = (args) => {
      // 管道下游用：把输入行里含关键词的挑出来
      const pat = args.find((a) => !a.startsWith('-')) || ''
      if (!pat) return fail('缺少 Pattern 参数。')
      const lines = args.length > 1 ? [args[args.length - 1]] : []
      return ok(lines.filter((l) => l.toLowerCase().includes(pat.toLowerCase())).join('\n'))
    }
    this.commands['foreach-object'] = (args) => ok('')
    this.commands['where-object'] = (args) => ok('')
    this.commands['sort-object'] = (args) => ok('')
    this.commands['select-object'] = (args) => ok('')

    // 批处理控制流（03-batch-script 的演练要敲这些）
    this.commands.if = (args, raw) => {
      const cond = args[0] || ''
      if (/^("[^"]*"|\S+)\s*==\s*("[^"]*"|\S+)$/.test(cond)) {
        const [, l, r] = cond.match(/^("[^"]*"|\S+)\s*==\s*("[^"]*"|\S+)$/)!
        return l.replace(/"/g, '') === r.replace(/"/g, '')
          ? ok(args.slice(1).join(' '))
          : ok('')
      }
      return ok(args.slice(1).join(' '))
    }
    this.commands.goto = (args) => ok('')
    this.commands.for = (args, raw) => {
      // 只回显 do 后面的部分，够看清循环体在干什么
      const m = raw.match(/\bdo\b(.*)$/i)
      return ok(m ? m[1].trim() : '')
    }
    this.commands.call = (args) => {
      const t = args.find((a) => !a.startsWith(':')) || ''
      return ok(`已调用 ${t.split('\\').filter(Boolean).pop() || t}（模拟器不执行批处理文件内容）`)
    }

    this.commands['set-location'] = (args) => this.commands.cd(args)
    this.commands.sl = (args) => this.commands.cd(args)
    this.commands['test-path'] = (args) => {
      const t = args[0]
      if (!t) return fail('缺少参数。')
      return ok(vfs().exists(t) ? 'True' : 'False')
    }
    this.commands['get-process'] = () => ok(
      ['ProcessName            Id    CPU  WorkingSet',
        '-----------            --    ---  -----------',
        'pwsh                  5120  0.42  145,920 KB',
        'node                  6344  3.18  203,776 KB',
        'explorer              2841  0.66   90,368 KB'].join('\n'),
    )
    this.commands.gps = () => this.commands['get-process']()
    this.commands['test-netconnection'] = (args) => {
      const host = args.find((a) => !a.startsWith('-'))
      const port = args.join(' ').match(/-Port\s+(\d+)/)
      if (!host) return fail('缺少 ComputerName。')
      return ok(
        `ComputerName     : ${host}\n` +
        `RemotePort       : ${port ? port[1] : '80'}\n` +
        'TcpTestSucceeded : True',
      )
    }
    this.commands.tnc = (args) => this.commands['test-netconnection'](args)
  }

  /** CMD 的 dir 保留详细输出；PowerShell 的 Get-ChildItem / ls 只出名字 */
  private cmdType(args: string[]): WinExecResult {
    return this.commands.type(args, '')
  }

  // PowerShell 风格的 Get-ChildItem：只输出名字，与 CMD 的 dir 版区分开
  private cmdDir(args: string[]): WinExecResult {
    const target = this.vfs.normalize(args.find((a) => !a.startsWith('-')) || '.')
    const r = this.vfs.list(target)
    if (!r.ok) return fail(r.err!)
    return ok(r.nodes.map(({ name, node }) => (node.type === 'dir' ? `${name}/` : name)).join('\n'))
  }

  private cmdNewItem(args: string[]): WinExecResult {
    // 路径从 -Path 取，没有再退回第一个非选项参数
    const name = flagValue(args, '-path', '-literalpath', '-name')
      ?? args.find((a) => !a.startsWith('-'))
    if (!name) return fail('缺少 -Path 参数')
    const typeRaw = flagValue(args, '-itemtype', '-type')
    const isDir = !!typeRaw && /^(directory|dir|container)$/i.test(typeRaw)
    const r = isDir ? this.vfs.mkdir(name) : this.vfs.write(name, '')
    return r.ok ? ok('') : fail(r.err!)
  }

  private cmdRemoveItem(args: string[]): WinExecResult {
    const recursive = args.some((a) => /^-recurse$/i.test(a))
    const force = args.some((a) => /^-force$/i.test(a))
    const targets = args.filter((a) => !a.startsWith('-'))
    if (!targets.length) return fail('缺少参数。')
    for (const t of targets) {
      const r = this.vfs.rm(t, { recursive, force })
      if (!r.ok) return fail(r.err!)
    }
    return ok('')
  }

  private cmdPowershell(): WinExecResult {
    return ok('Windows PowerShell\n版权所有 (C) Microsoft Corporation。保留所有权利。\n\n尝试新的跨平台 PowerShell https://aka.ms/pscore6\n')
  }

  /** 撤销：按记录回放反向操作 */
  undo(): WinExecResult {
    const inv = this.undoStack.pop()
    if (!inv) return fail('没有可撤销的操作')
    if (inv.kind === 'mkdir') {
      const r = this.vfs.rm(inv.payload as string, { recursive: true })
      return r.ok ? ok(`已撤销：删除目录 ${inv.payload}`) : fail(r.err!)
    }
    if (inv.kind === 'write') {
      const { path, content, existed } = inv.payload as { path: string; content: string; existed: boolean }
      if (existed) {
        this.vfs.write(path, content)
        return ok(`已撤销：恢复 ${path} 的原内容`)
      }
      const r = this.vfs.rm(path)
      return r.ok ? ok(`已撤销：删除 ${path}`) : fail(r.err!)
    }
    return fail('没有可撤销的操作')
  }

  pushUndo(entry: { kind: string; payload: unknown }): void {
    this.undoStack.push(entry)
    if (this.undoStack.length > 50) this.undoStack.shift()
  }

  undoCount(): number {
    return this.undoStack.length
  }

  /** 引擎实际实现了哪些命令，供终端如实告知读者 */
  supportedCommands(): string[] {
    return [
      'exit', 'cls', 'clear', 'powershell', 'pwsh',
      ...Object.keys(this.commands).sort(),
    ]
  }

  walk(): { path: string; node: WinNode }[] {
    return this.vfs.walk(this.vfs.cwd)
  }
}

export { WinVFS }
