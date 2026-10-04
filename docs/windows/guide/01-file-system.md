---
title: CMD 与 PowerShell 基础命令
description: 两条 shell 各说什么、怎么互相翻译，以及路径里那些必须加引号的时刻。
---

# CMD 与 PowerShell 基础命令

> 读完你会有一张随身对照表：想干一件事，先想 CMD 怎么说、再想 PowerShell 怎么说，两种写法都对但含义不完全一样。这一章大约 22 分钟。

<ModuleMeta module-id="01-file-system" />

## 前置条件

先把两条 shell 的版本问出来，后面所有行为差异都跟版本有关：

```cmd
ver
```

你应该看到类似这样的一行，括号里的 `10.0.xxxxx.xxxx` 是构建号，不同系统不一样：

```text
Microsoft Windows [版本 10.0.22631.2861]
```

在 PowerShell 里再问一次：

```powershell
$PSVersionTable.PSVersion
```

你会看到三行，`MajorVersion` 是 `5` 或 `7`。

::: warning 5 和 7 不是小差别
`5` 是 Windows 自带的 Windows PowerShell，只在系统内置的 cmd.exe 里可用。`7` 是跨平台的 PowerShell，需要单独安装。两者命令名几乎一样，但**默认输出编码不同**、部分参数不同。本章的命令两边都能用，从 [文本处理](/windows/howto/07-text-processing) 开始编码问题会变得关键。
:::

确认登录身份和起始位置：

```cmd
whoami
echo %CD%
```

你应该看到 `计算机名\用户名` 和一个绝对路径。

## 1. 先认路：我在哪、这里有什么

**新到一台 Windows 机器，第一个动作永远是 `cd` 加 `dir` 两连。**

| 意图 | CMD | PowerShell |
| --- | --- | --- |
| 我在哪 | `cd`（不带参数）或 `echo %CD%` | `Get-Location`（别名 `pwd` / `gl`） |
| 切换目录 | `cd` | `Set-Location`（别名 `cd` / `sl`） |
| 列目录 | `dir` | `Get-ChildItem`（别名 `gci` / `ls` / `dir`） |
| 读文件 | `type` | `Get-Content`（别名 `gc` / `cat`） |
| 新建目录 | `md` | `New-Item -ItemType Directory`（别名 `ni`） |
| 删文件 | `del` | `Remove-Item`（别名 `rm` / `del`） |
| 删目录 | `rd` / `rmdir` | `Remove-Item`（别名 `rm` / `rdir`） |
| 复制 | `copy` | `Copy-Item`（别名 `cp`） |
| 移动改名 | `move` / `ren` | `Move-Item`（别名 `mv`） |

这张表是本章的骨架。注意最后三行 CMD 侧和 PowerShell 侧**不是同一个程序**，只是碰巧拼写一样 —— 这个差别在第 2 章会咬人。

### `cd` 不带参数，两边行为一致

```cmd
cd
```

你应该看到当前目录的绝对路径：

```text
C:\Users\MAX
```

PowerShell 里：

```powershell
Get-Location
```

你应该看到：

```text
Path
----
C:\Users\MAX
```

::: warning PowerShell 的 `pwd` 返回的不是字符串
`Get-Location` 返回一个 **PathInfo 对象**。直接拿它做字符串操作会静默拿到空值或者报方法找不到。要字符串就得写 `$PWD.Path` 或 `(Get-Location).Path`：

```powershell
$PWD.Path
```

这个坑不像报错那样明显 —— 有些方法调用会失败，有些场景下 PowerShell 会帮你转换，行为不一致。所以在脚本里永远显式写 `.Path`。
:::

### `cd` 到别的盘符，要加 `/d`

```cmd
cd C:\Windows
```

你应该看到 `C:\Windows`。

```cmd
cd D:\data
```

**在 CMD 里这条命令不生效**，你会发现自己还在 `C:\` 下面。必须写：

```cmd
cd /d D:\data
```

`/d` 这个开关的文档藏得很深，它的意思是「顺便切换当前驱动器」。不带 `/d` 时 `cd` 只把目标当成当前盘上的一个子目录去找，找不到就静默留在原地 —— 不报错，这是最难查的一类问题。

PowerShell 没有这个问题，`Set-Location D:\data` 直接就能切。

### 切换到上两级

```cmd
cd ..\..
```

在 CMD 里 `\` 是路径分隔符；PowerShell 里 `\` 和 `/` 都认，`../..` 也能用。

跨盘符的 `..` 只能回到目标路径内部的上级，**不能用 `..` 从 `C:\` 跳到 `D:\` 的父目录**，这是路径语义的边界，不是 shell 的限制。

## 2. `dir` 和 `Get-ChildItem` 输出不一样，这不是 bug

**同一个目录，CMD 给一张详细表，PowerShell 只给一列名字。理解这个差异，你就知道什么时候该用哪个。**

```cmd
dir
```

你应该看到这样的结构：

```text
 驱动器 C 中的卷没有标签
 卷序列号是 8E4A-1C2B

 目录 C:\Users\MAX

