---
title: PowerShell 脚本：参数、作用域与错误处理
description: 参数绑定的坑、函数的作用域规则，以及 try/catch 为什么常被写错。
---

# PowerShell 脚本：参数、作用域与错误处理

> 读完你会写出别人能直接调用、参数清楚、错误能接住的脚本，并且知道为什么 `try/catch` 里明明写了却什么都不触发。这一章大约 35 分钟。

<ModuleMeta module-id="12-powershell-script" />

## 前置条件

**确认执行策略和脚本能跑，否则下面所有代码都跑不起来。**

```powershell
Get-ExecutionPolicy -List
```

你应该看到 `CurrentUser` 那一行。`Restricted` 就先改当前用户：

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

**只改 `CurrentUser`，不要改 `LocalMachine`** —— 后者需要管理员、会被域策略刷回去，而且它影响整台机器。

建练习目录：

```powershell
New-Item -ItemType Directory -Path C:\Temp\ps -Force | Out-Null
Set-Location C:\Temp\ps
```

**确认你的编辑器存文件的编码。** 这不是小事，见第 1 节。

## 1. 一个能给别人用的脚本长什么样

```powershell
<#
.SYNOPSIS
    列出指定目录里最大的几个文件。

.DESCRIPTION
    用法：Get-BigFiles.ps1 -Path C:\Temp -Count 5
    需要 PowerShell 5.1 或更高。
#>
#requires -Version 5.1

[CmdletBinding()]
param(
    [Parameter(Mandatory, Position = 0)]
    [ValidateNotNullOrEmpty()]
    [string]$Path = '.',

    [Parameter(Position = 1)]
    [ValidateRange(1, 1000)]
    [int]$Count = 10,

    [switch]$IncludeHidden
)

Set-Location $PSScriptRoot
$ErrorActionPreference = 'Stop'

Get-ChildItem -Path $Path -File -Recurse:$IncludeHidden |
    Sort-Object Length -Descending |
    Select-Object -First $Count Name, Length, LastWriteTime
```

存成 `C:\Temp\ps\Get-BigFiles.ps1`，然后：

```powershell
.\Get-BigFiles.ps1 -Path C:\Temp -Count 3
```

你应该看到 3 行结果。

### `param` 必须是第一条语句

**`param` 块前面只能有注释和空行。任何可执行语句放在它前面，参数就完全不生效** —— 而且 PowerShell 不报错，你会得到「脚本接受了参数但完全无视它」的现象。

```powershell
# 错误：Write-Host 在 param 前面
Write-Host '开始'
param([string]$Path)

# 正确：注释和空行可以
# 这是注释
param([string]$Path)
Write-Host '开始'
```

`#requires` 指令也是特殊的：它必须在 `param` 之前，且**只允许注释、空行和 `using` 声明在它前面**。

::: danger `.ps1` 文件的编码：5.1 上必须有 BOM
**Windows PowerShell 5.1 读 `.ps1` 时，没有 BOM 就按系统 ANSI 代码页（中文系统是 GBK）解读字节。** 一个用编辑器存成「UTF-8 无 BOM」的 `.ps1`，里面的中文全是乱码，而且字符串比较会因为字节不同而全部失配。

5.1 必须存成 **UTF-8 带 BOM**。PowerShell 7 两种都能读。

判断文件是不是带 BOM：

```powershell
Get-Content -Encoding Byte -TotalCount 3 .\Get-BigFiles.ps1 | ForEach-Object { '{0:X2}' -f $_ }
```

带 BOM 的 UTF-8 开头是 `EF BB BF`。

在编辑器的保存设置里确认一次当前编码（VS Code 右下角能看，Notepad++ 在「编码」菜单），把这个脚本存成 UTF-8 无 BOM。配一次，之后所有脚本都省事。
:::

### 脚本不改变当前目录

**PowerShell 执行脚本时不会先切到脚本所在目录。** 脚本里用相对路径，写脚本时在 `C:\Users\MAX`，运行时就会在 `C:\Users\MAX` 解析，不是脚本所在目录。

```powershell
Set-Location $PSScriptRoot
```

**这一行应该成为每个用到相对路径的脚本的第一行。** `$PSScriptRoot` 是脚本所在目录，没有它就得让调用者保证当前目录正确 —— 而调用者是谁你控制不了。

