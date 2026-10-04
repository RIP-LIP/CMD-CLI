---
title: 注册表：改之前先导出
description: 注册表路径缩写、常见键值类型，以及任何修改之前的备份动作。
---

# 注册表：改之前先导出

> 读完你会能读懂任何一个注册表路径，并且养成「先导出、再修改、最后验证」的习惯 —— 这一条习惯比本章任何命令都重要。这一章大约 30 分钟。

<ModuleMeta module-id="09-registry" />

::: danger 本章所有修改操作之前，先做导出
注册表没有回收站，没有撤销，没有文件级的恢复手段。写错了键名或值名，症状可能几周后才在别处冒出来，而且那时你不会再想到是注册表。

**动 `HKLM` 或 `HKCU` 之前先跑 `reg export`。** 本章每一条修改命令前面都已经带上了导出步骤，跳过它就等于放弃恢复能力。
:::

## 前置条件

**先确认权限和工具版本，因为下面一半的命令在普通用户下会直接失败。**

```cmd
reg query "HKCU\Software" /f "命令" /k
```

你应该能看到 `HKEY_CURRENT_USER\Software` 下的匹配项。

确认当前是不是管理员：

```powershell
([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
```

`False` 的话：**你能读 `HKLM`，但不能写。** 写 `HKLM` 会报「请求的操作需要提升」。`HKCU` 不需要管理员。

**确认你用的是 64 位的 `reg.exe`**，这一点比权限更容易出错：

```cmd
reg query "HKLM\SOFTWARE\Wow6432Node"
```

你应该能看到内容（说明 `Wow6432Node` 这个分支存在）。**如果你在改一个 32 位或 64 位软件的路径，而这里的查询结果为空或内容对不上，说明你用的 `reg.exe` 位数和你以为的不一样。**

```cmd
where reg
```

你应该看到第一个是 `%SystemRoot%\System32\reg.exe`。64 位系统上 `SysWOW64\reg.exe` 也存在，**它看到的是一份被重定向过的注册表视图**。

## 1. 五个根键和它们的缩写

| 缩写 | 全名 | 装什么 | 写要管理员吗 |
| --- | --- | --- | --- |
| `HKLM` | `HKEY_LOCAL_MACHINE` | 全机器的设置、驱动、服务、驱动级配置 | ⚠️ 要 |
| `HKCU` | `HKEY_CURRENT_USER` | 当前用户的设置、用户级软件配置 | 否 |
| `HKCR` | `HKEY_CLASSES_ROOT` | **不是真键**，见下 | ⚠️ 要 |
| `HKU` | `HKEY_USERS` | 每个加载的用户配置单元 | 否（自己的） |
| `HKCC` | `HKEY_CURRENT_CONFIG` | 当前硬件配置 | 否（读） |

::: danger `HKCR` 不是存储位置，它是个合并视图
`HKCR` 是 `HKLM\SOFTWARE\Classes` 和 `HKCU\Software\Classes` 的**合并视图**，优先级是 HKCU 高。

这导致两个反直觉的结果：

1. **往 `HKCR` 写，实际写进了 `HKLM\SOFTWARE\Classes`。** 注册表编辑器里显示的位置和落盘位置不是一回事
2. **你改了 `HKLM\SOFTWARE\Classes` 却看不到效果。** 因为 HKCU 那边有同名键，合并视图里被遮住了

调试这类「改了没反应」时，`reg query` 两个真实位置分别查一遍：

```cmd
reg query "HKCU\Software\Classes\某个类名"
reg query "HKLM\SOFTWARE\Classes\某个类名"
```

**排查时永远用 `HKLM\SOFTWARE\Classes` 和 `HKCU\Software\Classes` 这两个真路径，不用 `HKCR`。** `HKCR` 只在查「某个文件类型关联到哪个程序」这类只读查询里方便。
:::

## 2. 读：先看结构，再看值

