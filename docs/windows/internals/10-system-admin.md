---
title: 计划任务、事件日志与环境变量
description: schtasks 与 Register-ScheduledTask 的区别，事件日志的过滤写法。
---

# 计划任务、事件日志与环境变量

> 读完你会建一个能真正跑起来的计划任务，并且知道「任务没执行」时该去看哪几行事件 —— 以及为什么 `schtasks` 建的脚本总是找不到 `python`。这一章大约 32 分钟。

<ModuleMeta module-id="10-system-admin" />

::: danger 改这三样之前先导出
- **计划任务**：`schtasks /query /tn "名字" /xml > C:\Temp\task.xml` 存下完整定义
- **事件日志**：`wevtutil epl System C:\Temp\System-备份.evtx` 存下日志副本
- **环境变量**：`reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" > C:\Temp\machine-env.txt` 存下当前值

前两样导出后能用命令还原。第三样**只能用这个办法兜底** —— `setx` 覆盖 `PATH` 之后没有任何撤销手段。
:::

## 前置条件

**确认你的身份 —— 计划任务和事件日志的操作大部分要管理员权限。**

```cmd
net session >nul 2>&1 && echo 管理员 || echo 普通用户
```

你应该看到其中一个。普通用户只能管自己的任务。

建一个练习目录，把待执行的脚本放进去：

```cmd
mkdir C:\Temp\task
@echo off
echo 任务运行于 %DATE% %TIME%> C:\Temp\task\last-run.txt
```

用记事本写第二行也行，只要 `C:\Temp\task\last-run.txt` 能被生成就算成功。

**这个脚本刻意用绝对路径** —— 原因是本章第 1 节要讲的那件事。

确认任务计划程序服务在跑：

```cmd
sc query Schedule
```

你应该看到 `STATE : 4 RUNNING`。不是 RUNNING 就所有任务操作都会失败。

## 1. `schtasks`：能用，但有两个必须知道的限制

```cmd
schtasks /create /tn "练习任务" /tr "cmd /c C:\Temp\task\run.cmd" /sc daily /st 10:00 /f
```

你应该看到「任务已成功注册」。`/f` 是覆盖已存在的同名任务，没有它会问确认。

参数对照：

| 意图 | 参数 | 说明 |
| --- | --- | --- |
| 任务名 | `/tn "名字"` | 建议加引号 |
| 要执行的命令 | `/tr "命令"` | ⚠️ 有长度上限，见下 |
| 重复周期 | `/sc daily` | 见下表 |
| 开始时间 | `/st 10:00` | 24 小时制，本地时区 |
| 覆盖 | `/f` | 自动化必需 |
| 以谁的身份跑 | `/ru SYSTEM` | 不需要密码 |
| 以某用户跑 | `/ru "DOMAIN\user" /rp 密码` | ⚠️ 密码明文在命令行 |
| 立即试跑一次 | `/run /tn "名字"` | 不用等计划时间 |
| 看详细结果 | `/query /tn "名字" /v /fo LIST` | 看「上次运行结果」 |
| 停掉正在跑的实例 | `/end /tn "名字"` | |
| 删除 | `/delete /tn "名字" /f` | ⚠️ |

周期种类：

| `/sc` | 含义 |
| --- | --- |
| `once` | 只跑一次，配 `/sd` 指定日期 |
| `daily` | 每天 |
| `weekly` / `monthly` | 每周 / 每月，要配 `/d` |
| `onstart` | 开机时 |
| `onlogon` | 用户登录时 |
| `onidle` | 空闲时，要配 `/mo` |

::: danger `/tr` 有 262 字符的长度上限
`schtasks /create` 的 `/tr` 参数超过一定长度就会被截断或直接报参数错误。**这个上限来自任务计划程序本身的字段定义，不是 `schtasks` 的随意限制**，所以用 `Register-ScheduledTask` 建长命令同样绕不开。

正确做法是把逻辑放进脚本，`/tr` 只留一条短命令：

```cmd
schtasks /create /tn "练习任务" /tr "cmd /c C:\Temp\task\run.cmd" /sc daily /st 10:00 /f
```

`cmd /c` 这个包装符也省不掉 —— 不加的话任务计划程序不会用命令解释器去解析，直接把整串当可执行文件名。
:::

::: warning 默认情况下，用户没登录任务就不会跑
不指定 `/ru` 时，任务以**创建它的那个用户的交互式会话**身份运行。用户注销之后，任务**不执行**。

症状是任务显示「上次运行时间」是空、或者上次结果不是 0 也不是明确错误，而是：

```text
上次运行结果: 0x41303
```

