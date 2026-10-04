---
title: PowerShell：对象管道与别名体系
description: 为什么 PowerShell 的管道和 Unix 的不一样，以及别名让你少记一半命令。
---

# PowerShell：对象管道与别名体系

> 读完你会明白为什么 `ls | grep` 在 PowerShell 里不工作，以及为什么 `Get-ChildItem` 输出了你看不懂的表头。这一章大约 30 分钟。

<ModuleMeta module-id="04-powershell-intro" />

## 前置条件

**确认你跑的是 PowerShell 而不是 CMD —— 这一章所有内容都依赖它。**

```cmd
powershell
```

提示符从 `C:\Users\MAX>` 变成 `PS C:\Users\MAX>`。你应该看到 `PS` 开头。

```powershell
$PSVersionTable
```

你应该看到一张表，其中 `PSVersion` 的 `Major` 是 `5` 或 `7`，`PSEdition` 是 `Desktop` 或 `Core`。

::: warning 从 CMD 里进 PowerShell 和直接启动不是一回事
CMD 里敲 `powershell` 启动的是 **5.1**（Desktop 版），因为它跟着系统走。任务栏上那个蓝色图标、以及 `pwsh` 命令启动的是 **7 或更高**（Core 版）。

判断自己在哪：

```cmd
echo %PSModulePath%
```

含 `WindowsPowerShell\v1.0` 是 5.1，含 `PowerShell\7` 是 7。**能用 `pwsh` 就优先用 `pwsh`**，编码默认值和跨平台行为都更符合预期。
:::

## 1. 管道里跑的是对象，不是文本

**这是 PowerShell 和 Unix 最大的结构差异，也是所有「在 PowerShell 里照搬 Linux 写法失败」的根因。**

Unix 的管道：

```bash
ps aux | grep node
```

两个进程之间传的是**字节流**。`grep` 只能看到文本，所以 `grep` 自己的名字也会被搜到 —— 于是有了 `grep "[n]ode"` 这种绕法。

PowerShell 的管道：

```powershell
Get-Process | Where-Object { $_.Name -eq 'node' }
```

两个 cmdlet 之间传的是 **.NET 对象**。`Get-Process` 返回的是一组进程对象，每个对象有 `Name`、`Id`、`CPU`、`WorkingSet` 等属性。`Where-Object` 拿到的是对象本身，所以它**不会匹配到自己** —— 不需要任何绕法。

| | Unix 管道 | PowerShell 管道 |
| --- | --- | --- |
| 传的东西 | 文本字节 | .NET 对象 |
| 下游能做什么 | 字符串匹配 | 读属性、排序、过滤、算聚合 |
| 格式化发生在哪 | 上游程序 | 最后一环 |
| 变量名 | 无对应 | `$_` |

::: tip `$_` 是「当前管道对象」
`ForEach-Object`、`Where-Object`、`Sort-Object` 这些命令都有一个脚本块参数。这个脚本块会对每个对象执行一次，块里的 `$_` 就是「这一次拿到的那个对象」。

`Get-Process | Where-Object { $_.CPU -gt 1 }` 直译成人话：**对每个进程，如果它的 CPU 属性大于 1，就留下它。**
:::

### 管道传的是对象，所以你看到的是表头

```powershell
Get-ChildItem
```

你应该看到类似这样的表：

```text
    Directory: C:\Users\MAX

Mode                 LastWriteTime         Length Name
----                 -------------         ------ ----
d----        2025/9/12   10:23:00                Desktop
-a---        2025/9/12   10:23:00                 22 notes.txt
```

这个对象其实是**一列对象的集合**（`-is [System.Collections.ArrayList]`），但 PowerShell 默认在最后一环把它渲染成表格给人看。表格列的是对象属性的交集，所以字段叫 `Mode`、`LastWriteTime` —— 这些不是文件名的一部分，是对象的属性。

想看到对象本身长什么样：

```powershell
Get-ChildItem | Out-String -Width 200
Get-ChildItem | Format-List
```

