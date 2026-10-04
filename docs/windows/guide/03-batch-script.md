---
title: 批处理脚本：变量、条件与循环
description: .bat 的基本结构与延迟展开陷阱，末尾附 PowerShell 的对应写法。
---

# 批处理脚本：变量、条件与循环

> 读完你会写出一个能重跑的 `.bat`，并且知道为什么同一个变量在 `for` 循环外面能读到、里面读不到。这一章大约 35 分钟，是上手篇里最需要反复读的一节。

<ModuleMeta module-id="03-batch-script" />

## 前置条件

**先确认你有一个能建脚本文件的地方，以及 `cmd` 就在手边。**

```cmd
md C:\Temp\scripts
cd C:\Temp\scripts
```

```powershell
New-Item -ItemType Directory -Path C:\Temp\scripts -Force
Set-Location C:\Temp\scripts
```

你应该已经在 `C:\Temp\scripts`。

确认一下当前工作目录没有被组策略锁住 —— 有些企业机器上当前目录不可执行：

```cmd
cd /d C:\Temp && echo ok
```

`&&` 后面能执行才算通过。另外 `.bat` 双击运行时的当前目录是**脚本所在目录**，而从别的目录调用它时当前目录是**你所在的位置** —— 这个差异后面会专门讲。

## 1. 一个 `.bat` 的骨架

**只有四行是必需的，但第四行决定了后面所有代码的读法。**

```bat
@echo off
setlocal enabledelayedexpansion
set NAME=MAX
echo Hello, %NAME%
endlocal
```

把它存成 `hello.bat`，然后：

```cmd
hello.bat
```

你应该看到：

```text
Hello, MAX
```

逐行拆开：

| 行 | 作用 | 是否改动数据 |
| --- | --- | --- |
| `@echo off` | 关掉命令回显，只显示你写的输出 | 否 |
| `setlocal enabledelayedexpansion` | 开局部变量，并启用 `!var!` 延迟展开 | 否 |
| `set NAME=MAX` | 定义变量 | 否 |
| `echo Hello, %NAME%` | 立即展开 `%NAME%` 并输出 | 否 |
| `endlocal` | 丢弃本层所有局部变量 | ⚠️ 环境变量 |

::: tip `@` 是「关掉这一行自己的回显」
它只作用于紧跟其后的那一个命令。写 `@echo off` 而不是 `echo off`，是因为 `echo off` 这一行本身还会被回显出来，打印一个多余的 `C:\Temp\scripts>echo off`。
:::

::: warning `set NAME=MAX` 等号两边不要有空格
`set NAME = MAX` 定义的是一个叫 `NAME ` 的变量（名字带尾随空格），值是 ` MAX`（值带前导空格）。这是脚本里最难查的一类 bug，因为 `set` 会正常返回成功。

正确写法是把整条赋值连引号一起包起来：

```bat
set "NAME=MAX"
set "GREETING=Hello World"
```

这样即使值里有空格和 `&`，也不会被解析成两条命令。**所有 `set` 赋值都该这么写**，没有例外。
:::

### 存成 UTF-8 之前先想清楚编码

`.bat` 文件本身被 CMD 按系统区域设置的代码页解析。文件里如果有中文，UTF-8 无 BOM 存进去会变成乱码，且**不会报错**。

```bat
chcp 65001
echo 中文测试
```

`chcp 65001` 切到 UTF-8 代码页。你应该看到中文正常显示。

::: warning 改代码页救不了已经存错的文件
`chcp` 只影响**运行时**的解释。如果文件是按 GBK 存的、里面是 UTF-8 字节，`chcp 65001` 会让乱码变得更乱。正确做法：用编辑器按系统默认的 ANSI/GBK 保存 `.bat`，或者文件全用英文。