`0x41303` 的含义是「任务已计划但尚未运行」。**这不是失败，是压根没轮到它跑** —— 因为创建任务的用户当时没登录。

两个解法：

```cmd
:: 用 SYSTEM 身份，不需要密码
schtasks /create /tn "练习任务" /tr "cmd /c C:\Temp\task\run.cmd" /sc daily /st 10:00 /ru SYSTEM /f
```

或者用 PowerShell 的 `S4U` 登录类型（见第 2 节）。**S4U 不用存密码，但也没有网络资源访问权限** —— 要访问共享的任务不能用 S4U。
:::

### 任务里找不到命令：环境变量问题

**这是计划任务最常见的失败原因，而且报错信息完全不提环境变量。**

```cmd
schtasks /create /tn "跑python" /tr "python --version > C:\Temp\task\py.txt" /sc daily /st 10:00 /f
schtasks /run /tn "跑python"
```

过一会儿看 `C:\Temp\task\py.txt`：**文件根本不存在。** 去事件日志里看，「上次运行结果」是 `0x1` 或者干脆没记录。

原因是**任务计划程序启动进程时给的环境变量是一套精简的固定值，不继承你当前命令行会话的 `Path`。** 你交互式能敲 `python`，任务里就找不到。

修法只有一个 —— **全部用绝对路径**：

```cmd
schtasks /create /tn "跑python" /tr "\"C:\Python312\python.exe\" -c \"print(1)\" > C:\Temp\task\py.txt" /sc daily /st 10:00 /ru SYSTEM /f
```

先确认 `python.exe` 到底在哪：

```cmd
where python
```

::: tip 相对路径同样不可靠
`/tr "run.cmd"` 里的相对路径是**相对于系统目录**（通常是 `C:\Windows\System32`）解析的，不是相对于脚本所在目录。这条规则在文档里容易被忽略，表现是「手动双击能跑，任务里找不到文件」。
:::

## 2. `Register-ScheduledTask`：能设更细，也更能表达意图

| 能力 | `schtasks` | `Register-ScheduledTask` |
| --- | --- | --- |
| 表达触发器（登录/启动/自定义） | 基础 | 完整对象模型 |
| 运行身份 | `/ru` + 密码 | `Principal.LogonType` |
| 登录类型的选择 | 少 | `S4U`、`ServiceAccount`、`InteractiveOrPassword` 等 |
| 多实例策略 | 只能选一个 | `MultipleInstances` |
| 空闲停止 / 电池策略 | 不支持 | 支持 |
| 导出 / 导入 | XML 只能看，不能导入 | `Export-ScheduledTask` / `Import-ScheduledTask` |
| 跨版本可用 | Win7+ | 需要 ScheduledTasks 模块 |

```powershell
$a = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument '/c C:\Temp\task\run.cmd'
$t = New-ScheduledTaskTrigger -Daily -At 10:00am
$p = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount
Register-ScheduledTask -TaskName '练习任务' -Action $a -Trigger $t -Principal $p -Force
```

你应该看到 `练习任务` 已注册。

::: tip 备份和还原都用 cmdlet
```powershell
Export-ScheduledTask -TaskName '练习任务' -OutFile C:\Temp\task-backup.xml
Register-ScheduledTask -TaskName '练习任务还原' -Xml (Get-Content C:\Temp\task-backup.xml -Raw)
```

**导出的 XML 包含所有触发器、身份、设置 —— 这是计划任务唯一的完整备份形式。** `schtasks /query /xml` 只能看不能导入。
:::

::: warning `S4U` 不给网络资源访问权限
`New-ScheduledTaskPrincipal -LogonType S4U` 的含义是「以该用户身份运行，**不存密码**」。代价是**这个任务访问不到网络共享和网络驱动器**。

所以：跑本地计算的任务可以用 S4U；要访问 `\\fileserver\share` 的任务必须用存密码的登录类型，或者干脆用 SYSTEM（SYSTEM 访问共享用的是机器账户，权限是另一套）。
:::

看结果：

```powershell
Get-ScheduledTask -TaskName '练习任务' | Get-ScheduledTaskInfo |
  Select-Object LastRunTime, LastTaskResult, NextRunTime
```

你应该看到 `LastRunTime`、`LastTaskResult`（就是那个十六进制码）和 `NextRunTime`。

| `LastTaskResult` | 含义 |
| --- | --- |
| `0x0` | 成功 |
| `0x1` | 一般性失败 |
| `0x2` | 找不到文件 |
| `0x41301` | 任务当前正在运行 |
| `0x41303` | 任务已计划但从未运行（通常是身份问题） |
| `0x80070005` | 访问被拒绝 |

