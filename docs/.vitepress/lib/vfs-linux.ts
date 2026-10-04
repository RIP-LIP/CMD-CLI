/**
 * Linux 虚拟文件系统（ToyShell 用）。
 *
 * ⚠️ 本文件及 lib/ 下所有引擎文件**禁止触碰 window / document / localStorage**。
 *    这是 VitePress SSR 能构建通过的前提。
 */

export interface AclEntry {
  /** 命名条目，如 'user' | 'group' | 'mask' */
  type: 'user' | 'group' | 'mask'
  /** 条目名，user::/group::/other:: 这类基础条目为 '' */
  name: string
  perms: string
}

export interface FileNode {
  type: 'file'
  content: string
  mode: number
  mtime: number
  /** 扩展 ACL 条目；没有 ACL 时为空数组 */
  acl?: AclEntry[]
  owner?: string
  group?: string
}

export interface DirNode {
  type: 'dir'
  children: Record<string, VNode>
  mode: number
  mtime: number
  acl?: AclEntry[]
  owner?: string
  group?: string
}

export type VNode = FileNode | DirNode

export interface VfsResult {
  ok: boolean
  err?: string
  out?: string
}

const now = () => Date.now()

export function formatMode(mode: number): string {
  const bits = (mode & 0o777).toString(8).padStart(3, '0')
  return bits
    .split('')
    .map((d) => {
      const v = parseInt(d, 10)
      return (v & 4 ? 'r' : '-') + (v & 2 ? 'w' : '-') + (v & 1 ? 'x' : '-')
    })
    .join('')
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}M`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)}G`
}

/**
 * 把 755 / 644 这类八进制串解析成 mode。
 * 返回 null 表示无法识别，调用方负责报错 —— 不静默返回 0，
 * 因为「给了个看不懂的权限串却当成 000」比报错危险得多。
 */
export function parseMode(str: string): number | null {
  if (/^[0-7]{3,4}$/.test(str)) return parseInt(str, 8)
  if (str === 'rwx------') return 0o700
  if (str === 'rw-r--r--') return 0o644
  if (str === 'rwxr-xr-x') return 0o755
  if (str === 'rw-------') return 0o600
  if (str === 'rwxrwxrwx') return 0o777
  return null
}

export class VFS {
  cwd = '/home/max'
  home = '/home/max'
  user = 'max'
  tree: DirNode

  constructor(initial?: DirNode) {
    if (initial) {
      this.tree = initial
      return
    }
    const file = (content: string, mode = 0o644): FileNode => ({ type: 'file', content, mode, mtime: now() })
    const dir = (children: Record<string, VNode> = {}, mode = 0o755): DirNode => ({ type: 'dir', children, mode, mtime: now() })

    this.tree = dir({
      home: dir({
        max: dir({
          projects: dir({
            'notes.txt': file('这是我的笔记文件。\n第二行内容。\n'),
            'app.py': file('print("hello")\n'),
          }),
          'readme.md': file('# 我的项目\n\n这是一个练习用的虚拟目录。\n'),
          'notes.txt': file('家目录里的笔记。\n'),
        }, 0o750),
      }, 0o755),
      etc: dir({
        passwd: file('root:x:0:0:root:/root:/bin/bash\nmax:x:1000:1000:Max:/home/max:/bin/bash\n'),
        hostname: file('devbox\n'),
        hosts: file('127.0.0.1 localhost\n127.0.1.1 devbox\n'),
        'os-release': file('NAME="Ubuntu"\nVERSION="22.04.4 LTS (Jammy Jellyfish)"\nPRETTY_NAME="Ubuntu 22.04.4 LTS"\nID=ubuntu\n'),
        'nginx.conf': file('server {\n    listen 80;\n    server_name localhost;\n    root /var/www/html;\n}\n'),
      }),
      var: dir({
        log: dir({
          'syslog': file('Aug 21 10:00:01 devbox systemd[1]: Started Session.\n'),
          'auth.log': file('Aug 21 06:30:14 devbox sshd[1234]: Accepted publickey for max.\n'),
          'app.log': file('2026-08-21 10:00 INFO  启动完成，监听 :8080\n2026-08-21 10:05 WARN  磁盘使用率 91%\n'),
        }),
        www: dir({
          html: dir({
            'index.html': file('<h1>It works!</h1>\n'),
          }),
        }),
      }),
      tmp: dir(),
      usr: dir({
        bin: dir(),
        local: dir({ bin: dir() }),
      }),
      bin: dir({
        bash: file('', 0o755),
        ls: file('', 0o755),
      }),
      proc: dir({
        uptime: file('3471.42 6718.03\n'),
        meminfo: file('MemTotal:       16225584 kB\nMemFree:         2105536 kB\nMemAvailable:   10234752 kB\n'),
        cpuinfo: file('model name\t: Intel(R) Core(TM) i5-10400 CPU @ 2.90GHz\n'),
      }),
    })
  }