如果你在 PowerShell 里写文件，注意 Windows PowerShell 5.1 的 `-Encoding UTF8` 会**写 BOM**（带文件头的字节标记），而 `.bat` 解析器会把 BOM 当成文件内容的一部分，第一行可能报 `'□@echo' 不是内部或外部命令`。`TODO：待补充` —— 要用 UTF-8 无 BOM 写 `.bat`，需要用 .NET 的 `System.IO.File::WriteAllText` 显式指定编码。
:::

## 2. 延迟展开：`.bat` 最大的坑

**这一节是整章的核心。`%var%` 在读到的那一行就被替换掉了，不是执行的时候。**

先看一个必然出错的写法：

```bat
@echo off
setlocal
set COUNT=0
for /L %%i IN (1,1,3) DO (
    set /a COUNT+=1
    echo 第 %%i 次，COUNT 现在是 %COUNT%
)
```

你应该看到三次相同的结果：

```text
第 1 次，COUNT 现在是 0
第 2 次，COUNT 现在是 0
第 3 次，COUNT 现在是 0
```

`COUNT` 明明被加到了 3，为什么打印出来是 0？

**因为 CMD 在执行 `for` 之前就把整个 `( ... )` 块里的 `%COUNT%` 全部替换成了当前的字面值 `0`。** 循环体里的 `set /a COUNT+=1` 改的是运行时的变量，但 `echo` 那行早就变成 `echo 第 %%i 次，COUNT 现在是 0` 了，跟变量再无关系。

修法是延迟展开，把 `%COUNT%` 换成 `!COUNT!`：

```bat
@echo off
setlocal enabledelayedexpansion
set COUNT=0
for /L %%i IN (1,1,3) DO (
    set /a COUNT+=1
    echo 第 %%i 次，COUNT 现在是 !COUNT!
)
```

你应该看到：

```text
第 1 次，COUNT 现在是 1
第 2 次，COUNT 现在是 2
第 3 次，COUNT 现在是 3
```

| 写法 | 展开时机 | 什么时候用 |
| --- | --- | --- |
| `%VAR%` | **读到这一行时**，整块一次性替换 | 块外面、普通命令行 |
| `!VAR!` | **执行到这一行时**，逐次替换 | 括号块内、`for` 循环内、循环体里要读被循环修改的变量 |

::: warning 开了延迟展开就不能在值里用感叹号
`setlocal enabledelayedexpansion` 之后，值里的 `!` 会被当作变量定界符。想存带 `!` 的值（比如密码），要么写两遍让它转义（`a!b` 写 `a^^^!b` 视位置而定），要么在那几行用 `setlocal disabledelayedexpansion` 临时关掉。**密码里有 `!` 是这行命令最常见的翻车原因。**
:::

### 双百分号：为什么循环变量要写 `%%i`

**在 `.bat` 文件里循环变量必须写 `%%i`，在命令行里直接敲只写 `%i`。**

```cmd
for /L %i IN (1,1,3) DO echo %i
```

你在命令提示符里敲这条，看到 1、2、3。同一逻辑放进 `.bat` 文件，`%i` 会被当成普通变量先被展开成空字符串，循环就没了 —— 所以文件里必须是 `%%i`。这个差异纯粹是 CMD 为了区分「命令行」和「批处理」两层解析而设计的。

`for` 循环的变量按顺序是 `%%a`、`%%b`、`%%c`…… 很多人习惯用 `%%i`，但 `i` 没有任何特殊含义，`%%a` 和 `%%i` 完全等价。

### `for /f` 读命令输出

```bat
@echo off
setlocal enabledelayedexpansion
for /f "tokens=2 delims= " %%a in ("hostname") do set COMPUTER=%%a
echo 这台机器叫 !COMPUTER!
```

你应该看到机器名。

`for /f` 是 `.bat` 里唯一能「把命令输出当数据用」的结构。参数拆解：

| 参数 | 作用 |
| --- | --- |
| `tokens=2` | 取第 2 个空白分隔的片段 |
| `delims= ` | 以空格为分隔符 |
| `usebackq` | 允许在 `in (...)` 里用引号和文件路径，写文件时必加 |
| `skip=1` | 跳过前 1 行（读带表头的 CSV 时用） |
| `findstr="x"` | 只保留含 x 的行 |