`TODO：待补充` —— 完整的错误码表建议以目标系统上 `schtasks /query` 的实际输出为准，不同构建版本会有额外码。

## 3. 事件日志：先过滤，再读

**日志可能有几万条。`Get-WinEvent` 一次读进来几万个事件会卡住，所以过滤是必须的。**

```powershell
Get-WinEvent -LogName System -MaxEvents 20 | Select-Object TimeCreated, Id, ProviderName, Message
```

你应该看到最近 20 条系统日志。

级别数字对应关系（写过滤条件时要用数字）：

| 级别 | 数字 | 名称 |
| --- | --- | --- |
| 严重 | 1 | Critical |
| 错误 | 2 | Error |
| 警告 | 3 | Warning |
| 信息 | 4 | Information |
| 详细 | 5 | Verbose |

### `-FilterHashtable` 比管道过滤快一个数量级

**这两条查同样的东西，耗时差很多：**

```powershell
# 慢：先读出来再在内存里筛
Get-WinEvent -LogName System -MaxEvents 1000 | Where-Object { $_.LevelDisplayName -eq '错误' }

# 快：让日志引擎去筛
Get-WinEvent -FilterHashtable @{ LogName='System'; Level=2; StartTime=(Get-Date).AddDays(-1) }
```

`-FilterHashtable` 直接下推给日志提供程序，只返回匹配的条目。**排查生产问题时这个差别决定你是 2 秒出结果还是 2 分钟。**

可用的过滤键：

| 键 | 例子 |
| --- | --- |
| `LogName` | `System`、`Application`、`Microsoft-Windows-WinRM/Operational` |
| `Level` | `2` 或 `1,2`（逗号表示「或」） |
| `Id` | `7000,7001` |
| `ProviderName` | `Service Control Manager` |
| `StartTime` | `(Get-Date).AddHours(-1)` |
| `EndTime` | `(Get-Date)` |

```powershell
Get-WinEvent -FilterHashtable @{ LogName='System'; Id=7000; StartTime=(Get-Date).AddDays(-7) } |
  Select-Object TimeCreated, Message
```

你应该只看到服务启动失败的事件。

::: warning 查不到事件时 PowerShell 会报错而不是返回空
`Get-WinEvent` 在没有任何匹配结果时**抛出异常**，报「未找到与选择器「...」匹配的事件」。**这是错误，不是空结果。**

自动化里要加 `-ErrorAction SilentlyContinue`：

```powershell
$e = Get-WinEvent -FilterHashtable @{ LogName='System'; Id=7000 } -MaxEvents 5 -ErrorAction SilentlyContinue
if ($e) { $e | Select-Object TimeCreated, Message } else { "最近没有 7000 事件" }
```

**不处理这个的话，脚本在没有错误发生的正常情况下也会失败。**
:::

### `-MaxEvents` 默认从最新开始

`-MaxEvents 20` 拿的是**最近的** 20 条。要拿最早的那些加 `-Oldest`：

```powershell
Get-WinEvent -LogName Application -Oldest -MaxEvents 20
```

**日志是个环形缓冲区，写满了会覆盖最旧的记录。** 要留存就导出成文件，导出的是快照：

```cmd
wevtutil epl System C:\Temp\System-20261004.evtx
```

**导出和清空是两件事。** 清空会让后续排查失去现场：

```cmd
wevtutil cl System
```

::: danger 生产机器上不要清日志
清空日志会破坏审计链，也会让「问题什么时候开始的」这个问题永远无法回答。需要腾空间就归档后清，**或者干脆别清 —— 事件日志默认大小可调，而 `wevtutil cl` 之后历史就没了。**
:::

CMD 侧读日志：

```cmd
wevtutil qe System /c:20 /rd:true /f:text | findstr /i "服务名"
```

`/rd:true` 是倒序（最新在前），`/c:20` 取 20 条。

### 服务起不来时看哪几行

服务相关的日志在 **System** 日志，来源是 `Service Control Manager`。**按事件 ID 定位比读文字快得多。**

```powershell
Get-WinEvent -FilterHashtable @{ LogName='System'; ProviderName='Service Control Manager'; Id=7000,7001,7009,7011,7031,7034,7036,7040 } -MaxEvents 15 |
  Select-Object TimeCreated, Id, Message
```

这几个 ID 的含义：

| 事件 ID | 含义 | 通常的根因 |
| --- | --- | --- |
| 7000 | 服务启动失败并给出了错误码 | 看消息里的错误码 |
| 7001 | **某个依赖服务起不来** | 先去看那个依赖服务 |
| 7009 / 7011 | 等服务连接超时 | 服务进程没起来或卡在启动中 |
| 7031 / 7034 | 服务意外终止（多次） | 反复崩溃，看应用日志 |
| 7036 | 服务状态改变 | 正常记录，用来对时间线 |
| 7040 | **启动类型被改了** | 有人在改配置 |

