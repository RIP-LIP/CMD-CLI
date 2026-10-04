---
title: 管道与对象：PowerShell 的真正优势
description: 九组管道命令的组合用法，以及为什么这里不能照搬 Unix 的写法。
---

# 管道与对象：PowerShell 的真正优势

> 读完你会用九组管道命令把「列出服务」这种需求拼出来，并且知道哪些命令能放在管道中间、哪些一放进去就断。这一章大约 35 分钟。

<ModuleMeta module-id="08-pipeline" />

## 前置条件

**先拿一个对象够多、字段够清楚的命令练手。服务列表是最合适的对象。**

```powershell
Get-Service
```

你应该看到 `Status`、`Name`、`DisplayName` 三列。

看它到底是什么对象，以及有哪些属性可读：

```powershell
Get-Service | Select-Object -First 1 | Get-Member
```

你应该看到 `Name: ServiceController` 和一列 `Property`。**这一步不能跳过 —— 不知道字段名就写不出管道。**

确认 PowerShell 版本，因为第 4 节的编码行为按版本分叉：

```powershell
$PSVersionTable.PSVersion.ToString()
```

## 1. 九组管道命令，先认全

**这九组覆盖了日常九成以上的需求。记不住参数没关系，知道有哪九组、分别归哪类就行。**

| 组 | 命令（别名） | 作用 | 是否改动数据 |
| --- | --- | --- | --- |
| 1 过滤 | `Where-Object`（`?`） | 按条件留下要的行 | 否 |
| 2 取列 | `Select-Object` | 选字段 / 取前 N 条 | 否 |
| 3 排序 | `Sort-Object` | 排序、去重 | 否 |
| 4 分组 | `Group-Object` | 按字段聚合 | 否 |
| 5 聚合 | `Measure-Object`（`measure`） | 计数、求和、求平均 | 否 |
| 6 展开 | `Select-Object -ExpandProperty` | 把属性值单独取出 | 否 |
| 7 查找 | `Select-String` | 内容匹配 | 否 |
| 8 加工 | `ForEach-Object`（`%`） | 逐个改写 | 否 |
| 9 落地 | `Out-File` / `Export-Csv` / `ConvertTo-Json` | 输出成文件或文本 | ⚠️ 新建/覆盖文件 |

下面逐个过。

## 2. 过滤和取列

### `Where-Object`：条件写在脚本块里

```powershell
Get-Service | Where-Object { $_.Status -eq 'Running' }
```

你应该只看到 `Running` 的服务。

两种写法等价，新手用第一种、老手用第二种：

```powershell
Get-Service | Where-Object { $_.Status -eq 'Running' }
Get-Service | Where-Object Status -eq 'Running'
```

第二种叫**属性语法简写**，只适用于「属性 值 运算符」这一种简单条件。`$_.` 前缀可以省掉，但一旦条件里要加函数调用、逻辑运算，就必须回到第一种。

常用比较运算符：

| 运算符 | 含义 | 例子 |
| --- | --- | --- |
| `-eq` `-ne` | 等于 / 不等于 | `-eq 'Running'` |
| `-gt` `-lt` | 大于 / 小于 | `-gt 100` |
| `-ge` `-le` | 大于等于 / 小于等于 | `-ge 50` |
| `-like` | 通配（支持 `*` `?`） | `-like '*sql*'` |
| `-notlike` | 反向通配 | `-notlike 'Rpc*'` |
| `-match` | **正则**匹配 | `-match 'S-1-5'` |
| `-contains` | 集合包含 | `'a','b' -contains 'a'` |
| `-in` | 在集合内 | `'Running' -in $states` |

::: warning 字符串用 `-eq`，不要用 `=`
PowerShell 里给变量赋值用 `=`，比较用 `-eq`。写 `Where-Object { $_.Status = 'Running' }` 报的是「无法将值转换为类型 bool」，因为它把右边当成了赋值。这个报错和真实原因（少写了一个短横）毫无关系。
:::

::: tip `-like` 的通配和 `-match` 的正则别混
`-like 'log*'` 是通配，只认 `*` 和 `?`。`-match 'log\d+'` 是正则。用错的表现很隐蔽：`-like 'a.b'` 里的 `.` 是**字面的点**，而 `-match 'a.b'` 里的 `.` 匹配任意字符 —— 结果 `-match` 会匹配到 `axb`。
:::

