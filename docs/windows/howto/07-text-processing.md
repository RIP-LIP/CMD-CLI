---
title: 文本处理：Findstr 与 Select-String
description: 两条 shell 各自的文本搜索写法，以及编码导致的「明明有却搜不到」。
---

# 文本处理：Findstr 与 Select-String

> 读完你会写出两种 shell 的文本搜索，并且能一眼判断出「搜不到」是模式写错了还是文件编码不对。这一章大约 28 分钟。

<ModuleMeta module-id="07-text-processing" />

## 前置条件

**建一个内容已知的小文件，后面所有测试都对着它做。**

```cmd
mkdir C:\Temp\text
cd C:\Temp\text
@echo off
echo ERROR: disk not found> app.log
echo INFO: started>> app.log
echo warning: retrying>> app.log
type app.log
```

你应该看到三行。

**确认当前代码页**，后面所有编码问题都和它有关：

```cmd
chcp
```

你应该看到类似 `活动代码页: 936`（简体中文 GBK）或 `437`。`936` 是中文系统的默认值。

PowerShell 侧：

```powershell
$PSVersionTable.PSVersion.Major
```

`5` 和 `7` 在本章的编码行为上**完全不同**，记住你手上是哪个。

## 1. 搜内容：两套语法，两个正则引擎

**`findstr` 的默认模式是「字面子串」，`Select-String` 的默认模式是「正则」。这个默认值不同会导致同一份脚本在两边结果不同。**

| 意图 | CMD `findstr` | PowerShell `Select-String` | 是否改动数据 |
| --- | --- | --- | --- |
| 搜固定文本 | `findstr "disk" app.log` | `Select-String -SimpleMatch 'disk' app.log` | 否 |
| 搜正则 | `findstr /r "dis. not" app.log` | `Select-String -Pattern 'dis.\s+not' app.log` | 否 |
| 忽略大小写 | 默认就忽略 | 默认也忽略，加 `-CaseSensitive` 才区分 | 否 |
| 区分大小写 | `findstr /i` 取消忽略 | `Select-String -CaseSensitive` | 否 |
| 搜多个文件 | `findstr "disk" *.log` | `Select-String -Pattern 'disk' -Path *.log` | 否 |
| 递归子目录 | `findstr /s "disk" *.log` | `Select-String -Pattern 'disk' -Path 'C:\Temp\*.log'` | 否 |
| 找**没有**该词的行 | `findstr /v "disk" app.log` | `Select-String -NotMatch 'disk' app.log` | 否 |
| 只看文件名（列表） | `findstr /m "disk" *.log` | `Select-String -Quiet -Path *.log` | 否 |
| 带行号输出 | `findstr /n "disk" app.log` | 默认对象带 `LineNumber` | 否 |
| 算出现次数 | `findstr /o` 不直观 | `Select-String -AllMatches \`\|`<br>`ForEach-Object { $_.Matches.Count }` | 否 |

```cmd
findstr "disk" app.log
```

你应该看到：

```text
ERROR: disk not found
```

```powershell
Select-String -Path app.log -Pattern 'disk'
```

你应该看到一张带列的表：

```text
Path      LineNumber Line              Matches
----      ---------- ----              -------
app.log           1 ERROR: disk not found
```

::: warning `findstr` 的正则是个残缺方言
`findstr /r` 支持的语法只是 .NET 正则的一个子集，而且有几个反直觉的点：

- `.` 匹配任意字符，`dis. not` 能匹配 `disk not`
- 字符类写成 `[a-z]` 没问题，但 `+` 和 `?` 的量词行为和标准正则**不完全一致**
- **没有内置的分组捕获输出能力**（`for /f` 那套组合起来极难用）
- `findstr` 的正则里**没有 `\d`、`\s`、`\w` 这些简写**（`\s` 会被当成字面的 `s`）
- 单引号在 CMD 里没有意义，`"正则"` 里的双引号需要转义

**能用 `-SimpleMatch` 就别用正则。** 需要真正的正则能力就用 `Select-String`，它背后是完整的 .NET 正则引擎：`\d`、`\s`、`(?<name>...)`、环视 `(?=...)`、懒惰量词 `+?` 全都能用。
:::

`findstr` 的一个必记限制：**参数里的 `/` 会被当成选项分隔符**。搜包含斜杠的文本，或者路径里有斜杠，都要用 `/c:` 明确指定：

```cmd
findstr /c:"2024/01/01" app.log
```

`Select-String` 没有这个问题，正则里的斜杠直接写。

## 2. 编码：搜不到的头号原因

**「文件里明明有这行，`findstr` 却说找不到」九成是编码问题，不是模式写错了。**

### 先看文件到底是什么编码

