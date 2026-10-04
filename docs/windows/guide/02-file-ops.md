---
title: 文件操作：复制、移动、删除
description: CMD 与 PowerShell 的等价写法，以及删除操作真正删掉了什么。
---

# 文件操作：复制、移动、删除

> 读完你会知道同一句「删掉这个目录」在两条 shell 里要敲什么，以及为什么键盘上相同的 `del` 在两边的结果完全不同。这一章大约 22 分钟。

<ModuleMeta module-id="02-file-ops" />

## 前置条件

**先建一个能随便删的练习目录，后面所有破坏性操作都在里面做。**

```cmd
md C:\Temp\demo
cd C:\Temp\demo
echo 第一行> a.txt
echo 第二行> b.txt
```

你应该看到 `C:\Temp\demo` 和一个刚建的空目录。

确认权限等级，因为权限不足和文件占用报的是不同的错：

```cmd
net session >nul 2>&1 && echo 管理员 || echo 普通用户
```

PowerShell 里：

```powershell
([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
```

你应该看到 `True` 或 `False`。本章的操作普通用户都能做，但**`C:\Windows`、`C:\Program Files` 里的操作会失败**，那不是命令写错了。

## 1. 复制文件：`copy` 与 `Copy-Item`

**复制是最不容易出错的一类操作，两边行为接近。**

```cmd
copy a.txt c.txt
```

你应该看到：

```text
        1 个文件已复制。
```

PowerShell：

```powershell
Copy-Item a.txt c.txt
```

`Copy-Item` 默认不输出任何东西。**没有输出不代表失败** —— 这是 PowerShell 的常态，和 CMD 有明显差别。

| 意图 | CMD | PowerShell | 是否改动数据 |
| --- | --- | --- | --- |
| 复制文件 | `copy 源 目标` | `Copy-Item 源 目标` | ⚠️ 新建目标文件 |
| 目标已存在就覆盖 | `copy /y 源 目标` | `Copy-Item -Force 源 目标` | ⚠️ 覆盖原文件 |
| 先看会发生什么 | 无 | `Copy-Item -WhatIf` | 否 |
| 复制整个目录 | `xcopy /s /e /i /y 源 目标` | `Copy-Item -Recurse 源 目标` | ⚠️ 大量新建 |
| 保留修改时间 | `copy /d` | 无对应 | 否 |

::: warning `copy` 不能复制目录
`copy src dest` 在 `src` 是目录时报「访问被拒绝」或者「文件名、目录名或卷标语法不正确」。要复制目录必须换 `xcopy` 或 `robocopy`。这是 `copy` 名字带来的误导 —— 它在 Linux 上对应 `cp -r`，两边不一样。
:::

::: tip `-WhatIf` 是唯一安全的删除方式
```powershell
Remove-Item C:\Temp\demo -Recurse -WhatIf
```
你应该看到它**列出会被删掉的东西然后什么都不做**。养成删东西前先加 `-WhatIf` 的习惯，它是 PowerShell 相对 CMD 最大的优势之一 —— CMD 没有等价的预演。
:::

### `xcopy` 的那个提问

```cmd
xcopy C:\Temp\demo\a.txt D:\backup
```

如果 `D:\backup` 不存在且这次要复制多个文件，`xcopy` 会停下来问：

```text
Does D:\backup specify a file name or a directory name?
```

CMD 的 `copy` 遇到目标是已存在的目录时，静默把文件放进去不问你；`xcopy` 却会问。**`/i` 就是替你回答「是目录」**，自动化脚本里不写 `/i` 就会卡在这一步等输入。

更省心的选择是 `robocopy`，它专为复制设计：

```cmd
robocopy C:\Temp\demo D:\backup /E
```

| `robocopy` 退出码 | 含义 |
| --- | --- |
| 0 | 一个文件都没复制 |
| 1 | 成功复制了文件 |
| 2 | 额外文件被排除 |
| 3 | 复制了文件且有排除 |
| 4 到 7 | 复制成功，同时有额外的重试或跳过 |
| **8 及以上** | **失败** |

::: danger `robocopy` 的退出码 0 不是成功
`robocopy` 成功时退出码可能是 1、2、3。**只有 0 表示「没复制任何东西」**。写自动化判断时用 `if errorlevel 8` 判失败，而不是 `if errorlevel 1`。这是从 Unix 带过来的习惯最常翻车的地方 —— Unix 惯例是 0 成功，robocopy 不是。
:::

## 2. 移动与重命名：`move` 和 `ren` 是两件事

**`move` 能跨目录也能改名，`ren` 只能改名 —— 目标位置必须是同一个父目录。**