## 2. 参数绑定的坑

| 特性 | 写法 | 用途 |
| --- | --- | --- |
| 声明参数块 | `param([string]$Path)` | 最多参数必须在最前 |
| 必须给值 | `[Parameter(Mandatory)]` | 漏了会提示，不给静默过 |
| 位置参数 | `[Parameter(Position=0)]` | 允许 `script.ps1 值` 免名字 |
| 开关 | `[switch]$Force` | 存在即为真，不需要值 |
| 限定取值 | `[ValidateSet('a','b')]` | 其他值直接报错 |
| 限定范围 | `[ValidateRange(1,100)]` | 数字边界 |
| 限定格式 | `[ValidatePattern('^C:')]` | 正则约束 |
| 非空 | `[ValidateNotNullOrEmpty()]` | 挡掉空串 |
| 自定义校验 | `[ValidateScript({...})]` | 任意逻辑，返回布尔 |
| 从管道接收 | `[Parameter(ValueFromPipeline)]` | 让 cmdlet 能接到管道上 |

```powershell
function Test-Param {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory, Position = 0)]
        [ValidatePattern('^[A-Za-z]+$')]
        [string]$Name,

        [Parameter()]
        [ValidateRange(1, 10)]
        [int]$Level = 1,

        [Parameter()]
        [switch]$Strict
    )
    "Name=$Name Level=$Level Strict=$Strict"
}

Test-Param abc -Level 99
```

你应该看到参数校验的报错，错误信息会指出是 `Level` 超出了范围。

::: warning 位置参数不能跳号
声明了 `Position=0` 和 `Position=2`、没有 `Position=1`，PowerShell 会报错。**位置参数必须连续。**

想留空位就显式写出来占着：

```powershell
param(
    [Parameter(Position=0)][string]$A,
    [Parameter(Position=2)][string]$C
)
```
:::

::: warning 参数名可以是缩写，但不唯一时报错
```powershell
Get-ChildItem -Recurse      # -Recurse 可以缩写成 -Rec
Get-ChildItem -Rec:1        # 冒号后是值
```

前缀能对上唯一一个参数就自动补全，**对不上多个就报「参数无法识别」而不是问你选哪个**。给参数起名时避免互为前缀（`Path` 和 `Password` 不能同时做缩写用）。
:::

::: tip Splatting：参数多了就用哈希表传
```powershell
$params = @{
    Path        = 'C:\Temp'
    Count       = 5
    IncludeHidden = $true
}
.\Get-BigFiles.ps1 @params
```

`@params` 前面的 `@` 是 splat 运算符 —— 把哈希表展开成参数。**参数超过三个、或者要在多处复用同一组参数时用它**，比一长串 `-Key Value` 可靠。

数组形式的 `@args` 传位置参数：

```powershell
$argList = @('C:\Temp', 5)
.\Get-BigFiles.ps1 @argList
```
:::

### `$args` 只装没声明的位置参数

```powershell
function Show-Args {
    param([string]$First)
    "First=$First"
    "Args 数量=$($args.Count)"
    "Args 内容=$args"
}
Show-Args a b c
```

你应该看到 `First=a`，`Args 数量=2`，内容是 `b c`。

::: warning 不写 `param()`，整个脚本都退化成 `$args`
**没有 `param` 块的脚本或函数，所有参数（包括 `-Verbose` 这种带横线的）都进 `$args`。** 而加了 `[CmdletBinding()]` 之后，名字错误的参数会**直接报错**，不再进 `$args`。

| 写法 | 传错参数名 |
| --- | --- |
| 无 `param`，无 `CmdletBinding` | 静默进 `$args` |
| 有 `param`，无 `CmdletBinding` | 进 `$args` |
| 有 `CmdletBinding` | **报错** |

**加 `[CmdletBinding()]` 是好事** —— 它白送你 `-Verbose`、`-Debug`、`-ErrorAction`、`-WhatIf`、`-Confirm`，并且把打错的参数变成明确错误。
:::

::: danger 不要用 PowerShell 保留字做参数名
`$args`、`$input`、`$error`、`$host`、`$this`、`$foreach`、`$switch`、`$matches` 都是自动变量或语言关键字。

用它们做参数名，赋值时你会覆盖掉自动变量的值，报错信息（如果有的话）完全指向别的地方。`$input` 尤其危险 —— 它在函数里是枚举器，覆盖它会让管道行为异常。
:::