```powershell
Get-Content -Encoding Byte -TotalCount 4 app.log | ForEach-Object { '{0:X2}' -f $_ }
```

你应该看到 4 组十六进制数。

| 开头字节 | 是什么 |
| --- | --- |
| `FF FE` | UTF-16 LE（BOM） |
| `FE FF` | UTF-16 BE（BOM） |
| `EF BB BF` | UTF-8 with BOM |
| 干脆没有 BOM | 可能是 UTF-8 无 BOM、GBK、ASCII，**光看开头无法确定** |

**没有 BOM 的文件，你必须靠猜或者靠外部工具判断。** 这是所有编码问题的根源：Windows 靠 BOM 区分，Unix 靠约定。

### `findstr` 读不了 UTF-16

`findstr` 只能读单字节或 ANSI 编码的文件。给它一个 UTF-16 的文件，你会看到：

```text
FINDSTR: 无法打开 app.log
```

这个报错的措辞是「无法打开」而不是「编码不支持」，**很容易误导你去查文件权限和路径**。实际上文件权限完全正常。

::: danger PowerShell 的 `>` 造出的就是 UTF-16
这是本章最经典的一个组合陷阱：

```powershell
Get-Content C:\Temp\text\app.log | Select-String 'error' | Out-File C:\Temp\text\err.txt
```

如果你的 PowerShell 是 5.1，`err.txt` 会被写成 **UTF-16 LE**（带 BOM）。然后：

```cmd
findstr "error" C:\Temp\text\err.txt
```

你会看到「FINDSTR: 无法打开」——**而 `err.txt` 明明是上一步刚生成的、路径没错、内容也对。**

在 PowerShell 7 里 `>` 默认写 UTF-8 无 BOM，这个组合就正常了。所以**这个坑只在 5.1 上出现**，而 5.1 恰好是 Windows 自带的那个。

解决：写入时显式指定编码。

```powershell
Get-Content C:\Temp\text\app.log | Select-String 'error' | Out-File C:\Temp\text\err.txt -Encoding utf8
```

CMD 里要产出 5.1 能读的文本，用 `>>` 重定向而不是 PowerShell 的 `>`：

```cmd
findstr "disk" app.log > out.txt
```

CMD 的 `>` 跟随系统代码页（中文系统是 GBK/936），产出的文件 `findstr` 自己能读回去。
:::

### 读文件时也要指定编码

Windows PowerShell 5.1 的 `Get-Content` 不指定 `-Encoding` 时，按**系统 ANSI 代码页**解读字节。中文系统上就是 GBK。

```powershell
Get-Content -Encoding utf8 app.log
Get-Content -Encoding unicode app.log
Get-Content -Encoding byte app.log
```

| 编码名 | 对应 |
| --- | --- |
| `utf8` | UTF-8 **带 BOM**（5.1 的写入行为） |
| `utf8NoBOM` | UTF-8 无 BOM，⚠️ **仅 PowerShell 6+ 支持** |
| `unicode` | UTF-16 LE |
| `default` | 系统 ANSI 代码页 |
| `byte` / `asbyteStream` | 原样字节，用于自己判断编码 |

::: tip 5.1 里要 UTF-8 无 BOM，只能走 .NET
`-Encoding utf8NoBOM` 在 5.1 上会报「找不到接受实际参数 utf8NoBOM 的形参」：

```powershell
$text = Get-Content app.log
[System.IO.File]::WriteAllText('out.txt', $text, (New-Object System.Text.UTF8Encoding $false))
```

**凡是需要产出的文件要给别的工具读的，5.1 上都应该用这一行而不是 `Out-File`。** `TODO：待补充` —— 如果这台机器上有 PowerShell 7，直接用 `pwsh` 比绕这一段省事。
:::

`Select-String` 有自己的 `-Encoding`，直接指定比先读进来更省：

```powershell
Select-String -Path app.log -Pattern 'error' -Encoding utf8
```

### `chcp` 不解决文件编码

**`chcp` 改的是控制台「显示和交互」的代码页，跟文件里存的字节没有任何关系。**

```cmd
chcp 65001
```

这让控制台能正确显示 UTF-8 字节，**但不会改变任何文件的编码**。用 `chcp` 去「修」一个编码错误的文件，只会得到更多乱码。文件编码只能在读写时用 `-Encoding` 显式指定。

乱码和搜不到的区别：
- **乱码** = 读出来但认错了字符，屏幕上是 `鍙傛暟` 这种
- **搜不到** = 字节层面就匹配不上，`findstr` 直接报无法打开

## 3. 替换：只有 PowerShell 有

**`findstr` 没有任何替换功能。** 需要替换就用 PowerShell 的 `-replace`，或者 .NET 的字符串方法。