### `Select-Object`：取哪几列、取几条

```powershell
Get-Service | Select-Object Status, Name | Sort-Object Name
```

你应该看到只有两列、按名字排好序。

取前 N 条：

```powershell
Get-Service | Select-Object -First 5 Name
```

`Select-Object -First N` 是**流式**的 —— 拿到 5 个就停，上游不会继续跑。

::: danger `Select-Object -Last N` 不是流式的
`Select-Object -Last 5` 必须**先收到全部数据**才能知道最后 5 个是什么。所以：

- 管道很长时，`-Last 5` 会把上游全部跑完，内存和耗时都远超预期
- `Get-ChildItem -Recurse C:\ | Select-Object -Last 1` 扫的是整个盘，不是尾目录

**要尾部就反过来取**：先 `Sort-Object` 再 `-First`：

```powershell
Get-ChildItem -Recurse | Sort-Object LastWriteTime -Descending | Select-Object -First 5 Name, LastWriteTime
```

排序本身也是流式的？**不是。** `Sort-Object` 同样要收齐全部才能输出。所以上面这条虽然改对了写法，代价仍然是全量扫描 —— 只是内存占用小一些，因为它不再累积 `-Last` 需要的第二份副本。
:::

::: warning 重复的属性名，最后一个生效
```powershell
Get-Service | Select-Object Name, @{n='Name';e={$_.DisplayName}}
```

你会发现输出里只有一个 `Name` 列，内容是 `DisplayName`。**同名属性在管道里不会共存，后者覆盖前者。** 这是给计算属性起名时最容易犯的错 —— 起个跟原属性重名的名字，你会以为取错了。

想同时要两份，用不同的名字：

```powershell
Get-Service | Select-Object Name, @{n='显示名';e={$_.DisplayName}}
```
:::

### 展开：`-ExpandProperty` 和 `-Property` 不是一回事

```powershell
Get-Service | Select-Object -First 3 -ExpandProperty Name
```

你应该看到三行纯粹的服务名，没有表头、没有列。

`Select-Object -Property Name` 给的是一个**对象**（`PSCustomObject`），有表头；`-ExpandProperty Name` 给的是**原始值**。要拿纯值做后续处理（比如传给外部命令、拼字符串）用 `-ExpandProperty`。

## 3. 排序、分组、聚合

```powershell
Get-Service | Group-Object Status
```

你应该看到三组（Running / Stopped / 其他）以及每组的 `Count` 列。

```powershell
Get-Service | Group-Object Status | Sort-Object Count -Descending | Select-Object Name, Count
```

你应该看到按数量从多到少排好的两行。**这四行是「有多少服务、分别什么状态」这个问题的标准答案。**

分组结果本身是个对象，组内数据在 `Group` 属性里：

```powershell
Get-Service | Group-Object Status | Where-Object { $_.Name -eq 'Stopped' } |
  Select-Object -ExpandProperty Group | Select-Object -First 3 Name
```

你应该看到 3 个已停止服务的名字。**`-ExpandProperty Group` 是在把嵌套的集合摊平** —— 这是管道里非常常用的一步。

聚合：

```powershell
Get-Process | Measure-Object -Property WorkingSet -Sum -Average -Maximum
```

你应该看到 `Count`、`Average`、`Sum`、`Maximum`、`Property` 五个属性。

**只数个数**用最简形式：

```powershell
(Get-Service).Count
```

去重：

```powershell
Get-Service | Select-Object -ExpandProperty Status -Unique
```

你应该看到去重后的状态列表。`Sort-Object -Unique` 也能去重，但它**会把结果排好序** —— 需要保持原顺序时用 `Select-Object -Unique`。

::: warning `Sort-Object` 对相同值不稳定
排序键相同的元素，输出顺序**不保证**和输入一致。PowerShell 的默认排序算法不保证稳定性，跨版本可能不同。

后果是「同一天的文件按时间排序后取第一个」这种写法不可靠。要确定性结果，排序键加上一个能打破平局的次级键（通常是完整路径）：

```powershell
Get-ChildItem | Sort-Object LastWriteTime -Descending, FullName | Select-Object -First 10
```

**任何一个需要结果可复现的自动化脚本，排序键都应该能唯一区分每一行。**
:::