## 3. 作用域：PowerShell 的规则和多数语言不同

**PowerShell 用动态作用域 —— 函数能看到「调用它的那一层」的变量，而不是它自己被定义的那一层。**

```powershell
function Show-Name {
    "在函数里看到：$($Name)"
}
$Name = 'MAX'
Show-Name
```

你应该看到 `在函数里看到：MAX`。**`$Name` 并没有作为参数传进去**，函数是从调用者的作用域里找到它的。

这和 Python、JavaScript 的闭包思路相反：那些语言里函数只能看到**定义处**的变量。PowerShell 里它看到的是**调用处**的。

**这既是便利也是陷阱** —— 函数的行为取决于调用环境，同一个函数在不同地方跑结果可能不同。

### 作用域的层级

| 作用域 | 修饰符 | 说明 |
| --- | --- | --- |
| 全局 | `$global:` | 整个会话 |
| 脚本 | `$script:` | 当前脚本 |
| 父作用域 | `$Parent:` | 通用引用 |
| 本地 | 局部变量 | 函数内部 |
| 编号 | `1:` 到 `5:` | 祖先层级 |

**函数、脚本文件、`.ps1` 块、后台作业各有自己的脚本作用域。`$script:` 指的是当前脚本的，不是当前会话的。**

### 哪些块会开新作用域

| 写法 | 开新作用域吗 |
| --- | --- |
| `function f { }` | ✅ 开 |
| `.ps1` 脚本文件 | ✅ 开 |
| `& { }` | ✅ 开 |
| `. { }`（点调用） | ❌ 不开，在当前作用域执行 |
| `if` / `else` 块 | ❌ 不开 |
| `foreach` / `while` 块 | ❌ 不开 |
| `ForEach-Object` 的脚本块 | ✅ **开** |
| `Where-Object` 的脚本块 | ✅ **开** |

::: danger `if` 不开作用域，`ForEach-Object` 开
前半句让很多脚本能正常累加变量，后半句是本章最常见的 bug：

```powershell
$total = 0
1..3 | ForEach-Object { $total += $_ }
$total
```

你应该看到 `$total` 是 **0**，不是 6。

原因：`ForEach-Object` 的 `{...}` 是一个子作用域，块里的 `$total` 指向的是**这个子作用域里的副本**。块结束后副本没了，父作用域的 `$total` 还是 0。

修法有三种：

```powershell
# 1. 用 $script: 前缀
$script:total = 0
1..3 | ForEach-Object { $script:total += $_ }

# 2. 用 [ref] 引用类型
$total = 0
1..3 | ForEach-Object { $total = [ref]$total }
# 注意这种写法本身也有坑

# 3. 直接用管道做聚合，别在循环里累加
(1..3 | Measure-Object -Sum).Sum
```

**第三种最好。** 能用 `Measure-Object` 就别手写循环。
:::

::: warning 点调用 `. .\script.ps1` 会把内容泄进当前会话
```powershell
. .\Setup.ps1     # 点调用
& .\Setup.ps1     # 正常调用
```

`.` 开头那个点让脚本**在当前作用域执行**，脚本里定义的所有函数和变量都会留在你的会话里。方便的是可以继续调用那些函数，**麻烦的是你会跟不知道哪来的变量和函数重名**。

只在交互式设置时用点调用，**正式脚本之间一律用 `&` 或直接写名字。**
:::

## 4. 错误处理：`try/catch` 为什么接不住

**这一节是本章最实用的部分。PowerShell 有两种错误，`try/catch` 只管其中一种。**

| 类型 | 是什么 | 默认行为 | `try/catch` 能接吗 |
| --- | --- | --- | --- |
| **终止性**（terminating） | 脚本无法继续 | 中断 | ✅ |
| **非终止性**（non-terminating） | 一条命令失败，其余继续 | 打印红字继续跑 | ❌ |

```powershell
try {
    Get-Content C:\Temp\ps\不存在的文件.txt
    Write-Host '这一行会不会执行'
}
catch {
    '接住了：' + $_.Exception.Message
}
```

**你会看到文件读不到的红字错误，以及「这一行会不会执行」，而 `catch` 一句都没进。** 因为 `Get-Content` 找不到文件产生的是非终止性错误。