09/12/2025  10:23    <DIR>          Desktop
09/12/2025  10:23             22  notes.txt
               1 个文件              22 字节
               1 个目录
```

PowerShell 里：

```powershell
Get-ChildItem
```

你应该看到：

```text
    Directory: C:\Users\MAX

Mode                 LastWriteTime         Length Name
----                 -------------         ------ ----
d----        2025/9/12   10:23:00                Desktop
-a---        2025/9/12   10:23:00                 22 notes.txt
```

两边的差别是结构性的，不是排版差异：

| | CMD `dir` | PowerShell `Get-ChildItem` |
| --- | --- | --- |
| 目录标记 | `<DIR>` | 结尾一个 `/` |
| 默认内容 | 名字 + 大小 + 时间 | 名字（PowerShell 也有大小时间，只是不同视图） |
| 结尾统计 | 有「N 个文件 / N 字节」 | 无 |
| 卷序列号 | 固定会打印 | 不打印 |

::: tip CMD 的 `dir /b` 才是 PowerShell 的默认视图
`dir /b`（bare）去掉表头和统计，只出名字。想让 CMD 的输出接近 PowerShell，加 `/b`；想在 PowerShell 里要 CMD 那张表，管道接 `Format-Table` 或 `Out-String`。

```cmd
dir /b
```

```powershell
Get-ChildItem | Format-Table
```
:::

只看目录：

```cmd
dir /ad /b
```

```powershell
Get-ChildItem -Directory
```

你应该只看到 `Desktop` 一行。CMD 的 `/ad` 是「按目录过滤」，PowerShell 用 `-Directory` 参数 —— **CMD 用斜杠加字母，PowerShell 用连字符加单词**，这个拼写差异贯穿整章。

## 3. 读文件：`type` 和 `Get-Content`

**读文件用 `type`，但 `type` 只适合小文件，大文件会顶满屏幕。**

```cmd
type notes.txt
```

你应该看到文件里的两行内容。

PowerShell：

```powershell
Get-Content notes.txt
```

参数对照：

| 意图 | CMD | PowerShell | 是否改动数据 |
| --- | --- | --- | --- |
| 全部读出 | `type` | `Get-Content` | 否 |
| 只看开头 | 无对应 | `Get-Content -TotalCount 10` | 否 |
| 只看结尾 | 无对应 | `Get-Content -Tail 10` | 否 |
| 边读边跟 | `type x.txt \| more` | `Get-Content -Wait` | 否 |
| 显示行号 | 无对应 | `Get-Content \| ForEach-Object {...}` | 否 |

::: warning `Get-Content` 一次读进内存，`-Tail` 才不整读
`Get-Content file.txt` 会把整个文件读进内存输出，几 GB 的日志会让 PowerShell 卡住甚至内存爆掉。看大文件尾部一律加 `-Tail 50`。CMD 的 `type` 也有同样问题，分页的替代品是 `more`（只往下翻，不支持回翻）。
:::

## 4. 路径怎么写：三类必须加引号的情况

**路径里只要出现空格，就必须加引号 —— 没有例外。**

```cmd
type "C:\Users\MAX\My Documents\report.txt"
```

你应该看到文件内容。不加引号的话 CMD 会把 `My` 当成完整路径，然后报：

```text
系统找不到指定的路径。
```

::: danger `cd` 不加引号时报的错会误导你
不加引号时 `cd C:\Users\MAX\My Documents` 的报错是「系统找不到指定的路径」，很容易让人以为是路径不存在，实际是引号问题。**先加引号再怀疑路径**，这个顺序能省掉一半的排查。
:::

必须加引号的三类情况：

| 情况 | 例子 | 不加引号的后果 |
| --- | --- | --- |
| 含空格 | `C:\Program Files\app.exe` | 路径被截断，报「找不到」 |
| 含 `&` `(` `)` `!` `^` | `C:\work\a&b.txt` | CMD 把它当命令连接符，执行出错或挂起 |
| 结尾带反斜杠且后面紧跟引号 | `"C:\data\"` | 结尾反斜杠会转义掉闭合引号 |

第三种最隐蔽，CMD 里应该写成 `"C:\data\\"` 或者干脆去掉结尾反斜杠。PowerShell 用单引号可以完全避开这套转义：

```powershell
Get-Content 'C:\Program Files\app\config.json'
```

::: tip 用单引号代替双引号
PowerShell 里单引号字符串不做变量替换，`$`、`"`、反斜杠全部按字面处理。路径、命令行参数、JSON 片段一律用单引号，能省掉一整类「为什么我的变量不见了」的问题。
:::

### 路径大小写不敏感

```cmd
dir C:\USERS\max\notes.TXT
```

你应该正常看到文件列表，**因为 Windows 路径比较忽略大小写**。

```powershell
Get-Content C:\users\max\NOTES.txt
```

同样能读到。

