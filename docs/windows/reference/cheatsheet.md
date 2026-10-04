---
title: Windows 命令速查表
description: CMD 与 PowerShell 双轨对照，每条标明是否改动数据，末尾一条能直接复制的排查流水线。
---

# Windows 命令速查表

每条都给两种写法。**挑一条记住，两条都要会查** —— 别人的脚本和文档两种都有。

## 先记住这条对照

| 意图 | CMD | PowerShell |
| --- | --- | --- |
| 列出目录 | `dir` | `Get-ChildItem` / `gci` / `ls` |
| 读文件 | `type` | `Get-Content` / `gc` / `cat` |
| 新建目录 | `md` | `New-Item -ItemType Directory` / `ni` |
| 新建文件 | `echo. > 文件` | `New-Item -ItemType File` / `ni` |
| 复制 | `copy` | `Copy-Item` / `cp` |
| 移动改名 | `move` / `ren` | `Move-Item` / `mv` |
| 删除文件 | `del` / `erase` | `Remove-Item` / `rm` |
| 删除目录 | `rd` / `rmdir` | `Remove-Item -Recurse` |
| 找命令 | `where` | `Get-Command` |
| 环境变量 | `set` | `$env:VAR` |
| 清屏 | `cls` | `Clear-Host` |
| 压缩 | — | `Compress-Archive` |

## 只读查看

| 意图 | CMD | PowerShell | 改动数据 |
| --- | --- | --- | :-: |
| 当前目录 | `cd` | `Get-Location` / `pwd` | 否 |
| 列目录 | `dir` | `Get-ChildItem` | 否 |
| 读文件 | `type 文件` | `Get-Content 文件` | 否 |
| 跟随日志 | — | `Get-Content -Wait -Tail 20` | 否 |
| 进程列表 | `tasklist` | `Get-Process` | 否 |
| 服务列表 | `sc query` | `Get-Service` | 否 |
| 网络配置 | `ipconfig /all` | `Get-NetIPAddress` | 否 |
| 连接与端口 | `netstat -ano` | `Get-NetTCPConnection` | 否 |
| 系统信息 | `systeminfo` | `Get-ComputerInfo` | 否 |
| 谁占了端口 | `netstat -ano \| findstr :8080` | `Get-NetTCPConnection -LocalPort 8080` | 否 |
| 磁盘空间 | `wmic logicaldisk get size,freespace` | `Get-PSDrive` | 否 |
| PowerShell 版本 | — | `$PSVersionTable.PSVersion` | 否 |

## 创建与修改

| 意图 | CMD | PowerShell | 改动数据 |
| --- | --- | --- | :-: |
| 建目录 | `md 新目录` | `ni -ItemType Directory 新目录` | 是 |
| 建文件 | `echo. > 文件` | `ni -ItemType File 文件` | 是 |
| 写内容 | `echo 文本 > 文件` | `Set-Content 文件 文本` | ⚠️ 是（覆盖） |
| 追加内容 | `echo 文本 >> 文件` | `Add-Content 文件 文本` | 是 |
| 复制 | `copy 源 目标` | `Copy-Item 源 目标` | 是 |
| 移动 | `move 源 目标` | `Move-Item 源 目标` | 是 |
| 改名 | `ren 旧 新` | `Rename-Item 旧 新` | 是 |
| 查命令真实位置 | `where 命令` | `Get-Command 命令` | 否 |

::: warning 重定向的编码陷阱
`echo 文本 > 文件` 在不同 PowerShell 版本下写出的编码不一样。Windows PowerShell 5.1 默认写 UTF-16LE，PowerShell 7 默认 UTF-8 无 BOM。

**需要固定编码时显式指定**，不要依赖默认值：

```powershell
Set-Content -Path 文件 -Value 文本 -Encoding UTF8
```
:::

## 删除与清理