::: danger 让 `try/catch` 真正生效的两个办法
**办法一：给这条命令加 `-ErrorAction Stop`。**

```powershell
try {
    Get-Content C:\Temp\ps\不存在的文件.txt -ErrorAction Stop
    Write-Host '这一行不会执行'
}
catch {
    '接住了：' + $_.Exception.Message
}
```

**办法二：把整段设成终止性。**

```powershell
$ErrorActionPreference = 'Stop'
try { ... } catch { ... }
```

`$ErrorActionPreference` 影响之后执行的所有命令，**在脚本开头设一次最省事**。设成 `Stop` 之后，只有 `try` 块里显式写了 `-ErrorAction SilentlyContinue` 或 `-ErrorAction Continue` 的命令还能继续。

**这就是「try/catch 明明写了却接不住」的完整原因。**
:::

### `throw` 和 `Write-Error` 的区别

```powershell
function Get-Thing {
    param([string]$Name)
    if ([string]::IsNullOrEmpty($Name)) {
        throw '名称不能为空'
    }
    if ($Name -eq '特殊') {
        Write-Error '这个名称不被支持'
    }
    return "得到 $Name"
}
```

| 用哪个 | 效果 |
| --- | --- |
| `throw '消息'` | 终止性，被 `try/catch` 接住 |
| `Write-Error '消息'` | 非终止性，**`try/catch` 接不住**，控制流继续往下走 |

**`Write-Error` 之后这个函数会继续执行 `return`，返回一个看起来正常的结果。** 校验参数要用 `throw`，记日志用 `Write-Error`。

### `$?` 和 `$LASTEXITCODE` 都不是通用的

| 检查什么 | 用什么 | 谁设置的 |
| --- | --- | --- |
| 上一条命令是否成功 | `$?` | 所有命令 |
| 外部程序的退出码 | `$LASTEXITCODE` | **只有外部程序** |
| cmdlet 自己的状态 | 具体命令的状态输出 | 各 cmdlet |

::: danger `$LASTEXITCODE` 会被后面的 cmdlet 保留
```powershell
git status
"退出码：$LASTEXITCODE"   # 这里是对的
Get-ChildItem              # 跑了个 cmdlet
"退出码：$LASTEXITCODE"   # 这里还是 git 的旧值！
```

**跑完外部程序后立刻读它，中间隔任何 cmdlet 就会读到过期值。** 要判断外部程序的成败，就紧跟着一行判断：

```powershell
robocopy C:\a C:\b /MIR
if ($LASTEXITCODE -ge 8) { "robocopy 失败：$LASTEXITCODE" }
```

注意 robocopy 的退出码 —— 0 表示「没复制任何东西」，1 到 7 才是成功。详见 [文件操作](/windows/guide/02-file-ops)。
:::

`$?` 在管道里也不可靠：`Get-ChildItem C:\不存在 | Where-Object { $true }` 的 `$?` 反映的是**最后一个**命令的结果，不是整条管道的。

### `trap` 和 `try/catch` 选哪个

| | `try/catch` | `trap` |
| --- | --- | --- |
| 作用域 | 只包住块内 | 整个脚本 |
| 处理完继续 | 继续块后的代码 | 继续下一条语句（除非 `break`） |
| 适合 | 处理预期内的失败 | 兜底、记录日志后继续 |
| 多次执行 | 一次 | 每次错误都触发 |

`trap` 默认处理完会**继续往下跑**，这一点经常和直觉相反。加上 `break` 才会终止：

```powershell
trap {
    '出错了：' + $_.Exception.Message
    break
}
```

::: warning `try/catch` 接不住后台作业里的错误
```powershell
$j = Start-Job { throw '作业里出错了' }
Wait-Job $j
Receive-Job $j
```

**`try/catch` 块包住 `Wait-Job` 接不住这个异常** —— 作业跑在自己的**运行空间（runspace）**里，它的异常在自己的错误流上。要接住得查作业状态：

```powershell
$j | Wait-Job | Receive-Job
if ($j.State -eq 'Failed') { "作业失败" }
```

**跨 runspace 的异常在同一个 `try/catch` 里不可见**，这是 PowerShell 进程隔离的直接结果。
:::

### `finally` 和 `Write-Host` 的位置