`Format-List` 一行一个属性，长内容不会被截断。

::: warning 表格会截断
超过终端宽度时 PowerShell 会**默默换行**而不是截断，但当列数太多时它会只显示前几列，剩下的直接不显示（需要 `-Force` 或改宽度）。看到某个属性「不见了」，先怀疑显示宽度，不是数据没了。
:::

### 让对象以文本形式传给外部程序

```powershell
Get-Process | ForEach-Object { $_.Name } | Sort-Object | Out-File names.txt
```

`Out-File` 是格式化成文本的动作。**只有它能让对象变成外部程序能吃的字节。** 同理，管道给外部 exe 时 PowerShell 会自动做这一步转换，但会丢掉格式控制。

## 2. 别名体系：只记全名的一小半

**PowerShell 的每个动词都有惯用简称。学会查别名，你只需要记住约 20 个全名。**

| 你想干什么 | 全名 | 最常用的别名 | 别名来源 |
| --- | --- | --- | --- |
| 列目录 | `Get-ChildItem` | `ls` / `gci` / `dir` | Unix / Unix / DOS |
| 读文件 | `Get-Content` | `gc` / `cat` / `type` | Unix / Unix / DOS |
| 删文件 | `Remove-Item` | `rm` / `del` | Unix / DOS |
| 复制 | `Copy-Item` | `cp` / `copy` | Unix / DOS |
| 移动 | `Move-Item` | `mv` / `move` | Unix / DOS |
| 改名 | `Rename-Item` | `ren` | DOS |
| 切目录 | `Set-Location` | `cd` / `sl` | DOS |
| 新建 | `New-Item` | `ni` | 缩写 |
| 当前位置 | `Get-Location` | `pwd` / `gl` | Unix |
| 找路径存在吗 | `Test-Path` | 无 | — |
| 筛选 | `Where-Object` | `?` | 符号 |
| 逐个处理 | `ForEach-Object` | `%` | 符号 |
| 查命令 | `Get-Command` | `gcm` | 缩写 |
| 查帮助 | `Get-Help` | `help` | DOS |
| 查成员 | `Get-Member` | `gm` | 缩写 |
| 量一下 | `Measure-Object` | `measure` | 缩写 |
| 变文本 | `Out-String` | 无 | — |

::: danger `?` 和 `%` 不是「更快的写法」，是隐患
在 PowerShell 脚本文件里，`?` 和 `%` **必须是命令名的第一个字符、且后面紧跟参数**，不能有空格：

```powershell
? { $_.Name -eq 'x' }        # 错：? 和 { 之间有空格
?{ $_.Name -eq 'x' }         # 对
%{ $_.Name }                 # 对
% { $_.Name }                # 错
```

这条规则很少有人主动告诉你，报错信息是「术语 '?' 未被识别」。**脚本里用全名，别用符号别名。**
:::

查某个命令到底对应什么程序：

```powershell
Get-Command ls
Get-Command gci | Select-Object CommandType, Name, Definition
```

你应该看到 `Alias` 和它指向的 `Get-ChildItem`。

**`Get-Command` 区分得清别名、函数、cmdlet、应用程序四类。** 遇到「这条命令怎么没生效」，第一步永远是 `Get-Command` 确认它是什么。

::: tip 别名不是全平台通用的
别名是随 PowerShell 会话加载的。**在另一个机器、另一个 profile、或者 `-NoProfile` 启动的会话里，别名可能就不存在**。写给别人用的脚本和 CI 里的脚本，用全名。日常交互用别名提高速度。
:::

## 3. 外部程序：写全名，不要指望有别名

**PowerShell 里 `grep`、`tail`、`head`、`ps` 大部分都不存在或行为不同。**

