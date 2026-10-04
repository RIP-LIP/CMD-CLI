/**
 * Windows 虚拟文件系统（ToyWin 用）。
 *
 * ⚠️ 零 DOM 依赖。
 *
 * 与 Linux VFS 的关键差异（**不要共用一套实现**）：
 *  - 路径用反斜杠，盘符 C:\ 参与寻址
 *  - 路径不区分大小写，Command Foo 与 command FOO 指向同一处
 *  - 没有 cwd 概念，命令作用于绝对路径或当前盘符相对路径
 *  - 目录不能被直接删除，必须先空
 */

export interface WinFile {
  type: 'file'
  content: string
  mtime: number
}

export interface WinDir {
  type: 'dir'
  children: Record<string, WinNode>
  mtime: number
}

export type WinNode = WinFile | WinDir

export interface WinResult {
  ok: boolean
  err?: string
  out?: string
}

const now = () => Date.now()

export class WinVFS {
  /** 每个盘符一棵独立的树 */
  drives: Record<string, WinDir>
  cwd = 'C:\\'
  user = 'MAX'
  computer = 'DESKTOP-DEVBOX'

  constructor(initial?: Record<string, WinDir>) {
    // ⚠️ 盘符键必须带冒号（'C:'），因为所有查找都用 `path.slice(0, 2)` 取盘符。
    //    旧写法 `C:` 会导致 getNode 永远取不到根，整棵树不可达。
    this.drives = initial ?? { 'C:': this.defaultTree() }
  }

  private defaultTree(): WinDir {
    const file = (content: string): WinFile => ({ type: 'file', content, mtime: now() })
    const dir = (children: Record<string, WinNode> = {}): WinDir => ({ type: 'dir', children, mtime: now() })

    return dir({
      Users: dir({
        MAX: dir({
          Desktop: dir({
            'readme.txt': file('Windows 命令行练习环境。\n这里是桌面。\n'),
            'notes.md': file('# 待办\n\n- 练 CMD 基础命令\n- 练 PowerShell 管道\n'),
          }),
          Documents: dir({
            'report.txt': file('季度报告草稿\n第二行\n第三行\n'),
            'data.csv': file('name,size,type\napp.exe,1024,application\nreadme.txt,128,text\n'),
            'config.ini': file('[settings]\nverbose=1\ntimeout=30\n'),
          }),
          Downloads: dir({
            'setup.exe': file('MZ\x90\x00\x03'),
            'notes.txt': file('下载的笔记。\n'),
          }),
        }),
      }),
      Windows: dir({
        System32: dir({
          'drivers': dir({ 'etc': file('127.0.0.1 localhost\n') }),
        }),
        Temp: dir(),
      }),
      ProgramData: dir(),
    })
  }