| 意图 | CMD | PowerShell | 是否改动数据 |
| --- | --- | --- | --- |
| 看某个键的直接子项 | `reg query "HKCU\Software"` | `Get-ChildItem 'HKCU:\Software'` | 否 |
| 递归看整棵子树 | `reg query "HKCU\Software" /s` | `Get-ChildItem 'HKCU:\Software' -Recurse` | 否 |
| 找匹配的键名 | `reg query "HKCU\Software" /f "关键词" /k /s` | `Get-ChildItem -Recurse \| Where-Object { $_.PSChildName -like '*关键词*' }` | 否 |
| 找匹配的值名 | `reg query "HKCU\Software" /f "关键词" /v /s` | 同上，查 `PSObject.Properties` | 否 |
| 找匹配的值内容 | `reg query "HKCU\Software" /f "关键词" /d /s` | `... \| Where-Object { $_.GetValue($n) -like '*关键词*' }` | 否 |
| 只看某个值 | `reg query "HKCU\Software\X" /v ValueName` | `Get-ItemProperty 'HKCU:\Software\X' -Name ValueName` | 否 |
| 列出所有值名 | `reg query "HKCU\Software\X"` | `(Get-Item 'HKCU:\Software\X').GetValueNames()` | 否 |

```cmd
reg query "HKCU\Software\Microsoft\Windows\CurrentVersion\Run"
```

你应该看到开机自启项列表，每行是「值名(默认) 类型 数据」。

**`reg query` 的输出固定三列：值名、类型、数据。** 数据是十六进制表示的，定宽 `0x` 开头。

::: warning `reg query` 不加 `/f` 只查当前一层
`reg query "HKCU\Software"` 列出 `Software` 的**直接子键**，值只在有子项的那层显示。要看整棵树必须加 `/s`（递归）。

而 `/s` 在大分支上会非常慢 —— `reg query "HKLM\SOFTWARE" /s` 能跑好几分钟。**先不带 `/s` 看一层，定位到大概位置再收窄范围**，比一上来就全表递归快得多。
:::

`/f` 的四个开关：

| 组合 | 匹配什么 |
| --- | --- |
| `/f "词"` | 键名**和**值数据 |
| `/f "词" /k` | 只匹配键名 |
| `/f "词" /v` | 只匹配值名 |
| `/f "词" /d` | 只匹配值数据 |
| `/f "词" /e` | 精确匹配（不加则包含匹配） |

**不加 `/e` 是包含匹配** —— 想找 `Run` 会连 `RunOnce` 一起列出来。

## 3. 写：备份、修改、验证，三步不能省

### 值类型：选错类型是静默失败

| 类型 | `reg query` 显示 | 存什么 | 用 `/d` 写时 |
| --- | --- | --- | --- |
| `REG_SZ` | `REG_SZ` | 文本 | `reg add ... /t REG_SZ /d "值"` |
| `REG_EXPAND_SZ` | `REG_EXPAND_SZ` | **会展开环境变量**的文本 | `/t REG_EXPAND_SZ /d "%SystemRoot%\x"` |
| `REG_MULTI_SZ` | `REG_MULTI_SZ` | 多行字符串列表 | ⚠️ 命令行写不了，见下 |
| `REG_DWORD` | `REG_DWORD` | 32 位整数 | `/d 1`（**十进制**） |
| `REG_QWORD` | `REG_QWORD` | 64 位整数 | `/d 1` |
| `REG_BINARY` | `REG_BINARY` | 任意字节 | `/d 00ff01` |
| `REG_NONE` | 暂无 | 空值 | — |

::: danger `REG_SZ` 和 `REG_EXPAND_SZ` 存同一个字符串，行为完全不同
`reg add "HKCU\Software\X" /v P /t REG_SZ /d "%ProgramFiles%\app.exe"` 存进去的就是**字面的六个字符** `%ProgramFiles%` 加上路径。

同一个值用 `REG_EXPAND_SZ` 存，读它的程序会拿到展开后的真实路径。

**症状是「配置明明写了路径，程序却找不到文件」** —— 因为值里躺着一个没被展开的 `%ProgramFiles%`，程序当普通字符串用了。往注册表写路径时默认用 `REG_EXPAND_SZ`。
:::

::: warning `REG_DWORD` 在命令行是十进制，在编辑器里是十六进制
`reg query` 和注册表编辑器都把 DWORD 显示成 `0x1`。但 `reg add /d` 传的是**十进制**：

```cmd
reg add "HKCU\Software\X" /v Timeout /t REG_DWORD /d 30 /f
```

