---
title: 进程与服务：两套不同的管理模型
description: 进程和服务不是一回事，tasklist / Get-Process 与 sc / Get-Service 各管一层。
---

# 进程与服务：两套不同的管理模型

> 读完你会遇到「服务没起来」时知道该去查服务列表还是进程列表，以及为什么你在任务管理器里结束了进程，服务却自己回来了。这一章大约 28 分钟。

<ModuleMeta module-id="05-process-service" />

## 前置条件

**先分清你在看哪一层，这决定后面所有命令选哪一套。**

```cmd
tasklist /fi "imagename eq lsass.exe"
```

你应该看到一行 `lsass.exe` 和它的 PID。

在 PowerShell 里：

```powershell
Get-Process | Select-Object -First 3 Id, ProcessName
```

**判断依据很简单：服务由系统代为启动和保活，进程是启动后的一次运行。** `lsass.exe`、`services.exe`、`svchost.exe` 这些是服务的宿主进程 —— 任务管理器里能看到它们，但你不该用「结束进程」的方式去管理它们。

改服务配置需要管理员权限，先确认：

```powershell
([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
```

你应该看到 `True`。`False` 的话本章第 3 节会全部报「拒绝访问」。

## 1. 进程层：看谁在跑

| 意图 | CMD | PowerShell | 是否改动数据 |
| --- | --- | --- | --- |
| 列出全部进程 | `tasklist` | `Get-Process` | 否 |
| 只看某个进程 | `tasklist /fi "imagename eq node.exe"` | `Get-Process -Name node` | 否 |
| 导出成 CSV | `tasklist /fo csv` | `Get-Process \`\|`<br>Select-Object Id,ProcessName \`\|`<br>Export-Csv p.csv` | ⚠️ 新建文件 |
| 看 CPU / 内存 | `tasklist` 底部内存列 | `Get-Process \`\|`<br>Sort-Object WS -Descending` | 否 |

```cmd
tasklist /fo csv /nh | findstr /i "node"
```

你应该看到一行形如 `"node.exe","6344","Console","1","198,656 K"`。

PowerShell 里等价且更好用的写法：

```powershell
Get-Process | Where-Object { $_.ProcessName -like '*node*' }
```

应该看到 `node` 和它的 `Id`、`WS`（工作集内存）。

::: warning `Get-Process` 读某些进程的属性会抛「拒绝访问」
遍历所有进程并访问 `.Path` 时，别的用户或系统账户拥有的进程会报访问被拒。用 `-ErrorAction SilentlyContinue` 压掉，或者只查自己关心的：

```powershell
Get-Process | Select-Object Id, ProcessName, @{n='MB';e={[math]::Round($_.WS/1MB,1)}} -ErrorAction SilentlyContinue
```

`@{n=...;e=...}` 这种写法叫**计算属性**，给计算结果起个名字，管道下游看到的就是 `MB` 列 —— 这比 `.WS` 可读得多。
:::

### 找进程的父进程：谁把它拉起来的

**进程列表不会告诉你「谁启动了我」，但 CIM 能问。**

```powershell
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Select-Object ProcessId, ParentProcessId, CommandLine
```

你应该看到 `ProcessId`、`ParentProcessId` 和完整命令行。拿 `ParentProcessId` 再查一次就能一路上溯到 `explorer.exe` 或某个服务宿主。

```powershell
$pid2 = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Select-Object -First 1 -ExpandProperty ParentProcessId
Get-CimInstance Win32_Process -Filter "ProcessId=$pid2" | Select-Object Name, CommandLine
```

这里 `ParentProcessId` 是**创建时的父进程**。父进程退出后子进程会被系统重新挂到别的父进程下，所以「重启后行为不同」是正常的。

::: warning `wmic` 已被弃用
`wmic process get ...` 在较新的 Windows 版本上被标记弃用，可能需要额外的功能开关才能用。**新写的脚本一律用 `Get-CimInstance`**，它读的是同一套 WMI/CIM 数据但不依赖 `wmic.exe`。存量脚本里看到 `wmic` 的，换掉。
:::

## 2. 结束进程

| 意图 | CMD | PowerShell | 是否改动数据 |
| --- | --- | --- | --- |
| 温和结束 | `taskkill /PID 1234` | `Stop-Process -Id 1234` | ⚠️ 结束进程 |
| 强制结束 | `taskkill /PID 1234 /F` | `Stop-Process -Id 1234 -Force` | ⚠️⚠️ 数据会丢 |
| 连子进程一起结束 | `taskkill /PID 1234 /T /F` | 无直接对应，需查子 PID 循环 | ⚠️⚠️ |
| 按名字结束 | `taskkill /IM node.exe /F` | `Stop-Process -Name node -Force` | ⚠️⚠️ |
| 先看会结束谁 | 无 | `Stop-Process -Id 1234 -WhatIf` | 否 |

```cmd
taskkill /PID 6344 /F
```

你应该看到：

```text
成功: 已终止进程 "PID 6344"（强制）。
```

::: danger `/F` 和 `Stop-Process -Force` 会丢数据
强制结束不给目标程序保存的机会。Excel 里有未保存内容、数据库事务未提交、编辑器有未保存文件 —— 都会丢。

`-Force` 在 PowerShell 里的字面意思是「忽略提示和只读属性」，它**不影响是否优雅退出**。`Stop-Process` 无论有没有 `-Force` 都是强制结束，PowerShell 没有 CMD 那种「先温和再强制」的自动升级。
:::

### 「结束进程」治不好「服务停止」

**这是本章最值得记住的一条：结束服务宿主进程，服务通常会自己回来。**

`sc query W32Time` 看服务状态，假设是 `STOPPED`。你在任务管理器里结束 `svchost.exe` 之后再看，服务还是 `STOPPED`，但如果它原本是 `RUNNING`，服务管理器会按**故障恢复设置**在延时后重新拉起它。

反过来，如果你想彻底禁用一个反复自己启动的服务，正确做法是改启动类型：

```cmd
sc config W32Time start= disabled
```

**注意 `start=` 后面那个空格 —— `sc` 要求等号和值之间必须有一个空格。** 写成 `start=disabled` 会报：

```text
SC OpenService FAILED 1062:
服务尚未启动。
```

或者参数错误。这条 `sc` 的语法要求在帮助里写得很不清楚，是最容易踩的一个格式坑。

PowerShell 里没有这个空格问题：

```powershell
Set-Service -Name W32Time -StartupType Disabled
```

::: warning 改启动类型前先导出当前配置
`sc qc 服务名` 的输出是完整的当前配置（启动类型、依赖、账户、二进制路径）。**先把它存下来**：

```cmd
sc qc W32Time > C:\Temp\wt-time-before.txt
```

恢复时照着改回去。这是本章第 4 节说的「改之前先备份」原则在服务上的应用。改二进制路径或账户出问题时，你不会想靠记忆复原。
:::

## 3. 服务层：它和进程不是一回事

| 意图 | CMD | PowerShell | 是否改动数据 |
| --- | --- | --- | --- |
| 列出服务 | `sc query type= service state= all` | `Get-Service` | 否 |
| 查一个服务 | `sc query W32Time` | `Get-Service W32Time` | 否 |
| 看配置与依赖 | `sc qc W32Time` | `Get-Service W32Time \`\|`<br>Format-List *` | 否 |
| 启动 | `sc start W32Time` | `Start-Service W32Time` | ⚠️⚠️ 改系统状态 |
| 停止 | `sc stop W32Time` | `Stop-Service W32Time` | ⚠️⚠️ 改系统状态 |
| 重启 | 无（要连着敲两条） | `Restart-Service W32Time` | ⚠️⚠️ |
| 改启动类型 | `sc config X start= auto` | `Set-Service X -StartupType Automatic` | ⚠️⚠️⚠️ |
| 看宿主进程 | `tasklist /svc /fi "services eq W32Time"` | `Get-CimInstance Win32_Service -Filter "Name='W32Time'"` | 否 |

```powershell
Get-Service | Where-Object { $_.Status -eq 'Running' } | Select-Object -First 5 Name, DisplayName
```

你应该看到 5 个运行中的服务。

筛选服务时**通配符要加引号**：

```powershell
Get-Service -Name 'W32*'
```

不加引号时 PowerShell 的参数解析和 CMD 的通配符展开会打架，行为不可预期。加引号是安全写法。

### 启动类型有五种，只记三个常用的

| 启动类型 | CMD 关键字 | PowerShell 枚举 | 含义 |
| --- | --- | --- | --- |
| 自动 | `auto` | `Automatic` | 开机启动 |
| 手动 | `demand` | `Manual` | 有人调用时才起，**默认值** |
| 已禁用 | `disabled` | `Disabled` | 不起，且其他服务也调不动它 |
| 自动（延迟） | `delayed-auto` | `Automatic`（+ DelayedAuto 标记） | 开机后等网络起来再启动 |
| 系统 | `system` | `System` | 由系统内核启动 |

::: warning 新装的服务默认是「手动」而不是「自动」
很多人以为装完就是开机自启。实际上**大多数服务装完是 Manual，靠依赖关系被拉起来**。你手动启动一次并勾选了「自动」才变成 Auto。所以「服务没自启」不一定是要设成自动，可能你该做的是把它依赖的那个服务修好 —— 看 `sc qc` 的 `DEPENDENCIES` 行。
:::

### `sc stop` 是异步的

`sc stop` 立刻返回成功，但服务实际可能几秒后才真的停。脚本里连着 `sc stop` 然后 `sc start`，会撞上「服务正在停止」。

```powershell
Stop-Service W32Time
(Get-Service W32Time).WaitForStatus('Stopped', [TimeSpan]::FromSeconds(30))
```

`Restart-Service` 默认就会等依赖服务和自身都到稳态，不用自己写等待。

### 服务依赖：起不来的最常见原因

```cmd
sc qc SqlServerMSSQLServer
```

你应该看到 `DEPENDENCIES` 那一行列着它依赖的服务名（比如 `RPCSS`、`NT AUTHORITY\...`）。**依赖的任意一个没运行，它就起不来，而且错误信息通常很含糊。**

```powershell
Get-Service -Name SqlServerMSSQLServer | Select-Object -ExpandProperty DependentServices
```

这条反过来列出「哪些服务依赖它」—— 停它之前先看这个。

::: danger `Stop-Service` 默认会连依赖服务一起停
`Stop-Service -Name X` 会在 `X` 停了之后把**依赖 X 的那些服务**也停掉（依赖方向和服务依赖方向容易搞反，建议对着 `sc qc` 的 `DEPENDENCIES` 确认一遍谁在上游）。

`Restart-Service -Force` 的 `-Force` 做的正是这件事。要只停一个、不动别人，必须先自己算清依赖顺序。生产环境停数据库这类操作前，先把影响面列出来。
:::

## 4. 服务跑在 Session 0：两个由此产生的怪事

**所有服务都运行在会话 0，用户会话是 1 及以上。这个隔离带来两个非常反直觉的后果。**

### 服务里的程序弹不出窗口

服务进程启动 GUI 程序时，窗口会直接失败或立刻消失，不是因为程序崩了，是因为**会话 0 隔离**让 GUI 没有可显示的桌面。

```powershell
Get-Process | Where-Object { $_.SessionId -eq 0 }
```

你应该看到一批 `svchost` 之类的系统进程。

所以「服务启动时报 GUI 相关的错」的排查方向是：这个服务本来就不该弹界面。

### LocalSystem 用机器账户访问网络共享

服务默认以 **LocalSystem** 账户运行。用它访问网络共享时，用的是**机器账户**（`DOMAIN\COMPUTERNAME$`），不是你的账户。

| 服务账户 | 访问 `\\fileserver\share` 的身份 | 权限来源 |
| --- | --- | --- |
| LocalSystem | 机器账户 `PC$` | 通常对共享有权限 |
| NetworkService | 机器账户（受限） | 通常没有 |
| LocalService | 匿名 | 基本没有 |
| 专用域账户 | 该域用户 | 该用户权限 |

```powershell
Get-CimInstance Win32_Service | Where-Object { $_.State -eq 'Running' -and $_.StartName -eq 'LocalSystem' } | Select-Object -First 5 Name, StartName
```

你应该看到一批 `StartName` 是 `LocalSystem` 的服务。

「服务访问不了共享，但手动用浏览器能打开」几乎都是这个原因 —— 手动用的是你的用户凭据，服务用的是机器凭据。**改服务账户等于改一整条凭据链，先确认机器账户有权限，再去改服务。**

## 排障

**Q1：服务「无法启动」，错误提示很含糊？**

按这个顺序查，不要跳步：

1. `sc query 服务名` —— 确认当前状态，`STOP_PENDING` 说明它正在停，等一下
2. `sc qc 服务名` —— 看 `DEPENDENCIES`，逐个 `sc query` 确认都在运行
3. `sc qc 服务名` 看 `START_TYPE` —— 是不是 `DISABLED`
4. 看 `BINARY_PATH_NAME` 指向的文件在不在 —— 服务二进制被清理软件删掉是最常见的一类
5. 事件查看器 → Windows 日志 → 系统，按服务名过滤，看 `Service Control Manager` 的记录

**Q2：我结束了进程，服务又自己起来了？**

1. `sc qc 服务名` —— 先记住它原本的启动类型和配置
2. `sc config 服务名 start= disabled` —— 断开自动拉起的源头
3. 想彻底删掉重启行为：`sc failure 服务名 reset= 0 actions= ""` ⚠️ 改之前先 `sc qc` 存档
4. 确认是不是某个依赖服务把它拉起来的

**Q3：`Stop-Service` 之后服务还在？**

1. `Get-Service 服务名` —— 看 `Status`，`StopPending` 就是还在停
2. 检查有没有进程还在占用该服务的资源（数据库端口、文件句柄）
3. `sc queryex 服务名` —— 看着状态从 `STOP_PENDING` 转成 `STOPPED`

**Q4：想改某个服务，但报「拒绝访问」？**

1. 确认当前是管理员 —— 见本章前置条件那条检查
2. 确认服务没在运行中 —— 部分配置项要求服务已停止
3. `sc qc 服务名` 存档当前配置，改完对比
4. 域策略可能覆盖 —— 提示「由策略覆盖」时本地改了会被刷回去

**Q5：任务管理器里找不到那个进程？**

1. `Get-CimInstance Win32_Process -Filter "Name='xxx.exe'"` —— 有些进程不在交互会话里
2. `Get-Process | Where-Object { $_.SessionId -eq 0 }` —— 确认是不是服务宿主
3. 任务管理器默认不显示其他用户的进程 —— 用管理员身份的任务管理器，或 `tasklist /v`

## 什么时候别用

**「结束进程」不是解决服务问题的手段，两者是不同的层。**

| 别用 | 换成 | 原因 |
| --- | --- | --- |
| 结束进程来停服务 | `Stop-Service` | 服务管理器会按恢复设置拉回来 |
| 结束进程来改配置 | `sc config` / `Set-Service` | 改进程不会改配置，下次启动照旧 |
| `taskkill /F` 处理有状态程序 | 先尝试温和停止 | `/F` 会丢未保存数据和未提交事务 |
| `Set-Service -StartupType Automatic` 解决启动问题 | 先查 `DEPENDENCIES` | 根因常常是依赖服务坏了 |
| 手工点任务管理器排查线上问题 | CIM 查询 | 手工操作不可复现、留不下记录 |

::: warning 改服务配置属于「机器会一直保持这个状态」的改动
不像临时命令，改完 `sc config` 之后每次开机都生效，域策略还可能随时覆盖。所以顺序永远是：**先 `sc qc` 导出当前状态 → 改 → 验证 → 记录怎么改回去**。没存档就改，出事时你只能靠猜。
:::

**也别用 PowerShell 去干 CMD 更擅长的那部分。** 遍历服务、格式化输出、跨机器比较 —— 这些用 `Get-Service` 的对象管道是明显优势。启动、停止、读 `sc qc` 的配置文本，`sc` 的输出反而更直接（它是本地化的，字段名一目了然）。

## 哪些是通用的

**「进程在跑，服务在管，两层要分清」换平台一样成立。**

| 这里学的 | Linux 上对应 |
| --- | --- |
| 进程列表 | `ps` / `top` |
| 结束进程 | `kill` / `kill -9` |
| 服务列表与状态 | `systemctl list-units` |
| 启停服务 | `systemctl start` / `stop` |
| 开机自启 | `systemctl enable` / `disable` |
| 服务依赖 | `systemctl list-dependencies` |
| 服务账户 | systemd unit 里的 `User=` |
| 服务起不来看日志 | `journalctl -u 服务名` |

**明确不通用的部分：**

- **会话隔离**。Windows 的 Session 0 是历史遗留的服务隔离机制，Linux 上服务不隔离会话，不存在「服务弹不出窗口」这个类别的问题
- **多个服务共享一个进程**。Windows 上服务通常以 `svchost.exe` 里的 DLL 形式运行，一个宿主进程装多个服务。这让「结束进程」的影响面比 Linux 上大得多
- **启动类型的粒度**。`systemd` 的 `enable` 语义和 Windows 的「自动 / 手动 / 禁用」不完全对应：Windows 的「手动」服务被依赖时会自动启动，这在 systemd 里对应 `static` 而不是一个独立的枚举值
- **故障恢复**。Windows 的服务有内建的「失败后重启」设置（`sc failure`），systemd 要靠 `Restart=` 加 `StartLimit*` 组合

## 跑完之后

下一章讲**网络诊断**：机器通不通、端口开没开、DNS 有没有解析 —— 三层问题各用哪条命令，以及为什么 `ping` 通不代表服务能用。

→ [网络诊断：从通不通到端口开没开](/windows/howto/06-network)

## 📝 配套练习

<QuizBlock module-id="05-process-service" />