**7000 的消息里带一个数字错误码**，它和 [进程与服务](/windows/howto/05-process-service) 里查到的失败点是同一个。`1075`（服务账户和密码错）、`1069`（服务没启动过）、`2`（文件找不到）是最常出现的几个。

## 4. 环境变量：三个作用域，以及 `setx` 的陷阱

```cmd
echo %PATH%
set
```

```powershell
$env:PATH
[Environment]::GetEnvironmentVariable('Path','Machine')
[Environment]::GetEnvironmentVariable('Path','User')
Get-ChildItem Env: | Sort-Object Name
```

| 作用域 | 存在哪 | 影响谁 | 改法 |
| --- | --- | --- | --- |
| 进程 | 只在当前进程内存里 | 只有当前这个窗口 | `set X=1` |
| 用户 | `HKCU\Environment` | 之后启动的该用户进程 | `[Environment]::SetEnvironmentVariable('X','1','User')` |
| 系统 | `HKLM\...\Session Manager\Environment` | 之后启动的所有用户的进程 | 同上，`'Machine'` |

::: warning 改用户/系统变量不影响已经在跑的进程
`setx` 和 `SetEnvironmentVariable(..., 'Machine')` 写的是注册表，**但已经在运行的进程保留着启动时读到的旧值**。

所以改完 `PATH` 之后，**当前这个命令行窗口里 `python` 还是找不到**，必须新开一个窗口。这是「明明改了却没生效」的标准答案 —— 不是没改成功，是没有进程会去重新读它。
:::

::: danger `setx` 改 `PATH` 是不可逆的
`setx` 有两个特性加在一起非常危险：

1. **有 1024 字符的长度限制，超出会被静默截断**
2. **它读的是当前进程的环境变量**，而当前进程看到的是用户 `PATH` 和系统 `PATH` 合并后的结果

`setx PATH "新值"` 的实际后果经常是：**系统 `PATH` 变成一个残缺的短字符串，整台机器的程序都找不到。** 而且没有任何撤销手段，除非你事先导出了原值。

正确做法是直接读写注册表里的真实值，不经过 `setx`：

```powershell
$key = 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Environment'
reg export 'HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment' C:\Temp\machine-env.txt /y
$p = [Environment]::GetEnvironmentVariable('Path','Machine')
[Environment]::SetEnvironmentVariable('Path', $p + ';C:\Tools\bin', 'Machine')
```

**先导出，这一步不能省。** 系统 `PATH` 被截断过的机器，症状是服务起不来、登录脚本不执行、任务计划任务全部失败 —— 而且很难联想到是 `PATH` 的问题。
:::

::: warning `setx` 还会展开变量
`setx NEW "值是%PATH%"` 存进去的是**展开后的结果**，不是字面的 `%PATH%`。想在环境变量值里保留一个变量引用，用 `[Environment]::SetEnvironmentVariable` 配合 `REG_EXPAND_SZ` 语义，或者用 `reg add` 显式指定类型。
:::

## 排障

**Q1：计划任务完全没执行，`last-run.txt` 不存在？**

按这个顺序查，不要跳步：

1. `schtasks /query /tn "名字" /v /fo LIST` —— 看「上次运行结果」和「上次运行时间」
2. `0x41303` 说明创建任务的用户当时没登录 → 改用 `/ru SYSTEM` 或 S4U
3. 脚本里的命令全改成绝对路径 —— 任务环境变量是精简的
4. `schtasks /run /tn "名字"` 手动触发一次，再看结果有没有变
5. 事件日志里查应用错误

**Q2：任务执行了但没输出，也没错误？**

1. 加显式重定向：`/tr "cmd /c script.cmd > C:\Temp\out.txt 2>&1"`
2. 确认脚本第一行是 `@echo off` 之外的正常内容 —— 用 `cmd /c` 包装符确认能被解释
3. 查权限 —— SYSTEM 身份和你的用户身份能读写的路径不同
4. 查工作目录 —— 相对路径基于 `C:\Windows\System32`

**Q3：事件日志查不到想要的东西？**

1. `Get-WinEvent -ListLog * | Select-Object LogName, IsEnabled` —— 确认日志存在且已启用
2. 确认日志源（`ProviderName`）对不对 —— 服务在 System，应用程序在 Application
3. 扩大时间范围 —— 先不加 `StartTime` 试试
4. 加 `-ErrorAction SilentlyContinue` —— 查不到是抛错不是返回空