存进去是 `0x1e`。写 `/d 0x1e` 会被当成字面字符串 `0x1e` 解析失败或存成完全不同的值。**别把编辑器里看到的十六进制直接粘到命令行。**
:::

`REG_MULTI_SZ` 命令行写不了。它需要用分隔符标记多行，命令行没法传。必须用 PowerShell：

```powershell
$p = 'HKCU:\Software\X'
New-Item -Path $p -Force | Out-Null
New-ItemProperty -Path $p -Name List -Value @('第一行','第二行') -PropertyType MultiString -Force
```

你应该看到值是 `REG_MULTI_SZ`，`reg query` 显示成多行。

### 一次完整的、正确的修改

**这是本章的核心模板。三步都有，每个都不能省。**

```cmd
reg export "HKCU\Software\X" C:\Temp\X-backup.reg /y
```

你应该看到「指定的项已成功导出到该文件」。**这一步没输出不代表成功，去确认文件真的生成了。**

```cmd
reg add "HKCU\Software\X" /v Timeout /t REG_DWORD /d 30 /f
```

你应该看到「操作成功完成」。`/f` 是覆盖确认 —— **不加 `/f` 而值已存在时，命令会停下来等确认**，自动化里就卡死了。

```cmd
reg query "HKCU\Software\X" /v Timeout
```

你应该看到 `Timeout    REG_DWORD    0x1e`。**不验证等于没改。**

```cmd
reg import C:\Temp\X-backup.reg
```

这是回滚命令，需要时用。

::: danger `/f` 挡不住打错的键名
`/f` 只确认「这个值要不要覆盖」，**它不会确认你写的路径对不对**。路径打错时 `reg add` 会创建一个全新的错误键并报成功。

这就是为什么第 3 步的验证不可省：你要确认的是「我改的那个键 值 确实变了」，而不是「命令返回了操作成功」。
:::

## 4. PowerShell 的注册表 Provider

**PowerShell 能当注册表编辑器用，而且比 `reg.exe` 更适合改结构化的东西。**

| 意图 | `reg.exe` | PowerShell | 是否改动数据 |
| --- | --- | --- | --- |
| 像文件系统一样浏览 | 无 | `Set-Location 'HKLM:\SOFTWARE'` | 否 |
| 读一个值 | `reg query ... /v X` | `Get-ItemProperty 'HKLM:\...' -Name X` | 否 |
| 建键 | `reg add "路径" /f` | `New-Item -Path 'HKLM:\...' -Force` | ⚠️ 建键 |
| 改值 | `reg add ... /f` | `Set-ItemProperty -Path ... -Name X -Value 1` | ⚠️ 改值 |
| 删值 | `reg delete ... /v X /f` | `Remove-ItemProperty -Path ... -Name X` | ⚠️⚠️ 删值 |
| 删键 | `reg delete "路径" /f` | `Remove-Item 'HKLM:\...' -Recurse` | ⚠️⚠️⚠️ |
| 判断存不存在 | `reg query` 看报错 | `Test-Path 'HKLM:\...'` | 否 |

```powershell
$p = 'HKCU:\Software\X'
# 备份仍然用 reg export，它导出的格式可以被 reg import 还原
reg export 'HKCU\Software\X' C:\Temp\X-backup.reg /y

New-Item -Path $p -Force | Out-Null
New-ItemProperty -Path $p -Name Timeout -Value 30 -PropertyType DWord -Force
Set-ItemProperty -Path $p -Name Timeout -Value 60

Get-ItemProperty -Path $p -Name Timeout
```

你应该看到 `Timeout : 60`。

::: warning `Set-ItemProperty` 改不了值的类型
值已经存在时，`Set-ItemProperty` **只改数据不改类型**。想把 `REG_SZ` 换成 `REG_DWORD`，它会报错或静默保持原类型。

改类型的唯一可靠做法是**先删值再建值**：

```powershell
Remove-ItemProperty -Path $p -Name Timeout -Force
New-ItemProperty -Path $p -Name Timeout -Value 60 -PropertyType DWord -Force
```

**删除操作本身要备份。** 这一步之前应该已经有 `reg export`。
:::