| 意图 | 写法 | 是否改动数据 |
| --- | --- | --- |
| 正则替换（每次匹配） | `-replace '旧', '新'` | ⚠️ 输出到新流 |
| 字面替换（只换首个） | `.Replace('旧','新')` | ⚠️ |
| 只替换开头的 | `-replace '^ERROR:', 'FATAL:'` | ⚠️ |

```powershell
(Get-Content C:\Temp\text\app.log) -replace 'ERROR', 'FATAL' | Set-Content C:\Temp\text\app2.log
```

你应该得到一个把 `ERROR` 换成 `FATAL` 的 `app2.log`。

::: warning `-replace` 是正则，`.Replace()` 是字面
```powershell
'a.b'.Replace('.', '-')      # a-b   （字面，把点当点）
('a.b' -replace '.', '-')    # a-b   （正则，. 匹配任意字符，结果同长度替换）
('a.c' -replace '.', '-')    # a-c   （正则，. 匹配的是它自己）
'a1c' -replace '.', '-'      # ---   （三个字符全被替换了）
```

**要在文本里匹配字面的点、星号、问号，反斜杠分支必须写成 `\.`**。这是从 Linux 迁移过来的第二个必踩点（第一个是 `ping -c`）。
:::

::: danger 别一边读同一个文件一边写回去
```powershell
(Get-Content a.log) -replace 'x', 'y' | Set-Content a.log
```

这条看起来能工作，**实际上很可能截断文件**。`Set-Content` 一开始就打开目标文件清空它，而 `Get-Content` 还在读同一个文件句柄，结果取决于两个 cmdlet 的执行顺序 —— 表现是「内容少了一截」或「空了」。

正确做法是先落到变量：

```powershell
$c = Get-Content a.log
$c2 = $c -replace 'x', 'y'
Set-Content a.log -Value $c2
```

**改文件之前先备份**这件事在 Windows 上尤其值得坚持，因为删除和覆盖都不会进回收站。
:::

## 4. 带行号和上下文

```cmd
findstr /n "disk" app.log
```

你应该看到：

```text
1:ERROR: disk not found
```

注意 `/n` 把行号拼在了行首，格式是 `行号:内容`。**这个冒号前缀会跟着流到下游**，之后拿这段输出做字符串处理时会连行号一起匹配到。

PowerShell 返回的是对象，**行号是独立属性，不污染内容**：

```powershell
Select-String -Path C:\Temp\text\app.log -Pattern 'disk' |
  ForEach-Object { "$($_.LineNumber): $($_.Line)" }
```

你应该得到同样一行，但行号和内容是分开的，下游可以放心用。

要连着上下几行一起看：

```powershell
Select-String -Path app.log -Pattern 'retrying' -Context 2,2
```

你应该看到匹配行前后各两行，`>` 开头是上下文行。`findstr` 做不到这个，只能靠 `more` 一页页翻。

::: tip `Select-String` 的对象能直接当结构化数据用
匹配结果对象上有 `Path`、`LineNumber`、`Line`、`Matches`、`Context`。`Matches` 里是每个匹配的 `Index`、`Length` 和 `Value`：

```powershell
Select-String -Path app.log -Pattern 'dis.' -AllMatches |
  ForEach-Object { $_.Matches.Value }
```

你应该得到匹配到的片段。**这种「拿到文本后又想按位置切」的需求，PowerShell 有，管道拼命令做不到。**
:::

## 排障

**Q1：`findstr` 说文件里没有这个词，但用记事本打开明明有？**

按这个顺序查，不要跳步：

1. `type 文件名` —— 用 CMD 自己读一遍，如果这里就是乱码，编码问题确认
2. `Get-Content -Encoding Byte -TotalCount 4 文件名 \`\|`<br>`ForEach-Object { '{0:X2}' -f $_ }` —— 看有没有 `FF FE`（UTF-16，`findstr` 读不了）
3. `copy /b 文件名 t.txt` —— 转成单字节试试，能搜到就确认是编码
4. 有 `findstr /l "词" 文件名` —— 强制字面模式，排除正则写错

**Q2：`findstr` 直接报「无法打开」而不是「未找到匹配项」？**

1. **这不是权限问题，是编码问题** —— 大概率文件是 UTF-16（`FF FE` 开头）
2. `Get-Content -Encoding Byte -TotalCount 2 文件名` —— 确认 BOM
3. 换成 `Select-String -Encoding unicode 文件名 -Pattern 词`
4. 或者用 `type 文件名 > 新文件` 转成单字节再搜

**Q3：搜中文永远搜不到？**

1. `chcp` —— 记下当前代码页，中文系统通常是 936
2. `type 文件名` —— 确认 CMD 能正确显示中文
3. `Select-String -Path 文件名 -Pattern 中文 -Encoding utf8` —— 显式指定
4. 文件是 GBK 存的却按 UTF-8 读，字符数都对不上，必然搜不到