`finally` 块在 `try/catch` 之后无条件执行，用来做清理（删临时文件、断开远程会话）。它不能 `return` 或 `break`。

::: warning `Write-Host` 的输出不在管道里
```powershell
function Get-WithDebug {
    Write-Host '这是调试信息'
    '这是真正的返回值'
}
$result = Get-WithDebug
$result.Count
```

**`$result.Count` 是 1，`Write-Host` 的那一句不会被 `$result` 收进去。** 因为 `Write-Host` 写的是宿主（控制台），不是成功输出流。

后果：

- 想把输出接住（比如传给别的进程、写文件），`Write-Host` 的内容会消失
- 调试输出**必须用 `Write-Verbose` / `Write-Debug`**，它们可以用 `-Verbose` / `-Debug` 开关控制显不显示

更根本的问题是**调试打印会污染函数的返回值**：

```powershell
function Convert-Thing {
    '数据'
    '多余的一行调试输出'   # 这个也会进管道
}
```

**返回值的元素个数和内容会被这类语句改变。** 调试时用 `Write-Verbose`，它不进成功流。
:::

### `ShouldProcess`：让脚本能 `-WhatIf`

```powershell
function Remove-MyThing {
    [CmdletBinding(SupportsShouldProcess, ConfirmImpact='High')]
    param([string]$Path)

    if ($PSCmdlet.ShouldProcess($Path, '删除')) {
        Remove-Item $Path -Force
    }
}
```

```powershell
Remove-MyThing -Path C:\Temp\x.txt -WhatIf
```

**你应该看到脚本「本来要做什么」的描述，而文件不会被删。** 这是给有破坏性的脚本加的「安全带」，比自己在里面判断 `$WhatIfPreference` 干净。

## 排障

**Q1：`try/catch` 不触发？**

按这个顺序查，不要跳步：

1. 确认是**非终止性**错误 —— 加 `-ErrorAction Stop` 或设 `$ErrorActionPreference = 'Stop'`
2. 确认错误来自 `throw` 或 `-ErrorAction Stop` 的命令，而不是 `Write-Error`
3. 确认代码在同一个 runspace —— `Start-Job` / `Invoke-Command` 里的异常接不住
4. 在 `catch` 里先只写 `'接住了'` 排除代码本身报错

**Q2：参数完全不生效？**

1. `param` 是不是第一条语句 —— 前面有 `Write-Host` 的话参数会被忽略且不报错
2. 脚本是不是被点调用了 —— `. .\x.ps1` 会改变行为
3. 有没有 `[CmdletBinding()]` —— 有的话参数名错了会直接报错
4. 位置参数声明有没有跳号

**Q3：`$total` 在循环之后是 0？**

1. 是不是用了 `ForEach-Object` —— 它的脚本块开子作用域
2. 改用 `$script:total` 或 `[ref]`
3. 更好的办法：用 `Measure-Object -Sum` 替掉手写循环

**Q4：函数里读不到变量？**

1. 函数在定义文件里、调用在另一个脚本里 —— 靠定义处的变量读不到
2. 用 `. .\定义文件.ps1` 点调用把函数带进当前会话
3. 干脆改成显式传参，别依赖动态作用域
4. 检查变量名是否撞上了自动变量

**Q5：脚本里的相对路径找不到文件？**

1. 脚本第一行加 `Set-Location $PSScriptRoot`
2. 确认 `$PSScriptRoot` 有值 —— 被点调用时它是空的
3. 打印 `Get-Location` 和 `$PSScriptRoot` 对照

**Q6：函数返回值的个数不对？**

1. 找混进来的 `Write-Host`（不在管道里，但会让人误解）
2. 找混进来的调试输出 —— 普通字符串都会进成功流
3. 用 `Write-Verbose` 代替裸输出
4. 确认没有多余的 `return` —— `return` 在函数里不是必须的，函数默认返回最后一条语句的输出

## 什么时候别用

**有些脚本不值得写成「通用工具」，复杂度和维护成本会超过收益。**

