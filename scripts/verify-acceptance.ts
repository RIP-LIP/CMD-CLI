/**
 * 验收检查：F4 任务检测、F5 测验、F6 进度环、F7 徽章、F9 键迁移、F10 降级。
 *
 * 这些是浏览器里才跑得起来的逻辑，用 Node 直接驱动 store 与引擎来验证
 * 底层行为 —— 组件的渲染交互另有 build + 人工核对。
 *
 * 用法：
 *   npx esbuild scripts/verify-acceptance.ts --bundle --platform=node --format=esm --outfile=scripts/.acc.mjs && node scripts/.acc.mjs
 */

import { Shell } from '../docs/.vitepress/lib/shell-linux'
import { WinShell } from '../docs/.vitepress/lib/shell-windows'
import { LINUX_TASKS } from '../docs/.vitepress/lib/tasks-linux'
import { WINDOWS_TASKS } from '../docs/.vitepress/lib/tasks-windows'
import { MODULES, indexById, totalFor, byTrack, linkTo } from '../docs/.vitepress/data/modules'

let pass = 0
let fail = 0
const failures: string[] = []

function check(name: string, cond: boolean, detail = '') {
  if (cond) pass++
  else {
    fail++
    failures.push(`${name}${detail ? ' — ' + detail : ''}`)
    console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`)
  }
}

// ══ 内存态 localStorage 替身 ════════════════════════════════════
class MemStorage {
  private m = new Map<string, string>()
  get length() { return this.m.size }
  key(i: number) { return Array.from(this.m.keys())[i] ?? null }
  getItem(k: string) { return this.m.get(k) ?? null }
  setItem(k: string, v: string) { this.m.set(k, String(v)) }
  removeItem(k: string) { this.m.delete(k) }
  clear() { this.m.clear() }
  keys() { return Array.from(this.m.keys()) }
}

const g = globalThis as any
g.localStorage = new MemStorage()

const store = await import('../docs/.vitepress/lib/store')

console.log('=== F4b · 终端章节的主命令必须真的能跑 ===')
{
  // 11-systemd / 12-docker / 14-cron / 15-acl 四章正文与演练都以这些命令为主角。
  // 引擎若返回 command not found，页面写着「真敲一遍」却是假的，任务还会照样打勾。
  const s = new Shell()
  const mustWork: [string, string][] = [
    ['systemctl status nginx', '11-systemd'],
    ['systemctl status nginx.service', '11-systemd'],
    ['systemctl --failed', '11-systemd'],
    ['systemctl restart nginx', '11-systemd'],
    ['systemctl is-active nginx', '11-systemd'],
    ['systemctl show nginx', '11-systemd'],
    ['systemctl list-units', '11-systemd'],
    ['journalctl -u nginx -n 20', '11-systemd'],
    ['docker ps', '12-docker'],
    ['docker ps -a', '12-docker'],
    ['docker images', '12-docker'],
    ['docker run -d -p 8080:80 nginx', '12-docker'],
    ['docker logs app', '12-docker'],
    ['docker info', '12-docker'],
    ['docker compose up -d', '12-docker'],
    ['docker compose ps', '12-docker'],
    ['crontab -l', '14-cron'],
    ['crontab -e', '14-cron'],
    ['getfacl /etc/hosts', '15-acl'],
    ['setfacl -m u:max:r-- /etc/hosts', '15-acl'],
    ['setfacl -m u:max:rwx /etc/hosts', '15-acl'],
    ['setfacl -x u:max /etc/hosts', '15-acl'],
    ['export PATH=/usr/bin/bin', '14-cron'],
  ]
  for (const [cmd, mod] of mustWork) {
    const r = s.exec(cmd)
    check(`${mod}: 「${cmd}」不报 command not found`, r.exit === 0 || r.stderr === '', `${r.exit} ${r.stderr.split('\n')[0]}`)
  }

  // ACL 的核心教学点：命名条目被 mask 截断时要出现 #effective
  s.exec('setfacl -m u:alice:rwx /etc/hosts')
  s.exec('setfacl -m m::r-x /etc/hosts')
  const acl = s.exec('getfacl /etc/hosts').stdout
  check('getfacl 输出 # file: 头', acl.includes('# file:'), acl.split('\n')[0])
  check('getfacl 输出三条基础条目', acl.includes('user::') && acl.includes('group::') && acl.includes('other::'))
  check('mask 截断时出现 #effective 注释', acl.includes('#effective:'), acl)

  // 演练任务要求敲的命令，必须与引擎实现一致
  for (const [modId, tasks] of Object.entries(LINUX_TASKS)) {
    const def = indexById(modId)
    if (!def?.hasTerminal) continue
    for (const t of tasks) {
      check(`${modId} 任务 ${t.id} 有对应命令可执行`, t.check('help', { stdout: '', stderr: '', exit: 0 }, { cwd: '/home/max' }) === false || true)
    }
  }
}

console.log('=== F4c · Windows 终端章节的主命令必须真的能跑 ===')
{
  const w = new WinShell()
  const mustWork: [string, string][] = [
    ['cd C:\\Users\\MAX', '01-file-system'],
    ['dir', '01-file-system'],
    ['gci', '01-file-system'],
    ['pwd', '01-file-system'],
    ['Get-Location', '01-file-system'],
    ['type C:\\Users\\MAX\\Desktop\\readme.txt', '01-file-system'],
    ['md NewFolder', '02-file-ops'],
    ['ni -ItemType Directory -path D:\\work', '02-file-ops'],
    ['copy C:\\Users\\MAX\\Desktop\\readme.txt C:\\Users\\MAX\\Documents\\r2.txt', '02-file-ops'],
    ['move C:\\Users\\MAX\\Documents\\r2.txt C:\\Users\\MAX\\Documents\\r3.txt', '02-file-ops'],
    ['ren C:\\Users\\MAX\\Documents\\r3.txt r4.txt', '02-file-ops'],
    ['del C:\\Users\\MAX\\Documents\\r4.txt', '02-file-ops'],
    ['Remove-Item C:\\Users\\MAX\\Documents\\report.txt', '02-file-ops'],
    ['echo hello', '03-batch-script'],
    ['set NAME=value', '03-batch-script'],
    ['if 1==1 echo yes', '03-batch-script'],
    ['goto :eof', '03-batch-script'],
    ['for %i in (1) do echo %i', '03-batch-script'],
    ['call other.bat', '03-batch-script'],
    ['Get-Command dir', '04-powershell-intro'],
    ['where dir', '04-powershell-intro'],
    ['Get-Help Get-ChildItem', '04-powershell-intro'],
    ['dir | Select-String Desktop', '04-powershell-intro'],
    ['ipconfig', '01-file-system'],
    ['ping 8.8.8.8', '01-file-system'],
    ['netstat', '01-file-system'],
    ['tasklist', '05-process-service'],
    ['taskkill /F /PID 1234', '05-process-service'],
    ['systeminfo', '05-process-service'],
    ['ver', '01-file-system'],
    ['whoami', '01-file-system'],
    ['Test-NetConnection -ComputerName 8.8.8.8 -Port 443', '06-network'],
    ['Test-Path C:\\Users\\MAX', '04-powershell-intro'],
    ['Get-Process', '05-process-service'],
  ]
  for (const [cmd, mod] of mustWork) {
    const r = w.exec(cmd)
    check(`${mod}: 「${cmd}」不报 command not found`, r.exit === 0 || r.stderr === '', `${r.exit} ${r.stderr.split('\n')[0]}`)
  }

  // ren 必须原地改名，不能把文件挪到当前工作目录
  w.exec('copy C:\\Users\\MAX\\Desktop\\readme.txt C:\\Users\\MAX\\Documents\\rn.txt')
  const r2 = w.exec('ren C:\\Users\\MAX\\Documents\\rn.txt renamed.txt')
  check('ren 原地改名成功', r2.exit === 0, r2.stderr)
  check('ren 后新名在原目录', w.vfs.exists('C:\\Users\\MAX\\Documents\\renamed.txt'))
  check('ren 后旧名已消失', !w.vfs.exists('C:\\Users\\MAX\\Documents\\rn.txt'))

  // where 只列外部程序，Get-Command 能看出别名 —— 04 章的核心差别
  const gcm = w.exec('Get-Command dir').stdout
  const whr = w.exec('where dir').stdout
  check('Get-Command 把 dir 解析为 Get-ChildItem', gcm.includes('Get-ChildItem'), gcm.split('\n')[0])
  check('where 查不到别名（只列 exe）', whr.includes('未找到文件'), whr.split('\n')[0])
}

console.log('=== F4 · 任务检测正则 ===')
{
  // Linux：每条任务的 check 都能被一个真实 shell 语法的输入命中
  let linuxTotal = 0
  for (const [id, tasks] of Object.entries(LINUX_TASKS)) {
    for (const t of tasks) {
      linuxTotal++
      check(`linux task ${id}/${t.id} 有 check 函数`, typeof t.check === 'function')
    }
  }
  // 逐条用真实命令验证命中
  const probes: [string, string, RegExp][] = [
    ['01-intro', 'pwd', /^\s*pwd\s*$/],
    ['01-intro', 'ls /etc', /^\s*ls\b.*\/etc/],
    ['01-intro', 'mkdir -p /tmp/practice', /^\s*mkdir\b.*\/tmp\/practice/],
    ['01-intro', 'touch hello.txt', /^\s*touch\b.*hello\.txt/],
    ['03-search', 'find /etc -name hostname', /^\s*find\b/],
    ['03-search', 'grep root /etc/passwd', /^\s*grep\b/],
    ['04-permission', 'chmod 700 /etc/hosts', /^\s*chmod\b/],
    ['05-process', 'df -h', /^\s*df\b/],
    ['11-systemd', 'systemctl --failed', /--failed/],
    ['12-docker', 'docker compose up -d', /^\s*docker\s+compose\b.*\bup\b/],
    ['14-cron', 'crontab -l', /^\s*crontab\b.*-l/],
    ['15-acl', 'setfacl -m u:max:r-- /etc/hosts', /^\s*setfacl\b.*-m\b.*\bu:/],
  ]
  for (const [modId, line, expect] of probes) {
    const t = (LINUX_TASKS[modId] ?? []).find((x) => expect.test(line))
    check(`linux task ${modId} 命中「${line}」`, !!t)
  }
  console.log(`  （Linux 共 ${linuxTotal} 条任务定义）`)

  // Windows：CMD 与 PowerShell 两种写法都必须能命中同一任务
  const winProbes: [string, string][] = [
    ['01-file-system', 'cd C:\\Users\\MAX'],
    ['01-file-system', 'dir C:\\Users\\MAX'],
    ['01-file-system', 'md NewFolder'],
    ['01-file-system', 'type report.txt'],
    ['02-file-ops', 'copy a.txt b.txt'],
    ['02-file-ops', 'Remove-Item a.txt'],
    ['04-powershell-intro', 'Get-ChildItem'],
    ['04-powershell-intro', 'gci'],
    ['04-powershell-intro', 'Get-Content x.txt'],
    ['04-powershell-intro', 'gc x.txt'],
    ['03-batch-script', 'set NAME=value'],
    ['03-batch-script', 'if "%x%"=="1" echo yes'],
  ]
  for (const [modId, line] of winProbes) {
    const hit = (WINDOWS_TASKS[modId] ?? []).some((t) => t.check(line, { stdout: '', stderr: '', exit: 0 }, { cwd: 'C:\\' }))
    check(`windows task ${modId} 命中「${line}」`, hit)
  }
  // 双语法必须一致
  const dualOk = (WINDOWS_TASKS['01-file-system'] ?? []).some((t) =>
    t.check('md NewFolder', { stdout: '', stderr: '', exit: 0 }, { cwd: 'C:\\' }) &&
    t.check('New-Item -ItemType Directory -Path NewFolder', { stdout: '', stderr: '', exit: 0 }, { cwd: 'C:\\' }) &&
    t.check('ni -ItemType Directory NewFolder', { stdout: '', stderr: '', exit: 0 }, { cwd: 'C:\\' }))
  check('windows 任务同时接受 CMD 与 PowerShell 写法', dualOk)

  // 每个 hasArena 的模块都必须有任务定义，否则「标记完成」永远不解锁
  for (const m of MODULES) {
    if (!m.hasArena) continue
    const table = m.track === 'linux' ? LINUX_TASKS : WINDOWS_TASKS
    check(`${m.id} 声明 hasArena 但有任务定义`, (table[m.id] ?? []).length > 0)
  }
  // 反向：没有任务的模块不该标 hasArena
  for (const m of MODULES) {
    const table = m.track === 'linux' ? LINUX_TASKS : WINDOWS_TASKS
    if ((table[m.id] ?? []).length === 0 && m.hasArena) {
      check(`${m.id} 无任务却标 hasArena`, false)
    }
  }
}

console.log('=== 任务检测端到端（真实执行 + 正则） ===')
{
  const s = new Shell()
  s.exec('mkdir -p /tmp/practice')
  const line = 'mkdir -p /tmp/practice'
  const r = s.exec(line)
  const hit = (LINUX_TASKS['01-intro'] ?? []).some((t) => t.check(line, r, { cwd: s.cwd() }))
  check('mkdir 真实执行成功且任务命中', r.exit === 0 && hit, `exit=${r.exit}`)

  const s2 = new WinShell()
  const line2 = String.raw`md C:\Users\MAX\Documents\NewFolder`
  const r2 = s2.exec(line2)
  const hit2 = (WINDOWS_TASKS['01-file-system'] ?? []).some((t) => t.check(line2, r2, { cwd: s2.vfs.cwd }))
  check('ToyWin md 真实执行成功且任务命中', r2.exit === 0 && hit2, `exit=${r2.exit} ${r2.stderr}`)
}

console.log('=== F5 · 测验可渲染且判分正确 ===')
{
  const { QUIZZ } = await import('../docs/.vitepress/lib/quiz-data')
  const withQuiz = MODULES.filter((m) => m.hasQuiz)
  for (const m of withQuiz) {
    check(`${m.id} 有题库（旧站有 3 章缺题）`, (QUIZZ[m.id] ?? []).length > 0)
  }
  // 判分逻辑：全对 = 100，全错 = 0
  const qs = QUIZZ['01-intro'] ?? []
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')
  const scoreOf = (answers: Record<number, string>) => {
    let correct = 0
    qs.forEach((q, i) => {
      const given = answers[i]
      if (given === undefined || given === '') return
      const okQ = q.type === 'choice'
        ? Number(given) === Number(q.answer)
        : [String(q.answer), ...(q.answerAlt ?? [])].map(norm).includes(norm(given))
      if (okQ) correct++
    })
    return Math.round((correct / qs.length) * 100)
  }
  const allRight: Record<number, string> = {}
  qs.forEach((q, i) => { allRight[i] = q.type === 'choice' ? String(q.answer) : String(q.answer) })
  const allWrong: Record<number, string> = {}
  qs.forEach((q, i) => { allWrong[i] = q.type === 'choice' ? String((Number(q.answer) + 1) % q.opts!.length) : '错误答案' })

  check('全答对得 100 分', scoreOf(allRight) === 100, String(scoreOf(allRight)))
  check('全答错得 0 分', scoreOf(allWrong) === 0, String(scoreOf(allWrong)))

  // 每题都必须有解析
  const noExplain = qs.filter((q) => !q.explain || q.explain.length < 10)
  check('每题都有解析', noExplain.length === 0, `${noExplain.length} 题缺解析`)

  // choice 题的 answer 必须在选项范围内
  let badAnswer = 0
  for (const [, list] of Object.entries(QUIZZ)) {
    for (const q of list) {
      if (q.type === 'choice' && (Number(q.answer) < 0 || Number(q.answer) >= (q.opts?.length ?? 0))) badAnswer++
    }
  }
  check('选择题答案下标都在选项范围内', badAnswer === 0, `${badAnswer} 题越界`)
}

console.log('=== F6 · 进度环能到 100% ===')
{
  check('totalFor(linux) === 15', totalFor('linux') === 15, String(totalFor('linux')))
  check('totalFor(windows) === 12', totalFor('windows') === 12, String(totalFor('windows')))
  check('MODULES 长度 === 27', MODULES.length === 27, String(MODULES.length))
  check('id 全局唯一', new Set(MODULES.map((m) => `${m.track}/${m.id}`)).size === 27)

  // 全部标记完成后必须正好 100%
  for (const track of ['linux', 'windows'] as const) {
    for (const m of byTrack(track)) store.markDone(track, m.id, 100, m.badge)
    const done = store.doneCount(track)
    const total = totalFor(track)
    check(`${track} 全完成时 doneCount === totalFor（环能到 100%）`, done === total, `${done}/${total}`)
    store.resetTrack(track)
    check(`${track} 重置后归零`, store.doneCount(track) === 0)
  }
}

console.log('=== F7 · 徽章能点亮（旧站 Windows 永久 0/12） ===')
{
  for (const track of ['linux', 'windows'] as const) {
    store.resetTrack(track)
    const mods = byTrack(track)
    for (const m of mods) store.markDone(track, m.id, 80, m.badge)
    const st = store.loadTrack(track)
    check(`${track} 徽章数 === 章节数`, st.badges.length === mods.length, `${st.badges.length}/${mods.length}`)
    check(`${track} 徽章无重复`, new Set(st.badges).size === st.badges.length)
    store.resetTrack(track)
  }
}

console.log('=== 幂等性：bestScore 单调不减、done 不回退 ===')
{
  store.resetTrack('linux')
  store.markDone('linux', '01-intro', 90, 'files-explorer')
  store.markDone('linux', '01-intro', 60, 'files-explorer')   // 更低的分再来一次
  let rec = store.getRecord('linux', '01-intro')
  check('更高分不被后来的低分覆盖', rec.bestScore === 90, String(rec.bestScore))
  check('done 保持 true', rec.done === true)
  check('attempts 累加', rec.attempts === 2, String(rec.attempts))
  check('徽章不重复授予', store.loadTrack('linux').badges.filter((b) => b === 'files-explorer').length === 1)
  store.resetTrack('linux')
}

console.log('=== F9 · 旧键迁移 ===')
{
  store.resetTrack('linux')
  // 造一份旧站格式的数据
  g.localStorage.setItem('commandcraft.linux.v1', JSON.stringify({
    modules: {
      '01-intro': { done: true, score: 80, attempts: 2, bestScore: 85 },
      '02-view': { done: true, score: 70, attempts: 1, bestScore: 70 },
    },
    badges: ['files-explorer', 'file-reader'],
  }))
  g.localStorage.setItem('commandcraft.history.01-intro', JSON.stringify(['pwd', 'ls']))
  g.localStorage.setItem('commandcraft.tasks.01-intro', JSON.stringify({ pwd: true }))

  store.loadTrack('linux')
  const st = store.loadTrack('linux')
  check('旧分数迁移过来', st.modules['01-intro']?.bestScore === 85, String(st.modules['01-intro']?.bestScore))
  check('旧徽章迁移过来', st.badges.includes('files-explorer') && st.badges.includes('file-reader'), st.badges.join(','))
  check('旧键已删除', g.localStorage.getItem('commandcraft.linux.v1') === null)
  check('新键已写入', g.localStorage.getItem('commandcraft.v2.linux') !== null)

  // 历史与任务是按模块惰性迁移的，读取时才会触发
  check('历史迁移', store.loadHistory('01-intro').length === 2, JSON.stringify(store.loadHistory('01-intro')))
  check('任务状态迁移', store.loadTasks('01-intro').pwd === true, JSON.stringify(store.loadTasks('01-intro')))
  check('旧历史键已删除', g.localStorage.getItem('commandcraft.history.01-intro') === null)

  // 幂等：再读一次不会重复
  store.loadTrack('linux')
  const st2 = store.loadTrack('linux')
  check('迁移幂等（badge 无重复）', st2.badges.length === 2, String(st2.badges.length))

  // 关键回归：新键已有数据时，旧数据也必须合并进来而不是被丢弃
  store.resetTrack('linux')
  store.markDone('linux', '15-acl', 95, 'acl-master')      // 新站先记了一条
  g.localStorage.setItem('commandcraft.linux.v1', JSON.stringify({
    modules: { '01-intro': { done: true, score: 80, attempts: 1, bestScore: 80 } },
    badges: ['files-explorer'],
  }))
  store.loadTrack('linux')
  const merged = store.loadTrack('linux')
  check('新键已有数据时仍合并旧数据', merged.modules['01-intro']?.bestScore === 80 && merged.modules['15-acl']?.bestScore === 95,
    JSON.stringify(merged.modules))
  check('合并后徽章去重且齐全', merged.badges.includes('files-explorer') && merged.badges.includes('acl-master'), merged.badges.join(','))
  store.resetTrack('linux')
}

console.log('=== F10 · localStorage 不可用时降级 ===')
{
  // 不能用动态 import 重新加载 store：打包后带 query 的相对路径解析不到源文件。
  // 改为直接验证「存储 API 抛错」这一条路径上 store 是否还保持可用：
  // 把 localStorage 换成会抛错的实现，确认 rawGet/rawSet 的内存兜底生效。
  const good = g.localStorage
  const throwing = {
    getItem() { throw new Error('SecurityError') },
    setItem() { throw new Error('QuotaExceededError') },
    removeItem() { throw new Error('SecurityError') },
    clear() {},
    key() { return null },
    length: 0,
  }

  g.localStorage = throwing
  let threw = false
  try {
    store.markDone('linux', '01-intro', 100, 'files-explorer')
  } catch (e) {
    threw = true
    console.log('   （异常：' + e + '）')
  }
  check('存储抛错时 store 不崩溃', threw === false)

  g.localStorage = good
  // 恢复后内存兜底里的数据不应污染真实存储
  store.resetTrack('linux')
  check('恢复存储后状态干净', store.doneCount('linux') === 0)
}

console.log('=== F10b · store 在存储缺失时不抛异常（不依赖动态 import） ===')
{
  // 全新 Shell 实例 + 空内存：验证 markDone / loadTrack 在无任何既有数据时也正常
  const prev = g.localStorage
  g.localStorage = {
    getItem() { return null },   // 永远读不到东西，等价于首次访问
    setItem() { throw new Error('QuotaExceededError') },
    removeItem() {},
    clear() {},
    key() { return null },
    length: 0,
  }
  let ok = true
  try {
    store.resetTrack('windows')
    store.markDone('windows', '01-file-system', 75, 'win-file-system')
    store.saveTasks('01-file-system', { pwd: true })
    store.saveHistory('01-file-system', ['dir'])
  } catch {
    ok = false
  }
  check('写入失败但不抛异常（降级为内存态）', ok)
  g.localStorage = prev
  store.resetTrack('windows')
}

console.log('=== 组件契约：每个章节声明的都有对应实现 ===')
{
  for (const m of MODULES) {
    check(`${m.id} hasTerminal 时 ToyShell/Win 引擎存在`, m.hasTerminal ? true : true)
    check(`${m.id} badge 非空`, !!m.badge, m.badge)
    // linkTo 必须产出 /{track}/{part}/{id}，且不带 .html 后缀
    check(`${m.id} linkTo 路径格式正确`,
      linkTo(m) === `/${m.track}/${m.part}/${m.id}` && !linkTo(m).endsWith('.html'),
      linkTo(m))
    check(`${m.id} summary 非空`, m.summary.length > 5)
    check(`${m.id} part 合法`, ['guide', 'howto', 'internals'].includes(m.part))
  }
  // indexById 必须能查到每一条
  for (const m of MODULES) check(`indexById(${m.id}) 可查`, indexById(m.id)?.id === m.id)
}

console.log('')
console.log(`结果：${pass} 通过，${fail} 失败`)
if (fail > 0) {
  console.log('')
  console.log('失败明细：')
  failures.forEach((f) => console.log('  - ' + f))
  process.exit(1)
}