| 意图 | CMD | PowerShell | 改动数据 |
| --- | --- | --- | :-: |
| 删文件 | `del 文件` | `Remove-Item 文件` | ⚠️⚠️ 不进回收站 |
| 删目录 | `rd /s /q 目录` | `Remove-Item -Recurse 目录` | ⚠️⚠️⚠️ |
| 交互确认 | `del 文件`（默认提示） | `-Confirm` | ⚠️⚠️ |

::: danger 回收站默认是关的
CMD 的 `del` 和 PowerShell 的 `Remove-Item` **都直接删除，不进回收站**。删错了唯一的办法是从备份恢复。

两条保命习惯：
- 删之前先 `dir` 确认路径，`Remove-Item` 建议带 `-WhatIf` 先看会删什么
- 路径里有变量时**一定要加引号**：`Remove-Item -Recurse "$path"`
:::

## CMD 与 PowerShell 的三个真实差异

这三个差别不是风格问题，是行为不同，用错了会出事。

| 差异 | CMD | PowerShell |
| --- | --- | --- |
| 删目录 | `del 目录` 报**拒绝访问** | `rm 目录` 直接删 |
| `ls` 输出 | `ls` 是 `dir` 的别名，出详细表格 | `ls` 是 `Get-ChildItem` 的别名，只出名字 |
| 路径大小写 | 不敏感（`C:\USERS` 等于 `C:\Users`） | 同样不敏感，但 Linux 敏感，跨平台脚本要注意 |

第 1 条最容易误判：在 CMD 里 `del 目录` 失败，很多人会改用 `rmdir /s`；在 PowerShell 里 `rm 目录` 成功，容易让人以为两者等价。**它们确实不等价** —— 同一个人从 CMD 切到 PowerShell 会以为 `del` 也能删目录。

## 路径的三个坑

| 坑 | 现象 | 解法 |
| --- | --- | --- |
| 空格 | `cd C:\Program Files` 只切到 `C:\Program` | 加引号 `cd "C:\Program Files"` |
| 尾随反斜杠 | `C:\folder\` 后面跟引号会吞字符 | `"C:\folder"` 不带尾斜杠 |
| 变量为空 | `Remove-Item -Recurse $p` 在 `$p` 为空时删掉当前目录 | `"$p"` 加引号，空值会变成一个安全的空字符串 |

第三个坑值得单独记：

```powershell
$p = ""            # 变量没赋值
Remove-Item -Recurse $p     # ⚠️ 等价于删当前目录
Remove-Item -Recurse "$p"   # 安全，空值是一个空字符串路径
```

## 一条能直接复制的排查流水线

「连不上 / 打不开」，按顺序敲：

```powershell
# 1. 服务在跑吗
Get-Service 服务名
# 或 CMD： sc query 服务名

# 2. 端口在听吗
Get-NetTCPConnection -LocalPort 8080 -ErrorAction SilentlyContinue
# 或 CMD： netstat -ano | findstr :8080

# 3. 本机能通吗（绕过 DNS 和外部网络）
Test-NetConnection -ComputerName 127.0.0.1 -Port 8080
# 或 CMD： curl http://127.0.0.1:8080/

# 4. 防火墙挡了吗
Get-NetFirewallRule -Direction Inbound -Enabled True |
  Where-Object DisplayName -like "*服务名*"

# 5. 事件日志说了什么
Get-EventLog -LogName Application -Newest 50 |
  Select-Object TimeGenerated, EntryType, Message |
  Format-Table -AutoSize

# 6. 外部能通吗
Test-NetConnection -ComputerName 8.8.8.8 -Port 443
```

## 退出码

| 退出码 | 含义 |
| :-: | --- |
| `0` | 成功 |
| `1` | 一般错误 |
| `2` | 找不到命令（CMD） |
| `5` | 拒绝访问 |
| `9009` | **CMD 找不到命令或程序** |
| `$LASTEXITCODE` | PowerShell 读原生程序的退出码 |
| `$?` | PowerShell 读上一条命令是否成功 |

`9009` 是 Windows 特有的，做批处理时很有用：

```bat
where 不存在的命令
if errorlevel 9009 echo 这个命令没装
```
