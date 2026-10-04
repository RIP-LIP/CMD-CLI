/**
 * Windows 线实战任务。
 *
 * 每条 check 同时接受 CMD 与 PowerShell 两种写法 ——
 * 这是 Windows 线的核心：同一条意图，两套语法。
 */

import type { WinTaskDef } from './shell-windows'

export const WINDOWS_TASKS: Record<string, WinTaskDef[]> = {
  '01-file-system': [
    {
      id: 'pwd',
      label: '查看当前所在目录（cd 或 Get-Location）',
      // 允许带参数：`cd C:\Users\MAX` 才是日常用法，`cd` 裸跑只是看当前目录
      check: (l) => /^\s*cd\b/i.test(l) || /^(get-location|gl|pwd)\s*$/i.test(l),
    },
    {
      id: 'dir',
      label: '列出目录内容（dir 或 Get-ChildItem）',
      check: (l) => /^\s*(dir|ls|gci|get-childitem)\b/i.test(l),
    },
    {
      id: 'mkdir',
      label: '创建 NewFolder 目录（md / mkdir / New-Item）',
      check: (l) => /^(md|mkdir|new-item|ni)\b.*NewFolder/i.test(l),
    },
    {
      id: 'type',
      label: '查看文件内容（type / Get-Content）',
      check: (l) => /^(type|cat|gc|get-content|more)\b/i.test(l),
    },
  ],

  '02-file-ops': [
    {
      id: 'copy',
      label: '复制文件（copy / Copy-Item / cp）',
      check: (l) => /^(copy|cp|copy-item)\b/i.test(l),
    },
    {
      id: 'move',
      label: '移动或重命名（move / ren / Move-Item）',
      check: (l) => /^(move|mv|ren|rename|move-item)\b/i.test(l),
    },
    {
      id: 'del',
      label: '删除文件（del / Remove-Item）',
      check: (l) => /^(del|erase|remove-item|rm)\b/i.test(l),
    },
    {
      id: 'mkdir',
      label: '新建目录（md / New-Item -ItemType Directory）',
      check: (l) => /^(md|mkdir|new-item|ni)\b/i.test(l),
    },
  ],

  '03-batch-script': [
    { id: 'echo', label: '用 echo 输出内容', check: (l) => /^\s*echo\b/i.test(l) },
    { id: 'set', label: '用 set 定义变量', check: (l) => /^\s*set\b\s*\w+=/i.test(l) },
    { id: 'if', label: '用 if 做条件判断', check: (l) => /^\s*if\b/i.test(l) },
    { id: 'goto', label: '用 goto 或 for 做循环跳转', check: (l) => /^\s*(goto|for)\b/i.test(l) },
    { id: 'call', label: '用 call 调用另一个批处理', check: (l) => /^\s*call\b/i.test(l) },
  ],

  '04-powershell-intro': [
    { id: 'gci', label: '用 Get-ChildItem 列出目录', check: (l) => /^(gci|ls|dir|get-childitem)\b/i.test(l) },
    { id: 'gc', label: '用 Get-Content 读文件', check: (l) => /^(gc|get-content|cat|type)\b/i.test(l) },
    { id: 'pipeline', label: '用管道把两条命令串起来', check: (l) => /\|/.test(l) },
    { id: 'where', label: '用 Get-Command 查命令对应的真实程序', check: (l) => /^(get-command|gcm|where)\b/i.test(l) },
    { id: 'help', label: '用 Get-Help 查用法', check: (l) => /^(get-help|help|man)\b/i.test(l) },
  ],
}
