/**
 * 引擎自检脚本（临时验证用，不属于站点产物）。
 * 用法：npx esbuild scripts/verify-engines.ts --bundle --platform=node --format=esm --outfile=scripts/.out.mjs && node scripts/.out.mjs
 */

import { Shell } from '../docs/.vitepress/lib/shell-linux'
import { WinShell } from '../docs/.vitepress/lib/shell-windows'

let pass = 0
let fail = 0

function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    pass++
  } else {
    fail++
    console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`)
  }
}

function run(shell: Shell | WinShell, line: string) {
  return shell.exec(line)
}

console.log('=== F1 · ToyShell 10 条命令 ===')
{
  const s = new Shell()
  const r = (l: string) => run(s, l)

  check('pwd', r('pwd').stdout === '/home/max', r('pwd').stdout)

  const ls = r('ls -la /etc')
  check('ls -la 含 passwd', ls.stdout.includes('passwd'), ls.stdout.slice(0, 80))
  check('ls -la 权限列存在', /-rw-r--r--/.test(ls.stdout), ls.stdout.split('\n')[1])

  const lsDir = r('ls -la /home/max')
  // /home/max 下既有文件也有目录 projects，应同时出现 d 与 - 开头的行
  check('ls -la 目录标 d 开头', lsDir.stdout.split('\n').some((l) => /^d/.test(l)))
  check('ls -la 文件标 - 开头', lsDir.stdout.split('\n').some((l) => /^-/.test(l)))

  const mk = r('mkdir -p /tmp/practice/deep')
  check('mkdir -p', mk.exit === 0 && r('ls /tmp/practice').stdout.includes('deep'))

  check('touch', r('touch /tmp/a.txt').exit === 0 && r('ls /tmp').stdout.includes('a.txt'))

  const cat = r('cat /etc/hostname')
  check('cat', cat.stdout.trim() === 'devbox', JSON.stringify(cat.stdout))

  const grep = r('grep root /etc/passwd')
  check('grep 命中', grep.stdout.includes('root:x:0:0'), grep.stdout)

  const chmod = r('chmod 700 /tmp/a.txt')
  check('chmod 数字模式', chmod.exit === 0)

  const bad = r('chmod zzz /tmp/a.txt')
  check('chmod 非法模式报错而非静默 000', bad.exit !== 0 && bad.stderr.includes('invalid mode'), bad.stderr)

  const tar = r('tar -cf /tmp/backup.tar /etc/passwd')
  check('tar -c', tar.exit === 0 && r('ls /tmp').stdout.includes('backup.tar'))

  const find = r('find /etc -name hostname')
  check('find -name', find.stdout.includes('/etc/hostname'), find.stdout)

  const df = r('df')
  check('df 含 Use%', df.stdout.includes('Use%'), df.stdout)

  const du = r('du /etc')
  check('du 输出行数>0', du.stdout.split('\n').length > 0)

  const tree = r('tree /etc')
  check('tree 含 └──', tree.stdout.includes('└──'), tree.stdout)

  // wc 不带 flag 时输出 行数 词数 字节数 三列
  check('wc 三列输出', r('wc /etc/passwd').stdout.trim().split(/\s+/).length === 4, r('wc /etc/passwd').stdout)
  check('wc -l 单列', r('wc -l /etc/passwd').stdout.trim().split(/\s+/).length === 2, r('wc -l /etc/passwd').stdout)

  const miss = r('nosuchcmd')
  check('未注册命令 127', miss.exit === 127, String(miss.exit))

  const rmr = r('rm /')
  check('rm / 被拒绝', rmr.exit !== 0)

  const quote = r('touch "/tmp/with space.txt"')
  check('引号路径', quote.exit === 0 && r('ls /tmp').stdout.includes('with space.txt'), quote.stderr)
}

console.log('=== F3 · 撤销 ===')
{
  const s = new Shell()

  s.exec('mkdir /tmp/undo-me')
  check('mkdir 已创建', s.vfs.exists('/tmp/undo-me'))
  check('撤销 mkdir', s.undo().stdout.includes('已撤销') && !s.vfs.exists('/tmp/undo-me'))

  // 覆盖已存在文件后再撤销，应恢复原内容
  s.exec('echo "原始内容" > /tmp/keep.txt')
  const before = s.vfs.read('/tmp/keep.txt')
  check('echo > 重定向写入', before.ok && before.content!.includes('原始内容'), before.content)
  s.exec('echo "覆盖内容" > /tmp/keep.txt')
  check('覆盖生效', s.vfs.read('/tmp/keep.txt').content!.includes('覆盖内容'))
  s.undo()
  check('撤销恢复原内容', s.vfs.read('/tmp/keep.txt').content!.includes('原始内容'), s.vfs.read('/tmp/keep.txt').content)

  // 删除后撤销应恢复
  s.exec('touch /tmp/gone.txt')
  s.exec('rm /tmp/gone.txt')
  check('rm 生效', !s.vfs.exists('/tmp/gone.txt'))
  s.undo()
  check('撤销恢复删除的文件', s.vfs.exists('/tmp/gone.txt'))

  // 追加重定向
  s.exec('echo "行1" > /tmp/acc.txt')
  s.exec('echo "行2" >> /tmp/acc.txt')
  const acc = s.vfs.read('/tmp/acc.txt').content!
  check('>> 追加且保留原内容', acc.includes('行1') && acc.includes('行2'), acc)
}

console.log('=== F2 · ToyWin 8 条命令 ===')
{
  const s = new WinShell()
  const r = (l: string) => run(s, l)

  const dir = r('dir C:\\Users\\MAX')
  check('dir 输出文件数行', dir.stdout.includes('个文件'), dir.stdout.slice(0, 60))

  const cd = r('cd C:\\Users\\MAX\\Documents')
  check('cd', cd.exit === 0 && s.vfs.cwd.startsWith('C:\\Users\\MAX\\Documents'), s.vfs.cwd)

  const md = r('md NewFolder')
  check('md', md.exit === 0 && s.vfs.isDir('C:\\Users\\MAX\\Documents\\NewFolder'), md.stderr)

  const type = r('type C:\\Users\\MAX\\Documents\\report.txt')
  check('type', type.stdout.includes('季度报告'), type.stdout.slice(0, 40))

  const copy = r('copy C:\\Users\\MAX\\Documents\\report.txt C:\\Users\\MAX\\Documents\\copy.txt')
  check('copy', copy.exit === 0 && s.vfs.exists('C:\\Users\\MAX\\Documents\\copy.txt'), copy.stderr)

  const ipc = r('ipconfig')
  check('ipconfig 含 IPv4', ipc.stdout.includes('192.168.1.50'), ipc.stdout.slice(0, 60))

  const tl = r('tasklist')
  check('tasklist 含 node.exe', tl.stdout.includes('node.exe'))

  const del = r('del C:\\Users\\MAX\\Documents\\copy.txt')
  check('del', del.exit === 0 && !s.vfs.exists('C:\\Users\\MAX\\Documents\\copy.txt'), del.stderr)

  const delDir = r('del C:\\Users\\MAX\\Documents\\NewFolder')
  check('CMD del 删目录被拒（须用 rd）', delDir.exit !== 0 && delDir.stderr.includes('拒绝访问'), delDir.stderr)
  check('del 未误删目录', s.vfs.isDir('C:\\Users\\MAX\\Documents\\NewFolder'))

  const rd = r('rd C:\\Users\\MAX\\Documents\\NewFolder')
  check('rd 空目录成功', rd.exit === 0, rd.stderr)

  const rdFull = r('rd C:\\Users\\MAX\\Documents')
  check('rd 非空目录被拒', rdFull.exit !== 0 && rdFull.stderr.includes('目录不是空的'), rdFull.stderr)

  const rdS = r('rd /s C:\\Users\\MAX\\Documents')
  check('rd /s 强制删除', rdS.exit === 0 && !s.vfs.exists('C:\\Users\\MAX\\Documents'), rdS.stderr)

  const ci = r('dir c:\\users\\max\\desktop')
  check('路径大小写不敏感', ci.exit === 0, ci.stderr)

  const echoW = r('echo 写入的内容 > C:\\Users\\MAX\\Desktop\\out.txt')
  check('echo > 重定向', echoW.exit === 0, echoW.stderr)
  const back = s.vfs.read('C:\\Users\\MAX\\Desktop\\out.txt')
  check('重定向内容正确', back.ok && back.content?.includes('写入的内容'), back.content)

  const echoA = r('echo 第二行 >> C:\\Users\\MAX\\Desktop\\out.txt')
  const back2 = s.vfs.read('C:\\Users\\MAX\\Desktop\\out.txt')
  check('echo >> 追加', echoA.exit === 0 && back2.content!.includes('第二行') && back2.content!.includes('写入的内容'), back2.content)

  const gci = r('get-childitem C:\\Users\\MAX')
  check('PowerShell gci 目录带 /', gci.stdout.split('\n').some((l) => l.endsWith('/')), gci.stdout)
  check('PowerShell gci 不含详细表头', !gci.stdout.includes('卷序列号'), gci.stdout.slice(0, 80))
  const cmdDir = r('dir C:\\Users\\MAX')
  check('CMD dir 保留详细输出', cmdDir.stdout.includes('卷序列号'), cmdDir.stdout.slice(0, 60))

  const ni = r('new-item -itemtype directory -path C:\\Users\\MAX\\Desktop\\PSDir')
  check('PowerShell new-item -ItemType Directory', ni.exit === 0 && s.vfs.isDir('C:\\Users\\MAX\\Desktop\\PSDir'), ni.stderr)

  const niF = r('new-item -itemtype file -path C:\\Users\\MAX\\Desktop\\ps.txt')
  check('PowerShell new-item file', niF.exit === 0, niF.stderr)

  const rmi = r('remove-item -recurse -force C:\\Users\\MAX\\Desktop\\PSDir')
  check('PowerShell remove-item -Recurse', rmi.exit === 0 && !s.vfs.exists('C:\\Users\\MAX\\Desktop\\PSDir'), rmi.stderr)

  const tnc = r('test-netconnection -ComputerName 8.8.8.8 -Port 443')
  check('Test-NetConnection', tnc.stdout.includes('TcpTestSucceeded : True'), tnc.stdout)

  const bad = r('zzzz')
  check('未知命令 9009', bad.exit === 9009, String(bad.exit))

  const ser = s.vfs.serialize()
  check('serialize/restore', (() => {
    s.vfs.rm('C:\\Users\\MAX\\Desktop\\out.txt', { force: true })
    const gone = !s.vfs.exists('C:\\Users\\MAX\\Desktop\\out.txt')
    s.vfs.restore(ser)
    return gone && s.vfs.exists('C:\\Users\\MAX\\Desktop\\out.txt')
  })())
}

console.log('')
console.log(`结果：${pass} 通过，${fail} 失败`)
if (fail > 0) process.exit(1)