| 需求 | 换成 | 原因 |
| --- | --- | --- |
| 一次性操作 | 直接在会话里敲 | 脚本的参数和文档都白写 |
| 别人要用且用法不确定 | 带 `Get-Help` 注释的模块 | 脚本没有版本管理 |
| 要装到多台机器 | 模块 + PowerShellGet | 脚本散落各处没人知道哪个是最新版 |
| 需要稳定的公开接口 | 二进制 cmdlet 或模块 | `.ps1` 没有版本语义 |
| 逻辑超过 200 行 | 拆成模块 | 单文件脚本没法测试 |
| 大量分支和状态 | 换语言 | PowerShell 不适合复杂状态机 |

::: warning 别把自己的工具写成「注册表 + 脚本 + 计划任务」三件套散在各处
这套组合是 2000 年代的做法，坑在：注册表里的路径指向某个没有版本号的 `.ps1`、任务计划程序里配着过时的命令行、没有人知道改脚本之后要怎么分发。

**放进模块，用 `Install-Module` 分发，用 `Publish-Module` 版本化。** 换来的是 `Get-Module -ListAvailable` 能查到版本、`Update-Module` 能升级、`Import-Module` 显式声明依赖。
:::

::: danger 别在脚本里硬编码密码和路径
- **密码**：用 `[PSCredential]` 接收参数，用 `Get-Credential` 提示输入，用 Windows 凭据管理器或组策略存
- **路径**：用参数传进来，不要写死 `C:\Users\MAX\...`；用 `$env:ProgramFiles` 而不是 `C:\Program Files`
- **域和服务器名**：做成参数默认值，别散落在脚本各处

**脚本会被别人拿去用，硬编码的东西就是别人的 bug。**
:::

**也别指望 PowerShell 脚本能替代所有自动化工具。** 配置文件管理用 DSC 或组策略、日志收集用事件转发、部署用专业的工具 —— 每个领域都有比临时脚本更可靠的方案。

## 哪些是通用的

**「参数化 + 明确的作用域 + 区分错误类型」换平台完全一样。**

| 这里学的 | Linux 上对应 |
| --- | --- |
| `param()` 块 | 位置参数 `$1` / `shift` |
| `[CmdletBinding()]` | `set -euo pipefail` + 参数解析 |
| `Mandatory` | 不给值就 `exit 1` |
| `ValidateSet` / `ValidateRange` | `case` / 手动校验 |
| splatting `@params` | 展开成多个参数 |
| `$PSScriptRoot` | `$(dirname "$0")` |
| 作用域链 | shell 函数用 `local` / `declare` |
| `$ErrorActionPreference` | `set -e` |
| 终止性 / 非终止性 | `exit`（终止）/ 返回码非零（不终止） |
| `try/catch` | `if` + 返回码检查，或 `set -e` |
| `$LASTEXITCODE` | `$?` |
| `Write-Verbose` | 写到 stderr 或 `/dev/null` |

**明确不通用的部分：**

- **动态作用域**。这是最本质的差异。Linux shell 函数能看到的也是调用者的变量（`bash` 默认不隔离局部变量），但**`sh` 的函数参数是隔离的**。PowerShell 明确采用「函数创建调用者作用域的子作用域」这一套，写脚本时不能假设变量是隔离的
- **错误模型**。PowerShell 把错误做成对象（`$_` 里有 `Exception`、`CategoryInfo`、完整调用栈），Unix 工具链传递的是退出码。**PowerShell 的错误信息更丰富，Unix 的错误处理更可组合**
- **参数化方式**。`getopt` 是逐个解析的，`param()` 块是声明式的，bash 的 `getopts` 能力弱得多
- **管道载荷**。这条在 [管道与对象](/windows/howto/08-pipeline) 讲过：PowerShell 传对象，bash 传文本
- **脚本的加载模型**。`.ps1` 要过执行策略，`sh` 脚本没有这个概念；PowerShell 的模块有显式依赖声明和版本约束，`sh` 脚本只有 `source`

## 跑完之后

Windows 这条线到这里就走完了一遍。十二章覆盖了从 `cd` 和 `dir` 开始，到注册表、计划任务、WinRM 和脚本编写。

回到 [Windows 速查表](/windows/reference/cheatsheet) 把双轨对照表收一遍，或者去 [进度页](/windows/reference/progress) 看哪些徽章还没点亮。

顺手看一眼 [CMD 与 PowerShell 基础命令](/windows/guide/01-file-system) —— 那是整条线的起点，路径和引号的规则在后面十章里一直在用。

## 📝 配套练习

<QuizBlock module-id="12-powershell-script" />