这一点和 Linux 相反。在 Linux 上 `cat notes.txt` 和 `cat NOTES.TXT` 是两个不同的文件；在 Windows 上它们是同一个。任何从 Linux 迁过来的自动化脚本，都要在 Windows 上重新验证一遍大小写 —— 反过来也一样，Windows 上写对的路径拿到 Linux 上会失败。

另外注意 CMD 的路径分隔符是 `\`，PowerShell 两者都收，但**PowerShell 里的 `/` 后面跟参数名容易被误读**，路径尽量统一用 `\`。

### CMD 里不能创建带这些名字的文件

有一批名字被系统占用，`New-Item` 也会失败：

```text
CON  PRN  AUX  NUL  COM1-COM9  LPT1-LPT9
```

`NUL` 是个特殊设备，不是文件。想丢弃输出用 `> NUL`：

```cmd
echo hello > NUL
```

你应该看不到任何输出。

## 排障

**Q1：`dir` 报「系统找不到指定的路径」，但文件明明在？**

按这个顺序查，不要跳步：

1. `echo %CD%` —— 先确认你真的在以为的那个目录里，提示符显示的路径容易看漏
2. `dir "路径"` —— 加上引号重试一次，路径有空格时这是唯一解
3. `dir C:\ /ad /b` —— 从盘根逐层往下走，定位到底是哪一层断了

**Q2：`cd D:\data` 没反应，也不报错？**

1. `echo %CD%` —— 确认还在 `C:\` 下面，这是 `cd` 不带 `/d` 的典型表现
2. `cd /d D:\data` —— 加上驱动器切换开关重试
3. `if exist D:\. (echo D盘在) else (echo D盘不在)` —— 用一条命令确认目标盘到底挂没挂上

**Q3：PowerShell 里 `Get-Location` 出来的路径做比较总是失败？**

1. `$PWD.GetType().Name` —— 应该是 `PathInfo`，不是 `String`
2. `$PWD.Path` —— 显式取属性再试
3. `Test-Path 'C:\目标路径'` —— 绕开字符串比较，直接问系统路径在不在

**Q4：明明写了文件名，却说找不到？**

1. `dir /b` —— 确认文件名，注意 Windows 隐藏了文件末尾的点和空格
2. `dir /a` —— 带 `/a` 列出隐藏和系统文件
3. 用 `dir /x` 看 8.3 短文件名 —— 老程序生成的文件可能只有短名

## 什么时候别用

**CMD 不是「过时的写法」，它有两个场景确实更省事。**

| 场景 | 为什么 CMD 更好 |
| --- | --- |
| 从网上复制一段命令 | 网上绝大多数 Windows 命令是 CMD 写法，粘进 PowerShell 大概率报参数错误 |
| 兼容 Windows 之外的旧环境 | 老版本 Windows、某些国产化环境的精简 cmd.exe 里没有 PowerShell |
| 需要给完全不懂 PowerShell 的人 | `dir` 四个字比 `Get-ChildItem` 好解释 |

**反过来，这几件事别用 CMD 做：**

- 需要条件判断、循环、变量处理 —— `.bat` 的 `for` 和 `if` 组合起来可读性会崩，直接看 [批处理脚本](/windows/guide/03-batch-script) 里为什么它这么难写
- 需要处理结构化数据（JSON、CSV、服务列表）—— CMD 没有对应的解析工具
- 处理非 ASCII 编码的文件 —— CMD 的输出编码跟随系统区域设置，PowerShell 可以显式指定，见 [文本处理](/windows/howto/07-text-processing)

**别在 PowerShell 里用 `ls` 期待它输出颜色和列对齐。** Windows 控制台默认不开 VT 转义，PowerShell 会退回到纯文本表格。真想要彩色输出得手动开 `$PSStyle.OutputRendering = 'AnsiEscape'`，但那会破坏日志重定向。

## 哪些是通用的

**「先定位，再操作」这个顺序换平台完全成立。**

| 这里学的 | Linux 上对应 |
| --- | --- |
| `echo %CD%` | `pwd` |
| `Get-Location` | `pwd` |
| `cd` 切目录 | `cd` 切目录 |
| 路径含空格要加引号 | 一样要加引号 |
| 先加引号再怀疑路径 | 一样的排查顺序 |

**明确不通用的部分：**

- **路径大小写**。Windows 忽略，Linux 敏感，macOS 默认也忽略（取决于文件系统）。这是本轨最需要跨平台注意的一条
- **分隔符**。Windows 惯用 `\`，Linux 只认 `/`。PowerShell 两边都收，纯 CMD 只认 `\`
- **参数风格**。CMD 是 `/b`、`/ad`，PowerShell 是 `-Directory`。混着写会报「找不到参数」

## 跑完之后

下一章讲**文件操作**：复制、移动、删除 —— 以及为什么 `del` 删不掉目录、PowerShell 的 `rm` 却在某些情况下会连目录内容一起删掉。

→ [文件操作：复制、移动、删除](/windows/guide/02-file-ops)

## 🎮 实战演练

<ArenaTasks module-id="01-file-system" />

<ToyWinTerminal module-id="01-file-system" />

## 📝 配套练习

<QuizBlock module-id="01-file-system" />