  /** 归一成 `C:\Users\MAX\Desktop` 形式，盘符大写，路径不区分大小写 */
  normalize(p: string): string {
    if (!p) return this.cwd
    let path = p.trim().replace(/\//g, '\\')

    // 无盘符 → 挂到当前盘符下
    if (!/^[A-Za-z]:/.test(path)) {
      path = path.startsWith('\\')
        ? this.cwd.charAt(0) + ':' + path
        : this.cwd.replace(/\\[^\\]*$/, '') + '\\' + path
    }

    path = path.charAt(0).toUpperCase() + ':' + path.slice(2)
    const drive = path.slice(0, 2).toUpperCase()
    const rest = path.slice(2)

    const parts: string[] = []
    for (const seg of rest.split('\\')) {
      if (!seg || seg === '.') continue
      if (seg === '..') {
        parts.pop()
        continue
      }
      parts.push(seg)
    }
    // 盘符根目录固定输出 `C:\`。
    // ⚠️ 不能写成 `.replace(/\\$/, drive + '\\')` —— 替换串里的 `$` 会被当作
    //    捕获组引用，尾部反斜杠会被吃掉，路径变成 `C:`，之后所有查找都失败。
    if (!parts.length) return `${drive}\\`
    return `${drive}\\${parts.join('\\')}`
  }

  /** Windows 路径比较忽略大小写 */
  private key(seg: string): string {
    return seg.toLowerCase()
  }

  private findChild(node: WinDir, name: string): { key: string; node: WinNode } | null {
    for (const k of Object.keys(node.children)) {
      if (this.key(k) === this.key(name)) return { key: k, node: node.children[k] }
    }
    return null
  }

  getNode(p: string): WinNode | null {
    const abs = this.normalize(p)
    const drive = abs.slice(0, 2)
    const root = this.drives[drive]
    if (!root) return null
    if (abs === `${drive}\\`) return root

    let cur: WinNode = root
    for (const seg of abs.slice(3).split('\\').filter(Boolean)) {
      if (cur.type !== 'dir') return null
      const found = this.findChild(cur, seg)
      if (!found) return null
      cur = found.node
    }
    return cur
  }

  exists(p: string): boolean {
    return this.getNode(p) !== null
  }

  isDir(p: string): boolean {
    return this.getNode(p)?.type === 'dir'
  }

  private parentOf(p: string): { parent: WinDir; name: string; path: string } | null {
    const abs = this.normalize(p)
    const idx = abs.lastIndexOf('\\')
    if (idx < 3) return null
    const parentPath = abs.slice(0, idx)
    const name = abs.slice(idx + 1)
    const node = this.getNode(parentPath)
    if (!node || node.type !== 'dir') return null
    return { parent: node, name, path: abs }
  }

  mkdir(p: string): WinResult {
    const abs = this.normalize(p)
    const drive = abs.slice(0, 2)
    if (!this.drives[drive]) this.drives[drive] = { type: 'dir', children: {}, mtime: now() }

    const parts = abs.slice(3).split('\\').filter(Boolean)
    let cur: WinDir = this.drives[drive]
    for (let i = 0; i < parts.length; i++) {
      const seg = parts[i]
      const found = this.findChild(cur, seg)
      const isLast = i === parts.length - 1

      if (!found) {
        const node: WinDir = { type: 'dir', children: {}, mtime: now() }
        cur.children[seg] = node
        cur = node
        continue
      }
      if (found.node.type !== 'dir') {
        return { ok: false, err: '系统找不到指定的路径。' }
      }
      if (isLast) {
        return { ok: false, err: '系统找不到指定的路径。' }
      }
      cur = found.node
    }
    return { ok: true }
  }

  write(p: string, content: string, append = false): WinResult {
    const loc = this.parentOf(p)
    if (!loc) return { ok: false, err: '系统找不到指定的路径。' }
    const found = this.findChild(loc.parent, loc.name)
    if (found?.node.type === 'dir') {
      return { ok: false, err: '拒绝访问。' }
    }
    const content2 = append && found?.node.type === 'file' ? found.node.content + content : content
    loc.parent.children[found?.key ?? loc.name] = { type: 'file', content: content2, mtime: now() }
    return { ok: true }
  }

  read(p: string): { ok: boolean; err?: string; content?: string } {
    const node = this.getNode(p)
    if (!node) return { ok: false, err: '系统找不到指定的文件。' }
    if (node.type === 'dir') return { ok: false, err: '拒绝访问。' }
    return { ok: true, content: node.content }
  }

  /**
   * 删除。Windows 里 rd 不带 /s 删非空目录会失败 ——
   * 这正是必须让学习者撞一次的差别。
   */
  rm(p: string, opts: { recursive?: boolean; force?: boolean } = {}): WinResult {
    const abs = this.normalize(p)
    const loc = this.parentOf(abs)
    if (!loc) {
      return opts.force ? { ok: true } : { ok: false, err: '系统找不到指定的文件。' }
    }
    const found = this.findChild(loc.parent, loc.name)
    if (!found) {
      return opts.force ? { ok: true } : { ok: false, err: '系统找不到指定的文件。' }
    }
    if (found.node.type === 'dir' && Object.keys(found.node.children).length > 0 && !opts.recursive) {
      return { ok: false, err: '目录不是空的。' }
    }
    delete loc.parent.children[found.key]
    return { ok: true }
  }

  cp(from: string, to: string): WinResult {
    const src = this.getNode(from)
    if (!src) return { ok: false, err: '系统找不到指定的文件。' }

    let finalPath = this.normalize(to)
    if (this.isDir(to)) {
      const base = this.normalize(from).split('\\').filter(Boolean).pop() || ''
      finalPath = finalPath.replace(/\\$/, '') + '\\' + base
    }

    const clone = (n: WinNode): WinNode =>
      n.type === 'file'
        ? { type: 'file', content: n.content, mtime: n.mtime }
        : { type: 'dir', children: Object.fromEntries(Object.entries(n.children).map(([k, v]) => [k, clone(v)])), mtime: n.mtime }

    const dstLoc = this.parentOf(finalPath)
    if (!dstLoc) return { ok: false, err: '系统找不到指定的路径。' }
    const existing = this.findChild(dstLoc.parent, dstLoc.name)
    dstLoc.parent.children[existing?.key ?? dstLoc.name] = clone(src)
    return { ok: true }
  }

  mv(from: string, to: string): WinResult {
    const src = this.getNode(from)
    if (!src) return { ok: false, err: '系统找不到指定的文件。' }

    let finalPath = this.normalize(to)
    if (this.isDir(to)) {
      const base = this.normalize(from).split('\\').filter(Boolean).pop() || ''
      finalPath = finalPath.replace(/\\$/, '') + '\\' + base
    }
    const dstLoc = this.parentOf(finalPath)
    if (!dstLoc) return { ok: false, err: '系统找不到指定的路径。' }
    const existing = this.findChild(dstLoc.parent, dstLoc.name)

    dstLoc.parent.children[existing?.key ?? dstLoc.name] = src
    const srcLoc = this.parentOf(from)
    if (srcLoc) {
      const s = this.findChild(srcLoc.parent, srcLoc.name)
      if (s) delete srcLoc.parent.children[s.key]
    }
    return { ok: true }
  }

  list(p: string): { ok: boolean; err?: string; nodes: { name: string; node: WinNode }[] } {
    const node = this.getNode(p)
    if (!node) return { ok: false, err: '系统找不到指定的路径。', nodes: [] }
    if (node.type === 'file') {
      return { ok: true, nodes: [{ name: this.normalize(p).split('\\').filter(Boolean).pop() || '', node }] }
    }
    const nodes = Object.keys(node.children)
      .sort()
      .map((name) => ({ name, node: node.children[name] }))
    return { ok: true, nodes }
  }

  walk(root = 'C:\\'): { path: string; node: WinNode }[] {
    const out: { path: string; node: WinNode }[] = []
    const start = this.normalize(root)
    const rec = (node: WinNode, prefix: string) => {
      out.push({ path: prefix, node })
      if (node.type !== 'dir') return
      for (const [name, child] of Object.entries(node.children)) {
        rec(child, `${prefix.replace(/\\$/, '')}\\${name}`)
      }
    }
    const node = this.getNode(start)
    if (node) rec(node, start)
    return out
  }

  serialize(): Record<string, WinDir> {
    return JSON.parse(JSON.stringify(this.drives))
  }

  restore(snapshot: Record<string, WinDir>): void {
    this.drives = JSON.parse(JSON.stringify(snapshot))
  }

  /** cmd / 切换当前目录 */
  cd(p: string): WinResult {
    if (!p || p === '.') return { ok: true }
    const abs = this.normalize(p)
    if (!this.exists(abs)) return { ok: false, err: '系统找不到指定的路径。' }
    if (!this.isDir(abs)) return { ok: false, err: '系统找不到指定的路径。' }
    this.cwd = abs.endsWith('\\') ? abs : abs + '\\'
    return { ok: true }
  }
}