`for /f` 有三种输入形式，行为完全不同：

```bat
for /f "delims=" %%a in (command) do ...        REM 某命令的输出
for /f "delims=" %%a in (文件路径) do ...      REM 逐行读文件
for /f "delims=" %%a in ("字符串") do ...       REM 逐词拆这个字符串
```

::: danger 读文件时每一行都会被自动拆分
`for /f "delims=" %%a in (data.txt) do echo %%a` 里 `delims=` 后面为空表示「不拆分」，整行原样给 `%%a`。如果你写成 `for /f %%a in (data.txt) do ...` 而没给 `delims`，默认分隔符是空格和制表符，**每行只拿到第一个词**。行内其余内容会静默丢失。
:::

## 3. 条件：`if` 的两个陷阱

| 判断 | 写法 | 是否改动数据 |
| --- | --- | --- |
| 文件或目录存在 | `if exist "C:\data" echo 在` | 否 |
| 存在则删 | `if exist "C:\tmp\x" del "C:\tmp\x"` | ⚠️ 删文件 |
| 字符串相等 | `if "%A%"=="%B%" echo 相同` | 否 |
| 数值比较 | `if %N% GTR 10 echo 大于10` | 否 |
| 命令是否执行成功 | `if errorlevel 1 echo 上一步失败了` | 否 |
| 上一条命令是否失败 | `if not errorlevel 1 echo 成功了` | 否 |

### `if errorlevel N` 是「大于等于」，不是「等于」

`if errorlevel 1` 的含义是「退出码 **大于或等于** 1」。想判「正好等于 1」必须写 `if errorlevel 1 if not errorlevel 2`。

**退出码大于 0 一般都表示失败**，所以日常用 `if errorlevel 1` 就够 —— 除非你在意具体的错误码。

### `if exist` 后面有空格，路径就废了

```bat
if exist C:\Program Files\app.exe echo 装好了
```

这条会把 `if exist C:\Program` 和 `Files\app.exe echo 装好了` 当成两段，`Files\app.exe` 被当成要执行的命令。**`if exist` 的参数必须加引号**：

```bat
if exist "C:\Program Files\app.exe" echo 装好了
```

这是 `.bat` 里漏引号最常见的表现形式，因为它不一定报错，可能只打印后半段的奇怪结果。

## 4. `call`、`goto`、`exit /b` 三件套

**`call` 有两个不相关的用途，很多人只知道一个。**

### 用途一：调用另一个批处理

```bat
@echo off
call setup.bat
echo 主脚本继续，这里应该能看到
```

你应该看到 `setup.bat` 的输出，然后是主脚本的下一行。

不加 `call` 直接写 `setup.bat`，控制权不会回到主脚本 —— 主脚本后面的所有行都被跳过。这是新手写 `.bat` 最常见的「脚本只跑了一半」。

### 用途二：转义百分号

在延迟展开的块里，想输出一个真正的 `%`（比如打印日期格式），要用 `call` 骗过解析：

```bat
@echo off
echo 日期格式：%%Y-%%m-%%d
call echo 这里也是百分号：%%Y
```

第一条里 `%%` 在 `.bat` 文件里会变成单个 `%`。第二条里 `call` 触发一次额外的解析轮次，`%%Y` 被替换成 `%Y` 再执行，于是输出 `%Y`。

::: tip `call echo` 是打完补丁的办法
它的副作用是参数会被额外解析一轮。**正常输出变量直接用 `echo !VAR!`**，只有在需要输出百分号本身这种特殊情况才用 `call echo`。
:::

### `goto` 循环

```bat
@echo off
setlocal
set COUNT=0
:again
set /a COUNT+=1
if !COUNT! LEQ 3 (
    echo 第 !COUNT! 次
    goto again
)
echo 共 !COUNT! 次
endlocal
```

你应该看到三次「第 N 次」然后是「共 3 次」。