  /** 路径归一：展开 ~、消解 . 与 ..、压掉重复斜杠 */
  normalize(p: string): string {
    let path = p.startsWith('~') ? this.home + p.slice(1) : p
    if (!path.startsWith('/')) path = this.cwd + '/' + path
    const parts: string[] = []
    for (const seg of path.split('/')) {
      if (!seg || seg === '.') continue
      if (seg === '..') {
        if (parts.length) parts.pop()
        continue
      }
      parts.push(seg)
    }
    return '/' + parts.join('/')
  }

  getNode(p: string): VNode | null {
    const abs = this.normalize(p)
    if (abs === '/') return this.tree
    let cur: VNode = this.tree
    for (const seg of abs.split('/').filter(Boolean)) {
      if (cur.type !== 'dir') return null
      const next = cur.children[seg]
      if (!next) return null
      cur = next
    }
    return cur
  }

  /** 找最近的存在祖先，用于「父目录不存在」的错误提示 */
  parentOf(p: string): { parent: DirNode; name: string; path: string } | null {
    const abs = this.normalize(p)
    const idx = abs.lastIndexOf('/')
    const parentPath = idx <= 0 ? '/' : abs.slice(0, idx)
    const name = abs.slice(idx + 1)
    const node = this.getNode(parentPath)
    if (!node || node.type !== 'dir') return null
    return { parent: node, name, path: abs }
  }

  exists(p: string): boolean {
    return this.getNode(p) !== null
  }

  isDir(p: string): boolean {
    return this.getNode(p)?.type === 'dir'
  }

  mkdir(p: string, mode = 0o755, recursive = false): VfsResult {
    const abs = this.normalize(p)
    if (abs === '/') return { ok: true }
    const parts = abs.split('/').filter(Boolean)

    let cur: DirNode = this.tree
    let walked = ''
    for (let i = 0; i < parts.length; i++) {
      const seg = parts[i]
      walked += '/' + seg
      const existing = cur.children[seg]
      const isLast = i === parts.length - 1

      if (!existing) {
        if (!recursive && i < parts.length - 1) {
          return { ok: false, err: `mkdir: cannot create directory '${walked}': No such file or directory` }
        }
        const node: DirNode = { type: 'dir', children: {}, mode, mtime: now() }
        cur.children[seg] = node
        cur = node
        continue
      }
      if (existing.type !== 'dir') {
        return { ok: false, err: `mkdir: cannot create directory '${walked}': File exists` }
      }
      if (isLast && !recursive) {
        return { ok: false, err: `mkdir: cannot create directory '${walked}': File exists` }
      }
      cur = existing
    }
    cur.mtime = now()
    return { ok: true }
  }

  write(p: string, content: string, mode = 0o644): VfsResult {
    const loc = this.parentOf(p)
    if (!loc) return { ok: false, err: `write: no such directory for '${p}'` }
    if (loc.name === '') return { ok: false, err: `write: invalid path '${p}'` }
    const existing = loc.parent.children[loc.name]
    if (existing?.type === 'dir') {
      return { ok: false, err: `write: cannot write to '${p}': Is a directory` }
    }
    loc.parent.children[loc.name] = { type: 'file', content, mode, mtime: now() }
    loc.parent.mtime = now()
    return { ok: true }
  }

  append(p: string, content: string): VfsResult {
    const node = this.getNode(p)
    if (node?.type === 'file') {
      return this.write(p, node.content + content)
    }
    return this.write(p, content)
  }

  read(p: string): { ok: boolean; err?: string; content?: string } {
    const node = this.getNode(p)
    if (!node) return { ok: false, err: `cat: ${p}: No such file or directory` }
    if (node.type === 'dir') return { ok: false, err: `cat: ${p}: Is a directory` }
    return { ok: true, content: node.content }
  }

  rm(p: string, opts: { r?: boolean } = {}): VfsResult {
    const loc = this.parentOf(p)
    if (!loc) return { ok: false, err: `rm: cannot remove '${p}': No such file or directory` }
    const node = loc.parent.children[loc.name]
    if (!node) return { ok: false, err: `rm: cannot remove '${loc.path}': No such file or directory` }
    if (loc.path === '/') return { ok: false, err: 'rm: cannot remove /' }

    if (node.type === 'dir' && Object.keys(node.children).length > 0 && !opts.r) {
      return { ok: false, err: `rm: cannot remove '${loc.path}': Is a directory` }
    }
    delete loc.parent.children[loc.name]
    loc.parent.mtime = now()
    return { ok: true }
  }