::: tip 两个 `HKLM:` 盘符要显式加载
`HKLM:` 和 `HKCU:` 这两个 PSDrive 不是永远都在 —— 它们依赖 `Microsoft.PowerShell.Core` 注册表 provider。在受限语言模式下或者被组策略关掉的机器上，`Set-Location HKLM:\` 会报「无法找到驱动器」。

替代写法是完整路径，不需要 PSDrive：

```powershell
Get-ItemProperty 'Registry::HKEY_LOCAL_MACHINE\SOFTWARE\X'
```

`Registry::` 前缀在 Windows PowerShell 上总是可用。
:::

## 5. 删除：整棵子树

```cmd
reg export "HKCU\Software\X" C:\Temp\X-backup.reg /y
reg delete "HKCU\Software\X" /f
```

你应该看到「成功删除了项」。**`/f` 在删除时是必需的**（没有它会问确认）。

PowerShell 侧：

```powershell
Remove-Item 'HKCU:\Software\X' -Recurse -Force
```

::: danger `Remove-Item -Recurse` 在注册表上删的是整棵子树
和文件系统不同，**注册表的「目录」可以有子键可以有值，`-Recurse` 会把它们连同值一起删掉**。文件系统里删目录至少还有内容，删之前能列出来看一眼。

删之前强制看一眼要删什么：

```powershell
Get-ChildItem 'HKCU:\Software\X' -Recurse | Select-Object -First 20 Name
```

**列出前 20 条就够了** —— 如果第 1 条不是你以为的那个键，说明路径本身写错了，后面 20 条都不用看。
:::

::: tip 整机级的备份用 `reg save`
`reg export` 导出的是某个子树，格式是文本 `.reg` 文件，人能看懂、能手工编辑。

需要「一份原封不动的全机器快照」时用 `reg save`：

```cmd
reg save HKLM C:\Temp\HKLM-backup.hiv /y
```

它是二进制整根键快照，只能用 `reg load` 加载回来（加载到临时名字下查看）：

```cmd
reg load HKLM_BACKUP C:\Temp\HKLM-backup.hiv
reg query "HKLM_BACKUP\SYSTEM\CurrentControlSet\Services" /s
reg unload HKLM_BACKUP
```

**加载之后一定要 `reg unload`。** 挂着不卸载会占用 hive 文件，并且下次开机可能提示需要修复。
:::

## 排障

**Q1：改了注册表，但程序行为没变？**

按这个顺序查，不要跳步：

1. `reg query "路径" /v 值名` —— 确认值真的改了，不是没写进去
2. 查位数的差异 —— 用另一个位数的 `reg.exe` 再查一次
3. 查 `HKCR` 合并视图 —— `HKLM\SOFTWARE\Classes` 和 `HKCU\Software\Classes` 各查一遍
4. 确认改的是 HKCU 还是 HKLM —— **服务和系统组件大量读 HKLM，写 HKCU 不会生效**
5. 重启程序 —— 部分程序只在启动时读一次配置

**Q2：写的路径在注册表编辑器里找不到？**

1. 你可能用 32 位编辑器看 64 位的键（或反过来）—— 注册表编辑器默认跟随它自己启动的位数
2. `reg query "路径"` 确认 `reg.exe` 那边能看到
3. 检查 `Wow6432Node` 分支
4. 检查有没有打错字 —— `reg query "HKLM\SOFTWARE\Microsoft\Window\CurrentVersion"`（少个 s）会报「无法找到指定的注册表项或值」，这个错误信息不区分「打错了」和「真不存在」

**Q3：值类型是 REG_SZ，但程序要 REG_EXPAND_SZ？**

1. `reg query "路径" /v 值名` —— 看类型那一列
2. 删掉重建：`reg delete "路径" /v 值名 /f`
3. `reg add "路径" /v 值名 /t REG_EXPAND_SZ /d "含变量的路径" /f`
4. 确认写入时 `/d` 后面是完整的引号包裹字符串

**Q4：`reg add` 报「请求的操作需要提升」？**

1. 确认当前不是管理员
2. 确认写的是 `HKLM` 而不是 `HKCU`
3. 用 `HKCU` 下的等价路径 —— 很多软件两个地方都读，用户级的改动不需要管理员

**Q5：删错了键，怎么恢复？**

1. `reg import C:\Temp\X-backup.reg` —— 你之前导出的那个
2. 导出文件可以用记事本打开看，确认它导出的范围对不对
3. 如果导出的范围本来就漏了部分内容（导出时路径打错），那就没有回滚余地 —— **这就是为什么导出必须在修改之前做，且要确认导出范围正确**
4. 没有备份的，只能靠同版本系统的同路径配置对照恢复

## 什么时候别用

**能不用命令行改注册表就别用 —— 绝大多数设置都有对应的正规入口。**

| 需求 | 用什么代替 | 原因 |
| --- | --- | --- |
| 开机自启 | 任务管理器 → 启动，或服务的启动类型 | 手动写 `Run` 键没有依赖管理 |
| 环境变量 | 系统属性 → 环境变量 | 广播变更要由系统做 |
| 改服务配置 | `sc config` | 见 [进程与服务](/windows/howto/05-process-service) |
| 改默认程序 | 设置 → 应用 → 默认应用 | `HKCR` 合并视图太容易写错位置 |
| 装软件 | 安装程序 | 安装程序要写几十个键，手写必然不全 |
| 调试、排查、批量导出 | `reg query` / `reg export` | 纯读，安全 |
| 自己的软件存配置 | 配置文件 / `HKCU\Software\你的公司\你的软件` | 见下 |

::: warning 别把注册表当配置数据库用
注册表**不适合存大量或需要事务的数据**：没有版本控制、没有原子性、并发写会丢、导出成文本后无法 diff。

给自己的程序存配置，用 `%APPDATA%` 下的文件。注册表里只放「指向这个文件路径」和一个版本号。
:::

::: danger 绝对不要删的键
这几处被系统关键组件依赖，删掉可能导致**无法登录、无法启动某些服务、或者只能进安全模式**：

- `HKLM\SYSTEM\CurrentControlSet\Services` 下面的服务项
- `HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion` 里的 `ProfileList`（用户配置单元）
- `HKLM\SAM` 和 `HKLM\SECURITY`
- `HKLM\COMPONENTS`
- 当前登录用户的 `NTUSER.DAT` 对应的 `HKCU` 整个根键

真的要清理服务项，**禁用（`sc config` 改启动类型）不等于删除**。禁用是可逆的，删除不是。清理残留时优先用系统自带的清理工具。
:::

## 哪些是通用的

**「改配置之前先备份，改完立刻验证」换平台一样成立。**

| 这里学的 | Linux 上对应 |
| --- | --- |
| 导出配置 | `cp /etc/foo.conf /etc/foo.conf.bak` |
| 从备份恢复 | `mv` 回去，或包管理器的 `reinstall` |
| 注册表的层次化键值 | `/etc` 下的配置文件树 |
| 配置文件归用户还是归机器 | `/etc`（全局）vs `~/.config`（用户） |
| 类型化配置 | JSON / YAML / TOML |
| 改系统级设置要提权 | `sudo` |
| 出问题回滚 | 包管理器降级 / 系统还原点 |

**明确不通用的部分：**

- **注册表没有对应物**。Linux 没有一个中心化的系统设置数据库；系统配置是散落的文本文件加各自的工具。**这是两者的根本结构差异**，不是实现细节
- **没有恢复机制**。Linux 上很多包管理器有 `reinstall` / `rollback`，注册表没有任何内建恢复
- **修改要立即生效还是重启生效**。注册表里大部分设置下次启动即生效，Linux 配置通常有 reload 机制
- **位数视图**。WOW64 32/64 位注册表分裂是 Windows 特有的，Linux 上 x86/x64 的路径和配置是共享的
- **权限模型**。注册表有细粒度的 ACL 挂在键上，Linux 配置文件基本只有属主/属组/权限位

## 跑完之后

下一章讲**计划任务、事件日志与环境变量** —— 为什么 `schtasks` 建的日志看不到输出，以及服务起不来时该去事件日志的哪个源看哪几行。

→ [计划任务、事件日志与环境变量](/windows/internals/10-system-admin)

## 📝 配套练习

<QuizBlock module-id="09-registry" />