**Q4：`-replace` 之后文件内容变少了？**

1. 检查是不是一边 `Get-Content` 一边 `Set-Content` 同一个文件 —— 见第 3 节的警告
2. `$c = Get-Content x; $c.Count` 看读进来多少行，改完再比一次
3. 确认写入时没加 `-Encoding` 导致 5.1 写成了 UTF-16，下一步 `findstr` 就读不了

**Q5：正则写了但行为和预期不符？**

1. `findstr` 改用 `-SimpleMatch` 的等价写法（`findstr "原文"`）看是不是模式本身的问题
2. 改用 `Select-String -Pattern`，它是完整的 .NET 正则
3. 注意 `\d`、`\s`、`\w` 在 `findstr` 里**不是简写**，只是字面字符
4. 注意 `-replace` 的 `.` 会匹配任意字符，不是字面的点

**Q6：搜出来的结果被行号前缀搞乱了？**

1. `findstr /n` 的输出是 `行号:内容`，分隔符是冒号
2. 改用 `Select-String` 的对象，访问 `$_` `.Line` 拿纯内容
3. 或者 `findstr` 不用 `/n`，行号另外用 `find /v "" /n` 拿

## 什么时候别用

**文本搜索在日志量大的时候，命令行方案都不是好选择。**

| 场景 | 换成 | 原因 |
| --- | --- | --- |
| 几百 MB 的日志 | `Select-String` 加 `-Encoding`，或专门的日志工具 | 全读进内存 |
| 需要按时间筛选 | 事件查看器 / `Get-WinEvent` 的过滤 | 见 [计划任务、事件日志与环境变量](/windows/internals/10-system-admin) |
| 要跨文件统计 | PowerShell 管道 + `Measure-Object` | 逐条 `findstr` 效率低 |
| 结构化数据（JSON/XML） | `ConvertFrom-Json` / `[xml]` | 正则在这种格式上不可靠 |
| 二进制文件 | 别搜 | 输出乱码还可能卡住 |

::: warning 别用文本搜索当配置管理
「改某个配置文件里的这个值」用 `Set-Content` 加 `-replace` 去做，一旦文件里有多个同样的字符串，它会把全部替换掉，而且**不给你任何提示**。改配置有专门的工具（组策略、注册表、`[xml]`/`ConvertFrom-Json` 对象化修改），改完能读回验证。文本替换只适合日志里做标记。
:::

**`findstr` 的正则方言也不适合复杂模式。** 一旦你需要分组、捕获、环视，换 `Select-String`。用 `findstr` 的合理场景基本只有「在纯 ASCII 文本里找一个固定字符串」。

## 哪些是通用的

**「搜内容」这件事换平台一样。**

| 这里学的 | Linux 上对应 |
| --- | --- |
| `findstr "词" 文件` | `grep '词' 文件` |
| `Select-String -Pattern '词' 文件` | `grep -E '词' 文件` |
| 递归搜 | `grep -r` / `find ... -exec grep` |
| 取反 | `findstr /v` / `grep -v` |
| 只列命中的文件 | `findstr /m` / `grep -l` |
| 统计次数 | `Select-String -AllMatches` / `grep -c` |
| 带行号 | `findstr /n` / `grep -n` |
| 替换后重定向 | `sed 's/a/b/g' f` |
| 编码指定 | `iconv` / `--encoding` |

**明确不通用的部分：**

- **正则引擎**。`findstr` 是残缺方言，`grep -E` 是 POSIX ERE，`Select-String` 是完整的 .NET 正则（支持环视、命名组、平衡组）。三者的能力集不重叠，**同一个模式在三个工具上的结果可能不同**
- **默认是否忽略大小写**。`findstr` 默认忽略，`grep` 默认区分，`Select-String` 默认忽略。想做行为一致的批量改动，**先在两边各测一遍**
- **输出格式**。`grep -n` 的 `行号:内容` 格式是惯例，Windows 这边 `findstr /n` 碰巧一致，但 `Select-String` 刻意不给行号前缀而是放在属性里
- **编码处理**。Linux 上 `grep` 不做编码转换（转换是 `iconv` 的事），Windows 这边编码是与不是能否匹配的常见决定因素

## 跑完之后

下一章把本章的 `Select-String` 放进管道里用，讲清楚 PowerShell 真正的强项：九组管道命令怎么组合，以及为什么这里不能照搬 Unix 写法。

→ [管道与对象：PowerShell 的真正优势](/windows/howto/08-pipeline)

## 📝 配套练习

<QuizBlock module-id="07-text-processing" />