  cp(from: string, to: string): VfsResult {
    const src = this.getNode(from)
    if (!src) return { ok: false, err: `cp: cannot stat '${from}': No such file or directory` }
    const destLoc = this.parentOf(to)
    if (!destLoc) return { ok: false, err: `cp: cannot create '${to}': No such file or directory` }

    // 目标已存在且是目录 → 放进去
    let finalPath = this.normalize(to)
    const destNode = this.getNode(to)
    if (destNode?.type === 'dir') {
      const base = from.split('/').filter(Boolean).pop() || ''
      finalPath = `${finalPath === '/' ? '' : finalPath}/${base}`
    }

    const clone = (n: VNode): VNode =>
      n.type === 'file'
        ? { type: 'file', content: n.content, mode: n.mode, mtime: n.mtime }
        : { type: 'dir', children: Object.fromEntries(Object.entries(n.children).map(([k, v]) => [k, clone(v)])), mode: n.mode, mtime: n.mtime }

    const dstParent = this.parentOf(finalPath)
    if (!dstParent) return { ok: false, err: `cp: cannot create '${finalPath}'` }
    dstParent.parent.children[dstParent.name] = clone(src)
    dstParent.parent.mtime = now()
    return { ok: true, out: '' }
  }

  mv(from: string, to: string): VfsResult {
    const src = this.getNode(from)
    if (!src) return { ok: false, err: `mv: cannot stat '${from}': No such file or directory` }
    const srcLoc = this.parentOf(from)
    if (!srcLoc) return { ok: false, err: `mv: cannot move '${from}'` }

    let finalPath = this.normalize(to)
    const destNode = this.getNode(to)
    if (destNode?.type === 'dir') {
      const base = from.split('/').filter(Boolean).pop() || ''
      finalPath = `${finalPath === '/' ? '' : finalPath}/${base}`
    }
    const dstParent = this.parentOf(finalPath)
    if (!dstParent) return { ok: false, err: `mv: cannot move to '${to}': No such file or directory` }

    dstParent.parent.children[dstParent.name] = src
    delete srcLoc.parent.children[srcLoc.name]
    srcLoc.parent.mtime = now()
    dstParent.parent.mtime = now()
    return { ok: true }
  }

  chmod(p: string, mode: number): VfsResult {
    const node = this.getNode(p)
    if (!node) return { ok: false, err: `chmod: cannot access '${p}': No such file or directory` }
    node.mode = mode
    node.mtime = now()
    return { ok: true }
  }

  chown(p: string, user: string, group?: string): VfsResult {
    const node = this.getNode(p)
    if (!node) return { ok: false, err: `chown: cannot access '${p}': No such file or directory` }
    const withUser = node as VNode & { owner?: string; group?: string }
    withUser.owner = user
    if (group) withUser.group = group
    return { ok: true }
  }

  list(p: string): { ok: boolean; err?: string; names?: string[] } {
    const node = this.getNode(p)
    if (!node) return { ok: false, err: `ls: cannot access '${p}': No such file or directory` }
    if (node.type === 'file') return { ok: true, names: [p] }
    return { ok: true, names: Object.keys(node.children).sort() }
  }

  /** 递归收集路径与内容，供 grep / find / tar 使用 */
  walk(root = '/'): { path: string; node: VNode }[] {
    const out: { path: string; node: VNode }[] = []
    const rec = (node: VNode, prefix: string) => {
      if (node.type === 'file') {
        out.push({ path: prefix, node })
        return
      }
      out.push({ path: prefix, node })
      for (const [name, child] of Object.entries(node.children)) {
        rec(child, `${prefix === '/' ? '' : prefix}/${name}`)
      }
    }
    rec(this.getNode(root)!, this.normalize(root))
    return out
  }

  du(p = '/'): number {
    return this.walk(p).reduce((sum, e) => sum + (e.node.type === 'file' ? e.node.content.length : 0), 0)
  }

  /** 整树快照，用于 ToyWin 的 serialize / restore */
  serialize(): DirNode {
    return JSON.parse(JSON.stringify(this.tree))
  }

  restore(snapshot: DirNode): void {
    this.tree = JSON.parse(JSON.stringify(snapshot))
  }

  cd(p: string): VfsResult {
    const abs = this.normalize(p)
    const node = this.getNode(abs)
    if (!node) return { ok: false, err: `cd: ${p}: No such file or directory` }
    if (node.type !== 'dir') return { ok: false, err: `cd: ${p}: Not a directory` }
    this.cwd = abs
    return { ok: true }
  }

  /** 提示符里显示的路径，家目录下用 ~ 缩写 */
  displayPath(p = this.cwd): string {
    return p === this.home ? '~' : p.startsWith(this.home + '/') ? '~' + p.slice(this.home.length) : p
  }
}