| 意图 | CMD | PowerShell | 是否改动数据 |
| --- | --- | --- | --- |
| 改文件名 | `ren a.txt x.txt` | `Rename-Item a.txt x.txt` | ⚠️ 源路径失效 |
| 移到别的目录 | `move a.txt D:\backup\` | `Move-Item a.txt D:\backup\` | ⚠️ 源路径失效 |
| 跨盘移动（复制后删源） | `move a.txt D:\a.txt` | `Move-Item a.txt D:\a.txt` | ⚠️ 源被删除 |
| 批量改名 | 无内建命令 | 循环 + `Rename-Item` | ⚠️ |

```cmd
move a.txt b2.txt
```

你应该看不到任何输出 —— `move` 成功时是静默的。验证：

```cmd
dir /b
```

你应该看到 `b2.txt`，`a.txt` 不见了。

::: warning 移动是破坏性的，而且没有确认
`move` 之后原路径就没有文件了。移动到已存在的同名文件时**直接覆盖，不提示**。`Copy-Item` 同样如此（除非目标不存在同名文件）。真要防误覆盖，用 `Move-Item` 之前先 `Test-Path` 查一下目标在不在。
:::

`Rename-Item` 和 `ren` 共享一个限制：**只能改名字，不能顺便挪位置**。

```powershell
Rename-Item a.txt D:\backup\a.txt
```

这会报错，参数的位置不对。挪位置就用 `Move-Item`。

## 3. 删除：同一句 `del`，两边结果不同

**这是全站最值得记住的一条 Windows 行为差异，也是本章的核心。**

### `del` 删不了目录

```cmd
del C:\Temp\demo
```

你应该看到：

```text
拒绝访问。
```

这个报错**极具误导性** —— 它听起来像权限不够，实际是「这个目标是目录，`del` 不处理目录」。真实原因写在 `del` 的帮助里（`/?` 那一页的最后几行）。

PowerShell 里 `del` 是 `Remove-Item` 的别名，同一个词的语义完全不同：

```powershell
del C:\Temp\demo
```

**你会看到交互式确认**（非交互环境下报「确认」被拒绝）。加上 `-Recurse -Force` 就会把整个目录连内容一起删掉，不提示。

| 你输入的 | CMD 里 | PowerShell 里 |
| --- | --- | --- |
| `del 目录` | 报「拒绝访问」，不删 | `Remove-Item`，可能弹确认 |
| `del 文件` | 删掉 | 删掉 |
| `rm 目录` | CMD 没有 `rm`，报 9009 | `Remove-Item` |
| `rm -rf 目录` | 报 9009 | PowerShell 没有 `-rf`，报参数错误 |

::: danger PowerShell 没有 `-rf`，别照搬 Linux
`rm -rf dir` 在 PowerShell 里会报「找不到接受实际参数 r 的形参」。对应写法是 `Remove-Item dir -Recurse -Force`。**两条 shell 里 `rm` 都不是同一个程序**，这是 Linux 迁过来最容易出事的地方。
:::

### `rd` 删非空目录会失败

```cmd
rd C:\Temp\demo
```

你应该看到：

```text
目录不是空的。
```

加上 `/s` 才递归删除，`/q` 关掉确认提示：

```cmd
rd /s /q C:\Temp\demo
```

| 开关 | 作用 | 是否改动数据 |
| --- | --- | --- |
| `rd 目录` | 只删空目录 | ⚠️ 删空目录 |
| `rd /s 目录` | 递归删，含子目录和文件 | ⚠️⚠️ 不可逆 |
| `rd /s /q 目录` | 同上且不问 | ⚠️⚠️⚠️ 不可逆且无提示 |

::: warning `rd /s /q` 里 `/q` 省掉的是唯一的保险
`rd /s 目录` 会问「真的删除吗」，答错按错键就是整棵目录树。`/q` 把这个确认去掉。**手动敲不要加 `/q`；写自动化脚本时 `/q` 是必需的**，因为自动化环境没法回答交互提问。分清楚场景再写。
:::

PowerShell 的对应：

```powershell
Remove-Item C:\Temp\demo -Recurse -Force
```

`-Recurse` 对应 `/s`，`-Force` 对应 `/q`。`-Force` 在 PowerShell 里还有第二个作用：**能删掉只读文件和隐藏文件**，这是 `rd /s` 做不到的。

## 4. 删除真正删掉了什么

**Windows 的命令行删除不进回收站。`del`、`rd`、`Remove-Item` 全都是立即、永久、不可恢复的删除。**

| 入口 | 进回收站吗 |
| --- | --- |
| 资源管理器里按 Delete | 进 |
| `del` / `rd` | 不进 |
| `Remove-Item` | 不进 |
| `Clear-RecycleBin` | 只能清空已有的回收站内容 |

删之前能做的准备只有两个：复制一份，或者导出成压缩包。**没有第三种。**

```cmd
xcopy C:\Temp\demo D:\backup\demo /E /I /Y
```

压缩备份用：

```cmd
tar -a -c -f D:\backup\demo.zip C:\Temp\demo
```

`tar` 自带在 Windows 10 及之后的系统里。`-a` 让它按扩展名自动选压缩格式。`TODO：待补充` —— 早期 Windows 10 版本不带 `tar`，那种机器上用 PowerShell 的 `Compress-Archive`。

### 文件被占用时删不掉

```cmd
del a.txt
```

如果文件正被别的程序打开，你会看到：

```text
另一个程序正在使用此文件，进程无法访问。
```

`Remove-Item -Force` **也解不开文件锁** —— 它只处理只读和隐藏属性。占用是内核层面的句柄占用，加多少个 `-Force` 都没用。先找出谁占着：

```powershell
Get-Process | Where-Object { $_.Path -eq 'C:\Temp\demo\a.txt' } | Select-Object Id, ProcessName
```

你应该看到占用进程的 `Id` 和 `ProcessName`。然后决定是关掉它还是重启它。

## 排障

**Q1：`del 目录` 报「拒绝访问」，是不是权限不够？**

按这个顺序查，不要跳步：

1. `dir "路径"` —— 确认它真的是目录（`<DIR>` 标记）而不是文件
2. `rd /s "路径"` —— 目录就用 `rd`，`del` 只能删文件
3. `icacls "路径"` —— 只有这一步确认后才轮到权限，排除 ACL 问题
4. `attrib "路径"` —— 检查只读属性，有 `R` 就 `attrib -R` 再删

**Q2：提示「另一个程序正在使用此文件」？**

1. `tasklist /fi "imagename eq EXCEL.EXE"` —— 先猜常见占用者
2. PowerShell 里跑上面那条 `Get-Process | Where-Object { $_.Path -eq ... }` —— 拿到确切 PID
3. `taskkill /PID 1234 /F` ⚠️ 强制结束，确认不是你要的数据
4. 还不行就换路径 —— 少数系统进程和索引服务会长期持有句柄

**Q3：`xcopy` 卡在「specify a file name or a directory name」不动？**

1. 加 `/i` —— 让它别问，默认当目录
2. 目标目录先手工 `md` 建出来
3. 换 `robocopy /E` —— 这个问题根本不存在

**Q4：脚本里 `del` 删了目录，但报告说成功？**

1. 确认脚本跑在哪个 shell —— `.bat` 里 `del` 是 CMD 版，`.ps1` 里是 `Remove-Item`
2. `.ps1` 里改用 `Remove-Item -Recurse -Force`，写明确
3. 加 `Test-Path` 事后验证，别只信退出码

## 什么时候别用

**`Remove-Item -Recurse -Force` 和 `rd /s /q` 都不该用在「我不确定这个路径对不对」的地方。**

| 别用的情况 | 换成什么 |
| --- | --- |
| 路径来自变量、文件内容或用户输入 | 先 `Write-Host $path` 打出来看，确认是预期路径再删 |
| 路径里有通配符 `*` | 先 `Get-ChildItem $pattern` 看命中了什么，删具体项而不是删通配符 |
| 需要可恢复 | 不用命令行删，去资源管理器 |
| 要删整个用户目录或盘符根 | 停手，重新读一遍你要做什么 |

**`rm` 这个词在两条 shell 里含义不同，脚本里不要跨 shell 复用同一条命令。** 一个 `.bat` 和一个 `.ps1` 交替调用时，`rm` 在前者是「命令不存在」，在后者是递归删除。你以为没执行，其实第一个报了 9009 被忽略了。

批量改名更不该硬用 `ren`：它没有通配符替换。要做 `file1.txt` 到 `file01.txt` 这样的补零，CMD 得写嵌套 `for` 循环，PowerShell 三行就能搞定 —— 这种活交给 [PowerShell 脚本](/windows/internals/12-powershell-script)。

## 哪些是通用的

**「先看清楚要动什么，再动手」换平台一样成立。**

| 这里学的 | Linux 上对应 |
| --- | --- |
| `copy` 复制文件 | `cp` |
| `move` 移动改名 | `mv` |
| 删除前先看路径 | 一样 |
| 复制目录要额外的递归开关 | `cp -r` |

**明确不通用的部分：**

- **删除的确认方式**。Linux 的 `rm -i` 逐个问，Windows 命令行默认一个都不问
- **回收站**。macOS 的 `rm` 也能配合 `.Trash`，Windows 命令行没有任何等价物
- **删除目录的关键词**。`rd` 和 `rmdir` 是 Windows 独有的写法，`rmdir` 本身在 Unix 早期也有但行为不同
- **文件锁的报错文案**。中文系统报「另一个程序正在使用此文件」，英文系统是「The process cannot access the file because it is being used by another process」—— 搜报错原文时要用英文那一版

## 跑完之后

下一章讲**批处理脚本**：`.bat` 里变量为什么在 `for` 循环里读不到，以及那个流传很广的 `%%a` 双百分号规则到底为什么存在。

→ [批处理脚本：变量、条件与循环](/windows/guide/03-batch-script)

## 🎮 实战演练

<ArenaTasks module-id="02-file-ops" />

<ToyWinTerminal module-id="02-file-ops" />

## 📝 配套练习

<QuizBlock module-id="02-file-ops" />