## 4. 落地：编码在版本 5 和 7 上不同

```powershell
Get-Service | Select-Object Status, Name | Export-Csv -Path C:\Temp\services.csv -NoTypeInformation
```

你应该得到一个 `services.csv`，第一行是表头。

::: danger `Export-Csv` 在 5.1 上写 UTF-16
Windows PowerShell 5.1 的 `Export-Csv` 和 `Out-File` 默认都写 **UTF-16 LE（带 BOM）**。后果有两个：

- 用 Excel 打开 5.1 导出的 CSV —— 双击能正常显示中文（Excel 认 BOM），但**指定「CSV UTF-8」导入就会乱码**
- 把 CSV 给一个只读 UTF-8 的 Linux 工具处理 —— 那边看到的是一堆 `�`

需要 UTF-8 时显式指定：

```powershell
Get-Service | Select-Object Status, Name | Export-Csv -Path C:\Temp\services.csv -NoTypeInformation -Encoding UTF8
```

`-NoTypeInformation` 去掉第一行 `#TYPE System...` 的类型声明。**这个头在 5.1 上默认带、在某些工具里是多余的**，读 CSV 的脚本要能容忍它。
:::

三种落地方式的区别：

| 目标 | 用什么 | 特点 |
| --- | --- | --- |
| 给人看的文本 | `Out-File -Width 200` | 表格转文本，换行可控 |
| 表格数据（Excel） | `Export-Csv -NoTypeInformation` | 转义引号和逗号 |
| **保留对象类型** | `Export-Clixml` | 下次能 `Import-Clixml` 拿回完整对象 |

`Export-Clixml` 是最被低估的一个。对象的完整结构（不是渲染出来的文本）落到磁盘：

```powershell
Get-Service | Export-Clixml -Path C:\Temp\services.xml
Import-Clixml C:\Temp\services.xml | Where-Object { $_.Status -eq 'Running' }
```

你应该能拿回带完整属性的服务对象。**处理服务、计划任务、事件日志这类结构化对象时，`Export-Clixml` / `Import-Clixml` 比 CSV 可靠得多** —— CSV 把所有东西都变成字符串，类型信息全丢。

JSON：

```powershell
Get-Service -Name Dhcp | ConvertTo-Json -Depth 3
```

::: warning `ConvertTo-Json` 的默认深度是 2
嵌套超过两层，输出里会出现这个：

```json
"PSPath": "Microsoft.PowerShell.Core\\FileSystem::C:\\...",
"Warning": "Result 已被截断..."
```

**不是数据有问题，是默认深度不够。** 嵌套对象（服务依赖、事件属性）必须显式加 `-Depth`，一般给 4 到 5。读回来用 `ConvertFrom-Json`，得到的就是可继续管道的对象。
:::

想在打印的同时存一份：

```powershell
Get-Service | Select-Object -First 3 Name | Tee-Object -FilePath C:\Temp\first3.txt
```

你应该同时看到屏幕输出和生成的文件。**`Tee-Object` 是 Unix `tee` 在这里的正确对应物。**

## 5. 逐个处理：`ForEach-Object` 和 `foreach` 不一样

**这两个看起来一样，一个流式一个全量。这是 PowerShell 里最容易误解的一对。**

```powershell
Get-Service | ForEach-Object { $_.Name }
```

**逐个处理，数据来一个处理一个，不全量缓存。**

```powershell
$services = Get-Service
foreach ($s in $services) { $s.Name }
```

**先把 `$services` 全部读进内存，再在内存上循环。**

| | `ForEach-Object` | `foreach` |
| --- | --- | --- |
| 来源 | 管道 | 变量、集合 |
| 执行时机 | 每来一个立即执行 | 全部读入后开始 |
| 大数据量 | 安全 | 内存会涨 |
| 位置 | 只能在管道后面 | 任何地方 |
| 报错影响 | 已处理的不回滚 | 整个语句块受影响 |

::: danger 改数据库/服务状态时这个区别是致命的
```powershell
# 危险：先把 200 个服务对象全读进内存
$s = Get-Service
foreach ($x in $s) { Stop-Service $x -WhatIf }
```

处理过程中如果 `Get-Service` 的快照过时了（服务状态已经变了），你可能在基于过期信息做决策。**流式管道每次拿到的都是当下那一刻的状态。**