**Q4：改了环境变量，程序还是找不到？**

1. 新开一个命令行窗口 —— 当前窗口不会重新读
2. `echo %PATH%` 确认新值真的在里面
3. 检查是不是被截断了 —— `reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v Path`
4. 服务完全不认新 `PATH` —— **服务读取环境变量是在启动时做的，要重启服务**

**Q5：服务起不来，事件日志里 7000 显示一个看不懂的错误码？**

1. `sc query 服务名` —— 确认状态和是否在等
2. `sc qc 服务名` —— 看依赖、启动类型、账户、二进制路径
3. 查 7001 事件 —— 依赖服务起不来
4. 查 7040 事件 —— 启动类型是不是被人改了
5. 直接在命令行手动跑一遍服务对应的可执行文件，看报什么错

## 什么时候别用

**计划任务不是「什么时候跑一下」的通用调度器。**

| 别用 | 换成 | 原因 |
| --- | --- | --- |
| 频率低于每几分钟的循环 | 常驻服务 / 计划任务 + 队列 | 任务计划程序有最小间隔和执行开销 |
| 需要读写大量文件的任务 | 批处理或专门的 ETL 工具 | 单次任务的执行上下文很受限 |
| 集群、多机的调度 | 外部调度器 | 任务计划程序只管本机 |
| 依赖多步前序步骤成功 | 幂等脚本 + 自己的重试 | 任务计划程序没有条件依赖 |
| 高精度定时（秒级） | 专门的调度服务 | 任务计划程序有分钟级的粒度和延迟 |

::: warning 任务的执行没有事务性
一个任务里的五步，第三步失败，前两步的改动**不会回滚**。重试时前两步会再执行一遍。

所以**任务调用的脚本必须幂等** —— 重复执行不产生额外影响。这不是风格问题，是重试机制决定的硬要求。
:::

::: danger 别用任务计划程序做权限提升
`/ru SYSTEM` 加上一个攻击者能改的脚本路径，等于一个提权入口。**任何 SYSTEM 任务引用的脚本和它引用的文件，权限都要收紧到只有管理员能写。** 同理，用户能写的目录（`C:\Users\...\Desktop`、`C:\Temp`）绝不能出现在 SYSTEM 任务的执行路径里。
:::

**环境变量也别当配置存储用。** 一个几十项的配置塞进 `PATH` 或者自定义变量里，迟早会撞上长度限制、类型只能是字符串、没法安全地并发读写。放配置文件，见 [注册表：改之前先导出](/windows/internals/09-registry) 末尾关于「不要把注册表当配置库」的那一节。

## 哪些是通用的

**「定时执行 + 出问题查日志」这个模式换平台一样。**

| 这里学的 | Linux 上对应 |
| --- | --- |
| 计划任务 | `systemd timer` / `cron` |
| `schtasks /create` | `crontab -e` |
| SYSTEM 身份 | 以 root 运行 |
| `LastTaskResult` | 任务的退出码 / `systemctl status` |
| 事件日志 | `journalctl` / `/var/log/` |
| 过滤日志 | `journalctl -u 服务名 --since` |
| `wevtutil epl` 导出 | `journalctl > file` |
| 事件级别 1-5 | syslog 的 emerg/err/warn/notice/info |
| 环境变量 | `export` / `/etc/environment` |

**明确不通用的部分：**

- **环境变量的继承**。Linux 的 cron 也给一套最小环境，所以「cron 里找不到命令」在两边是同一个坑。但 Windows 这边的最小化程度更隐蔽 —— 错误信息完全不提这件事
- **任务的重新运行语义**。`systemd timer` 的 `Persistent=` 概念在 `schtasks` 里没有对应物；错过的触发不会补跑
- **日志结构化程度**。Linux 上有 `journalctl -o json` 能拿到结构化字段，Windows 事件日志的过滤只能按固定的那几个键
- **身份模型**。`systemd` 的 `User=`、`DynamicUser=`、`PrivateTmp=` 是一组隔离选项，Windows 侧没有等价物（Session 0 隔离是内核级的，不给用户级配置）
- **时区与夏令时**。两边都有这个问题，但 Windows 的 `schtasks` 在时区变化后对 `/st` 的处理不会给你任何提示

## 跑完之后

下一章讲**WinRM 与远程会话**：怎么在两台 Windows 之间开一个远程 PowerShell，凭据怎么给，以及工作组的机器为什么默认连不上。

→ [WinRM 与远程会话](/windows/internals/11-remote)

## 📝 配套练习

<QuizBlock module-id="10-system-admin" />