::: warning `goto` 循环里必须开延迟展开
上面这段的 `setlocal` 后面**应该**写 `setlocal enabledelayedexpansion`。只写 `setlocal` 而用 `!COUNT!`，脚本会报「此时不应有 !COUNT!」。本例的 `if !COUNT! LEQ 3` 在括号块里，正是需要延迟展开的场景。

标签必须写在行首，前后不能有空格。标签名区分大小写不敏感，但 `goto :eof` 是保留写法，表示跳到脚本末尾。
:::

### `exit /b` 和 `exit`

| 写法 | 作用 |
| --- | --- |
| `exit /b 0` | 结束当前批处理，退出码 0（成功） |
| `exit /b 1` | 结束，退出码 1（失败） |
| `exit /b` 单独用 | 结束当前批处理，退出码不变 |
| `exit` | 关掉整个 `cmd.exe` 窗口 |

在 `.bat` 里**永远用 `exit /b`**，用 `exit` 会把调用它的那个命令行窗口也一起关掉。

## 5. 同一件事的 PowerShell 写法

**`.bat` 里的每个结构在 PowerShell 里都有直接对应的、且不踩坑的写法。这是判断该不该继续用 `.bat` 的标准。**

| 意图 | `.bat` | `.ps1` |
| --- | --- | --- |
| 关回显 | `@echo off` | 无需，PowerShell 本来就干净 |
| 定义变量 | `set "N=1"` | `$N = 1` |
| 读变量 | `echo %N%` | `$N` 或 `"$N"` |
| 条件 | `if %N% GTR 0 echo yes` | `if ($N -gt 0) { 'yes' }` |
| 计数循环 | `for /L %%i IN (1,1,3) DO ...` | `1..3 \| ForEach-Object { ... }` 或 `for ($i=1; $i -le 3; $i++)` |
| 遍历文件 | `for %%f IN (*.txt) DO echo %%f` | `Get-ChildItem *.txt \| ForEach-Object { $_.Name }` |
| 读命令输出 | `for /f %%a in ('hostname') do ...` | `$x = hostname` 或 `$(hostname)` |
| 死循环 | `goto` | `while ($true) { }` |
| 结束并返回码 | `exit /b 0` | `exit 0` |
| 局部作用域 | `setlocal` / `endlocal` | 函数或 `& { }` 脚本块 |
| 读用户输入 | `set /p N=请输入：` | `$N = Read-Host '请输入'` |
| 等用户按键 | `pause` | `Read-Host '按回车继续'` |

```powershell
$N = 0
1..3 | ForEach-Object {
    $N++
    "第 $_ 次，N 现在是 $N"
}
```

你应该看到：

```text
第 1 次，N 现在是 1
第 2 次，N 现在是 2
第 3 次，N 现在是 3
```

**同样的逻辑，PowerShell 里不需要 `enabledelayedexpansion` 这种东西** —— 变量就是变量，不存在「解析时替换」这回事。上面这个循环在 `.bat` 里必须改写成延迟展开才正确。

::: tip 一个判断标准
`.bat` 唯一的优势是**双击就能跑**和**零依赖**（系统自带）。如果你的脚本需要判断、循环、错误处理，或者要被别的东西调用，直接写 `.ps1`。这个分界线之后 [PowerShell 脚本](/windows/internals/12-powershell-script) 会展开讲。
:::

## 排障

**Q1：`.bat` 双击后窗口一闪而过，什么都没看到？**

按这个顺序查，不要跳步：

1. 在脚本开头加 `pause` —— 或把 `@echo off` 去掉
2. 从命令行里敲 `脚本名.bat` 而不是双击 —— 窗口不会自动关
3. 看有没有中文乱码 —— 按第 1 节的编码说明重存文件

**Q2：`for` 循环里的变量一直是 0 或空？**

1. 确认脚本里有 `setlocal enabledelayedexpansion`
2. 把块内的 `%VAR%` 全部换成 `!VAR!`
3. 检查循环变量是不是写成了 `%i` 而不是 `%%i`