反过来，`foreach` 在处理集合时性能更好，因为它省掉了每个元素启动一次脚本块的固定开销。**读静态的小集合用 `foreach`，处理活的系统状态用管道。**
:::

`ForEach-Object` 还能带位置变量，做「连带上下项」的比较：

```powershell
Get-Process | Sort-Object WorkingSet -Descending |
  ForEach-Object -Begin { $i = 0 } -Process { $i++; "$i. $($_.ProcessName) $([math]::Round($_.WS/1MB,1))MB" } -End { "共 $($i) 个进程" }
```

你应该看到带编号的列表和末尾的总数。

## 6. 为什么这里不能照搬 Unix 写法

**把 Linux 命令行直接粘进 PowerShell，失败原因基本是以下五类。**

| 你写的 | 结果 | 原因 | 改成 |
| --- | --- | --- | --- |
| `ls -lah` | 报参数错误 | `ls` 是 `Get-ChildItem` 的别名，没有 `-h` | `Get-ChildItem -Force` |
| `ps aux` | 报参数错误 | `ps` 是 `Get-Process` 的别名，不认 `aux` | `Get-Process` |
| `grep x file` | 命令不存在 | PowerShell 没有 `grep` 别名 | `Select-String -Pattern x -Path file` |
| `cat x \| head -5` | 报参数错误 | `cat` 是 `Get-Content`，没有 `head` | `Get-Content -TotalCount 5` |
| `wc -l file` | 命令不存在 | 没有 `wc` | `(Get-Content file).Count` |
| `rm -rf dir` | 报参数错误 | `rm` 是 `Remove-Item`，没有 `-rf` | `Remove-Item dir -Recurse -Force` |
| `kill -9 1234` | 报参数错误 | `kill` 是 `Stop-Process`，没有 `-9` | `Stop-Process -Id 1234 -Force` |
| `df -h` | 报参数错误 | 没有别名 | `Get-PSDrive` |
| `history \| grep ssh` | 没历史 | 历史在 `Get-History` 里，且默认会话级 | `(Get-History).CommandLine` |

::: tip 逐个验证的办法
`Get-Command <名字>` 一次就能确认某个词是别名、函数、还是根本不存在：

```powershell
Get-Command grep
Get-Command which
Get-Command wc
```

返回空就是**系统里没有这个东西**，不是参数写错了。这比对着报错猜快得多。
:::

**真的需要 Unix 工具链就别硬转。** 装 WSL，或者用 Git for Windows 附带的 GNU coreutils，是把「在 Windows 上跑 Linux 命令」这件事一次做对的办法。PowerShell 的定位是管理 Windows 本身（服务、注册表、计划任务、事件日志），不是重新实现 coreutils。

## 排障

**Q1：管道接不上了，后半段拿不到数据？**

按这个顺序查，不要跳步：

1. `... | Select-Object -First 1 | Get-Member` —— 确认中间步骤输出的还是对象
2. 检查中间有没有放 `Format-Table`、`Format-List`、`Out-String`、`Write-Host`
3. 检查中间有没有 `Select-Object -ExpandProperty` 之后再 `Where-Object`

::: warning 格式化命令放在管道中间会切断数据流
`Format-Table` / `Format-List` / `Out-String` / `Out-Host` 是**输出**命令，不是转换命令。它们把对象渲染成文本对象丢给下游，下游再 `Where-Object { $_.Status }` 就找不到属性了 —— 因为此时手上的是格式化对象，不是你的数据。

**格式化只能放在管道最后。** 需要在中间停下来看数据，用 `| Out-Host` 或者干脆把它拆成两条命令分别跑。
:::

**Q2：报错说找不到某个属性？**

1. `... | Select-Object -First 1 | Get-Member` —— 看真实属性名
2. `... | Select-Object -First 1 | Format-List *` —— 展开全部属性包括隐藏的
3. 检查管道里哪一步返回了空 —— 逐段跑，每段单独看输出

**Q3：处理很慢，或者内存涨得厉害？**

1. 看是不是用了 `-Last` —— 换成 `Sort-Object` + `-First`
2. 看是不是用了 `foreach` 而不是 `ForEach-Object` 处理大数据
3. 给 `Select-Object` 提前加 `-First N` 截断，别让上游跑完全部
4. 排序和分组天生是全量的，量大时只能用 `Select-Object -First` 提前截