| Linux 命令 | PowerShell 里的对应 | 是否可直接用同名 |
| --- | --- | --- |
| `grep` | `Select-String` | 否，PowerShell 无此别名 |
| `sed` | 无内置对应 | 否 |
| `awk` | 无内置对应 | 否 |
| `cat` | `Get-Content` | 是，别名 |
| `ls` | `Get-ChildItem` | 是，别名 |
| `cp` | `Copy-Item` | 是，别名 |
| `rm` | `Remove-Item` | 是，别名（但语义不同） |
| `ps` | `Get-Process` | 是，别名 |
| `tail -n 50` | `Get-Content -Tail 50` | 否，参数完全不同 |
| `head` | `Get-Content -TotalCount` | 否 |
| `kill` | `Stop-Process` | 部分，`kill` 指向 `Stop-Process` |
| `which` | `Get-Command` | `which` 需靠 Git Bash 才存在 |

::: warning `where` 在两边是同一件事，但容易误解
CMD 里 `where notepad` 找的是**命令在 PATH 里的位置**。PowerShell 里 `where` 不解析成任何内置别名，靠 PATH 找到 `C:\Windows\System32\where.exe`，参数规则相同。

要「找文件」用 `where /R C:\Temp *.log`（老式的递归文件搜索），要「找命令」用 `Get-Command` 更直接。这两件事在 Windows 上经常被混着写。
:::

`Get-ChildItem -Recurse` 已经能做文件搜索，且比 `where /R` 快得多：

```powershell
Get-ChildItem -Path C:\Temp -Recurse -Filter *.log
```

## 4. 查用法：`Get-Help` 和 `Get-Command -Syntax`

**`Get-Help` 在装了帮助模块的机器上才有完整内容，没装的时候给你一串示例 —— 两种都要会用。**

```powershell
Get-ChildItem -?
Get-Help Get-ChildItem
Get-Help Get-ChildItem -Examples
```

三种你应该看到的东西：

| 情况 | 输出 |
| --- | --- |
| 装过帮助模块 | 完整语法、参数说明、示例 |
| 没装帮助模块 | 只有简短说明和 1 到 2 个示例 |
| 加 `-Examples` | 只看示例 |

本地没装帮助模块时，可以把在线文档离线读下来：

```powershell
Update-Help
```

::: warning `Update-Help` 失败了不影响使用
需要管理员权限，且目标站点要能访问。第一次执行常因权限或网络失败而报错，**报错不影响任何命令的执行**。忽略它继续用 `-?` 就行。
:::

只想看参数结构的话更快：

```powershell
Get-Command Get-ChildItem -Syntax
```

你应该看到一行精简的参数列表，比完整帮助短得多。

## 排障

**Q1：提示「无法加载文件 xxx.ps1，因为在此系统上禁止运行脚本」？**

按这个顺序查，不要跳步：

1. `Get-ExecutionPolicy -List` —— 看当前策略，`Restricted` 就是原因
2. `Get-ExecutionPolicy -List` 看 `CurrentUser` 那行 —— 只改这一行，不碰 `LocalMachine`
3. `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` —— 改当前用户
4. 重开一个 PowerShell 窗口再跑脚本

::: danger 不要用 `Set-ExecutionPolicy Unrestricted` 或 `Bypass` 解决
`Unrestricted` 只跳过签名检查、不阻止执行，等于关掉这个防线。`Bypass` 更彻底。**`RemoteSigned`（本地脚本可跑、从网上下载的必须带签名）才是该选的那个**。企业机器上 `LocalMachine` 那条策略通常由域策略强制，`Set-ExecutionPolicy` 改了会被域策略定期刷回去 —— 这也是为什么第 2 步要确认 `CurrentUser`。
:::

**Q2：`ls | grep xxx` 报「grep 未被识别」？**

1. `Get-Command grep` —— 确认它确实不存在（返回空就是没有）
2. 换成 `Get-ChildItem -Recurse | Select-String 'xxx'`
3. 要在文件内容里搜而不是文件名，用 `Select-String -Path *.log`

**Q3：`$_.Name` 报错说找不到属性？**

1. `Get-ChildItem | Get-Member` —— 看这个对象真实有哪些属性
2. `Get-ChildItem | Select-Object -First 1 | Format-List *` —— 展开看全部属性
3. 检查管道中间那一步是不是把对象变成了文本 —— `| Out-String` 或 `| ConvertTo-Json` 会破坏对象流