**Q3：`if exist` 明明文件在，却走进了 else 分支？**

1. 路径加引号：`if exist "C:\a b\x.txt"`
2. 确认当前目录 —— `cd` 不带参数看位置
3. `dir "路径"` 单独确认一次，路径没问题就是引号问题

**Q4：调用另一个 `.bat` 后，主脚本不继续了？**

1. 把 `其他.bat` 改成 `call 其他.bat`
2. 确认文件名没写错 —— CMD 找不到时错误信息是中文「系统找不到指定的文件」
3. 在主脚本和被调脚本里各加一行 `echo %~nx0` 打印自己的名字，确认调用链

**Q5：`set` 的值总是多一个空格或少一个？**

1. 检查等号两边 —— `set A = 1` 是错的
2. 改成 `set "A=1"` 的引号写法
3. `set A` 打印变量，所有值打引号看首尾

## 什么时候别用

**`.bat` 在这些情况下该换成 `.ps1`：**

| 需求 | 为什么 `.bat` 做不了 |
| --- | --- |
| 解析 JSON / XML | `.bat` 没有解析器，只能靠外部工具 |
| 错误处理（try/catch） | `.bat` 没有异常概念，只有退出码 |
| 处理非 ASCII 编码 | 代码页机制让编码问题无解 |
| 超过 50 行的逻辑 | `goto` 跳转会让流程图彻底不可读 |
| 需要被程序调用 | `.bat` 的退出码和标准输出行为不稳定 |
| 变量名超过 1 个字符时含特殊字符 | CMD 的变量命名规则极其受限 |

**反过来，`.bat` 该保留的情况：**

- 用户双击就能跑，不依赖系统装了 PowerShell
- 部署脚本的一部分，安装程序里跑
- 就是要执行一条已有的 CMD 命令

::: warning 不要用 `.bat` 做定时任务的载体
`schtasks` 跑 `.bat` 时看不到任何输出，出错只有事件日志里一条记录。而且 `.bat` 的当前目录由任务计划程序决定，很容易找不到相对路径的文件。写定时任务用 `.ps1` 加显式日志文件，见 [计划任务、事件日志与环境变量](/windows/internals/10-system-admin)。
:::

## 哪些是通用的

**「把重复操作固化成脚本」这个动作换平台一样成立，脚本语言的选择也一样。**

| 这里学的 | Linux 上对应 |
| --- | --- |
| `.bat` | `.sh` |
| `@echo off` | `set -e` 加输出重定向习惯 |
| 变量赋值 | `VAR=value` |
| 读取用户输入 | `read` |
| 条件 | `if` |
| 循环 | `for` / `while` |
| 退出码 | `exit N` |
| 脚本目录变量 | `%~dp0` 对应 `$(dirname "$0")` |

**明确不通用的部分：**

- **展开时机**。`.bat` 的 `%VAR%` 在解析时替换是 CMD 独有的历史包袱，`.sh` 是「先解析变量再执行」，两者的坑位置不同
- **参数语法**。`.bat` 用 `%1`、`%~1`（去掉引号）、`%~dp0`（脚本目录）这套修饰符，`.sh` 用 `$1`、`"$1"`、`$(dirname "$0")`
- **控制字符**。`.bat` 里 `^`、`%`、`!` 都是语法字符，`.sh` 里是 `$`、反引号、引号。密码里含这些字符是两类脚本共同的坑
- **错误处理**。`.bat` 只能查退出码，`.sh` 有 `set -euo pipefail`

## 跑完之后

下一章转向 PowerShell 本身：管道里跑的到底是对象还是文本，以及为什么 `ls` 能用但 `grep` 不能。

→ [PowerShell：对象管道与别名体系](/windows/guide/04-powershell-intro)

## 🎮 实战演练

<ArenaTasks module-id="03-batch-script" />

<ToyWinTerminal module-id="03-batch-script" />

## 📝 配套练习

<QuizBlock module-id="03-batch-script" />
