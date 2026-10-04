/**
 * 交叉核对：章节里写的「你应该看到什么」是否与引擎真实输出一致。
 * 文档里编造的输出样例是「空洞内容」里最隐蔽的一种 —— 读者一敲就发现对不上。
 */

import { Shell } from '../docs/.vitepress/lib/shell-linux'
import { WinShell } from '../docs/.vitepress/lib/shell-windows'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

let pass = 0, fail = 0
const bad: string[] = []
function check(name: string, cond: boolean, detail = '') {
  if (cond) pass++
  else { fail++; bad.push(`${name}${detail ? ' — ' + detail : ''}`); console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`) }
}

const L = new Shell()
const W = new WinShell()

function run(s: Shell | WinShell, cmd: string) {
  return s.exec(cmd)
}

console.log('=== 01-intro 声称的输出 ===')
{
  check('pwd → /home/max', run(L, 'pwd').stdout === '/home/max', run(L, 'pwd').stdout)
  const ls = run(L, 'ls').stdout
  check('ls 含 projects/readme.md/notes.txt',
    ls.includes('projects') && ls.includes('readme.md') && ls.includes('notes.txt'), ls)
  const lsah = run(L, 'ls -lah').stdout
  check('ls -lah 首行 total 3', lsah.split('\n')[0] === 'total 3', lsah.split('\n')[0])
  check('ls -lah 权限含 -rw-r--r--', lsah.includes('-rw-r--r--'))
  check('ls -lah 含 drwxr-xr-x 目录', lsah.includes('drwxr-xr-x'))
  const mkdirBad = run(L, 'mkdir a/b/c').stderr
  check('mkdir a/b/c 报 No such file or directory', mkdirBad.includes('No such file or directory'), mkdirBad)
  const ch = run(L, 'chmod zzz /etc/hosts').stderr
  check('chmod 非法权限报错', ch.includes('invalid mode'), ch)
}

console.log('=== 02-view 声称的输出 ===')
{
  const hosts = run(L, 'cat /etc/hosts').stdout
  check('cat /etc/hosts 含 localhost', hosts.includes('localhost'), hosts.split('\n')[0])
  const wc = run(L, 'wc /etc/hosts').stdout.trim()
  check('wc 不带 flag 输出 4 段（行 词 字节 文件名）', wc.split(/\s+/).length === 4, wc)
  const wcl = run(L, 'wc -l /etc/hosts').stdout.trim()
  check('wc -l 输出 2 段', wcl.split(/\s+/).length === 2, wcl)
}

console.log('=== 03-search 声称的输出 ===')
{
  const f = run(L, 'find /etc -name hostname').stdout
  check('find /etc -name hostname → /etc/hostname', f.trim() === '/etc/hostname', f)
  const g = run(L, 'grep root /etc/passwd').stdout
  check('grep root /etc/passwd 含 root:x:0:0', g.includes('root:x:0:0'), g.split('\n')[0])
  const gn = run(L, 'grep -n root /etc/passwd').stdout
  check('grep -n 带行号', /^\d+:/.test(gn), gn.split('\n')[0])
  // grep 无匹配返回 1（文档反复强调这一点）
  check('grep 无匹配退出码为 1', run(L, 'grep zzzznotfound /etc/passwd').exit === 1)
}

console.log('=== 04-permission 声称的输出 ===')
{
  const lsl = run(L, 'ls -l /etc/hosts').stdout
  check('ls -l 权限列 10 字符', lsl.split(/\s+/)[0].length === 10, lsl.split(/\s+/)[0])
  check('chmod 700 生效', (() => { run(L, 'chmod 700 /etc/hosts'); return run(L, 'ls -l /etc/hosts').stdout.includes('-rwx------') })())
}

console.log('=== 05-process 声称的输出 ===')
{
  const free = run(L, 'free').stdout
  check('free 含 Mem: 行', free.includes('Mem:'), free.split('\n')[0])
  check('free 含 Swap: 行', free.includes('Swap:'))
  const df = run(L, 'df').stdout
  check('df 含 Use%', df.includes('Use%'), df.split('\n')[0])
  const ps = run(L, 'ps').stdout
  check('ps 含 PID 表头', ps.includes('PID'), ps.split('\n')[0])
  const kill = run(L, 'kill -9 1234')
  check('kill -9 退出码 0', kill.exit === 0, String(kill.exit))
  const top = run(L, 'top').stdout
  check('top 含 load average', top.includes('load average'), top.split('\n')[0])
}

console.log('=== 08-archive 声称的输出 ===')
{
  check('tar -c 能建包', run(L, 'tar -cf /tmp/b.tar /etc/hosts').exit === 0)
  check('tar -t 能列出内容', run(L, 'tar -tf /tmp/b.tar').stdout.includes('/etc/hosts'))
}

console.log('=== Windows 01-file-system 声称的输出 ===')
{
  const dir = run(W, 'dir C:\\Users\\MAX').stdout
  check('dir 含「驱动器 C 中的卷没有标签」', dir.includes('驱动器 C 中的卷没有标签'), dir.split('\n')[0])
  check('dir 含卷序列号', dir.includes('卷序列号'), dir.split('\n')[2] ?? '')
  check('dir 含「个文件」', dir.includes('个文件'))
  const gci = run(W, 'get-childitem C:\\Users\\MAX').stdout
  check('gci 目录带 /', gci.split('\n').some((l: string) => l.endsWith('/')), gci.split('\n')[0])
  check('gci 不含详细表头', !gci.includes('卷序列号'))
  const ver = run(W, 'ver').stdout
  check('ver 含 Windows', ver.includes('Windows'), ver.split('\n')[0])
  const ipc = run(W, 'ipconfig').stdout
  check('ipconfig 含 IPv4 地址', ipc.includes('IPv4 地址'), ipc.split('\n')[0])
}

console.log('=== Windows 02-file-ops 声称的输出 ===')
{
  // del 删目录 → 拒绝访问；rd /s 才能删
  run(W, 'md C:\\Users\\MAX\\Documents\\D1')
  const delDir = run(W, 'del C:\\Users\\MAX\\Documents\\D1')
  check('del 删目录报「拒绝访问」', delDir.stderr.includes('拒绝访问'), delDir.stderr)
  check('del 未误删目录', W.vfs.isDir('C:\\Users\\MAX\\Documents\\D1'))
  const rd = run(W, 'rd C:\\Users\\MAX\\Documents\\D1')
  check('rd 删空目录成功', rd.exit === 0, rd.stderr)
  // rd 非空目录失败
  const rdFull = run(W, 'rd C:\\Users\\MAX\\Documents')
  check('rd 删非空目录报「目录不是空的」', rdFull.stderr.includes('目录不是空的'), rdFull.stderr)
  const rds = run(W, 'rd /s C:\\Users\\MAX\\Documents')
  check('rd /s 强制删除成功', rds.exit === 0, rds.stderr)
}

console.log('=== 未知命令退出码（文档反复强调） ===')
{
  check('ToyShell 未知命令 127', run(L, 'nosuchcmd123').exit === 127, String(run(L, 'nosuchcmd123').exit))
  check('ToyWin 未知命令 9009', run(W, 'zzzznope').exit === 9009, String(run(W, 'zzzznope').exit))
}

console.log('')
console.log(`结果：${pass} 通过，${fail} 失败`)
if (fail) { console.log(''); console.log('失败明细：'); bad.forEach(b => console.log('  - ' + b)); process.exit(1) }