**Q4：`Export-Csv` 出来的文件给别的工具读是乱码？**

1. 加 `-Encoding UTF8` 显式指定
2. 5.1 上还可以用 `[System.IO.File]::WriteAllText` 配合 `UTF8Encoding $false` 写无 BOM 版本
3. 确认下游工具期望的编码（有的工具只认无 BOM 的 UTF-8）

**Q5：`Sort-Object` 之后顺序每次都不一样？**

1. 排序键不唯一 —— 加一个能打破平局的次级键
2. `Sort-Object LastWriteTime -Descending, FullName` 这种写法
3. 需要绝对确定的顺序时，排序键里加上唯一标识

**Q6：脚本报「术语 X 未被识别为 cmdlet」？**

1. `Get-Command X` —— 确认它是什么，或确认根本不存在
2. 大小写不影响命令名，但**别名是大小写不敏感的**，`?` 和 `%` 后面不能有空格
3. 检查是不是在 CMD 里执行了 PowerShell 语法，或者反过来

## 什么时候别用

**管道不是所有问题的最优解，串得太长反而更难维护。**

| 场景 | 换成 | 原因 |
| --- | --- | --- |
| 超过 5 个环节的管道 | 拆成多步，赋值中间变量 | 太长无法调试 |
| 每个环节都要看 | 分成多条命令 | 管道只能看到最终结果 |
| 结果要反复用 | 先存变量或 `Export-Clixml` | 管道结果用完就没了 |
| 纯数字计算 | 一行 `ForEach-Object` 直接算 | 排序分组有全量开销 |
| 文本流处理（替换、拼接） | 专门的文本工具 | 对象管道在这类活上没有优势 |
| 高频大数据循环 | `.NET` 方法或编译代码 | 每个元素启动脚本块的开销是实打实的 |

::: warning 别把管道当成「Unix 管道换个写法」
Unix 的管道是文本流，每个程序只做一件事、进出都是文本，组合性很强。**PowerShell 的对象管道在「结构化数据的筛选聚合」上强得多，在「文本流处理」上反而更笨拙。** 拿它当 `sed`/`grep` 的替代品是逆着它的设计用。

**也别指望管道有事务性。** `Get-Service | ForEach-Object { Stop-Service $_ }` 处理到第 5 个时第 3 个出错了，前 4 个已经改了。**任何「改动系统状态」的管道，都要保证它只做一次，或者每一步都能独立重试。**
:::

## 哪些是通用的

**「用小命令组合出复杂查询」这个模型换平台一样成立。**

| 这里学的 | Unix 对应 |
| --- | --- |
| `Get-Service` | `systemctl list-units` |
| `Where-Object` | `grep` / `awk '$1==...'` |
| `Select-Object` | `cut` / `awk '{print $1}'` |
| `Sort-Object` | `sort` |
| `Group-Object` | `sort` + `uniq -c` |
| `Measure-Object` | `wc` / `awk '{s+=$1}'` |
| `Select-Object -Unique` | `uniq` |
| `ForEach-Object` | `awk` / `xargs` |
| `Tee-Object` | `tee` |
| `ConvertTo-Json` | `jq` |

**明确不通用的部分：**

- **管道载荷**。Unix 传字节，PowerShell 传对象。**这是所有差异的根源**：Unix 的 `awk` 拿到的是行，PowerShell 的 `ForEach-Object` 拿到的是带类型的对象
- **能力边界**。因为传对象，PowerShell 能做「按属性筛选后求和」这种一步到位的操作；Unix 里要 `awk` 或 `jq` 配合。**反过来**，PowerShell 没有真正的流式文本处理能力，`sed` 那种模式空间在 PowerShell 里没有对应物
- **中间格式命令**。Unix 的格式化（`column`、`jq`、`less`）和过滤是分离的，PowerShell 里 `Format-*` 一放就断流
- **结果稳定性**。`sort` 有明确的稳定性定义，PowerShell 的 `Sort-Object` 不保证

## 跑完之后

进入原理篇。第一章讲**注册表**：为什么改任何东西之前必须先 `reg export`，以及 `HKCR` 这个看起来像根键的缩写实际写到哪里去。

→ [注册表：改之前先导出](/windows/internals/09-registry)

## 📝 配套练习

<QuizBlock module-id="08-pipeline" />