**Q4：`?{...}` 和 `%{...}` 报「未识别为命令」？**

1. 确认符号和 `{` 之间**没有空格**
2. 换成全名 `Where-Object` / `ForEach-Object`
3. `Get-Alias ?` —— 确认当前会话里这个别名在不在

**Q5：管道里的东西显示成一大坨，和预期完全不一样？**

1. `... | Get-Member` —— 确认每一步拿到的是对象
2. `... | Select-Object -First 1 | Format-List *` —— 定位是哪一步格式变了
3. 在关键步骤插 `| Out-Host` —— 让它在管道中途打印出来

## 什么时候别用

**对象管道不是所有场景的最优解。**

| 场景 | 用什么更好 | 原因 |
| --- | --- | --- |
| 处理超大文件（几个 GB） | `Get-Content -ReadCount` 或 `findstr` | 默认整读进内存 |
| 高频循环里的简单操作 | 一次 `Select-Object` 拿全 | 反复启动 cmdlet 有固定开销 |
| 要贴给别人看 | `Out-String -Width 300` | 默认表格会按终端宽度折行 |
| 需要其他语言能读的结果 | `ConvertTo-Json` 或 `Export-Csv` | 对象是内存里的，落地就是文本 |
| 纯文本替换 | `Select-String` 加 `-Replace` 评估 | 别指望 PowerShell 干 `sed` 的活 |

::: warning 别把 PowerShell 当 Linux shell 用
最常见的失败模式是照抄 Linux 命令行。如果你的目标是「在 Windows 上跑 Linux 的工具链」，正解是 WSL 或者容器 —— 装一套 GNU coreutils 兼容性更高的 `grep`/`sed`/`awk`，比在 PowerShell 里逐条绕要省事得多。PowerShell 的价值在于管理 Windows 本身（服务、注册表、计划任务、WMI），不是替代 Unix 工具。
:::

**别名也别在脚本里用。** 前面说过：别名随会话加载，`-NoProfile` 或另一台机器上可能不存在。日常交互随便用，提交进仓库的脚本一律全名。

## 哪些是通用的

**管道 + 逐个处理这个模型换平台一样成立。**

| 这里学的 | Linux 上对应 |
| --- | --- |
| `Get-Process` | `ps` |
| `Get-Service` | `systemctl status` |
| `Get-ChildItem` | `ls` |
| `Get-Content` | `cat` |
| `Test-Path` | `test -e` |
| 管道串联多条命令 | `cmd1 \| cmd2` |
| 变量 | `$VAR` |
| 脚本语言 | `.ps1` 对应 `.sh` |

**明确不通用的部分：**

- **管道载荷**。Unix 传文本，PowerShell 传对象。这意味着 Unix 上的正则技巧（`grep` 的排除自身、正则里的转义）在 PowerShell 里完全不适用，反过来 PowerShell 的属性访问（`$_.Length`）在 Unix 里也不成立
- **参数风格**。PowerShell 用 `-Verb`、Unix 用 `--option`。两套都有单字符和长选项，但语义不通用
- **命令命名**。`Get-` / `Set-` / `New-` 这套「动词-名词」是 PowerShell 的设计，不是行业惯例
- **错误处理**。PowerShell 默认把很多错误写成红色文字但不中断执行（non-terminating），Unix 工具通常靠退出码。详见 [PowerShell 脚本](/windows/internals/12-powershell-script)

## 跑完之后

下一章分开讲两条线：一边是进程和服务这两套完全不同的管理模型，另一边是端口、连通性、DNS 的固定排查顺序。

→ [进程与服务：两套不同的管理模型](/windows/howto/05-process-service)

## 🎮 实战演练

<ArenaTasks module-id="04-powershell-intro" />

<ToyWinTerminal module-id="04-powershell-intro" />

## 📝 配套练习

<QuizBlock module-id="04-powershell-intro" />
