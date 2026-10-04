---
title: 找文件和找内容：find 与 grep 各自的边界
description: 按名字找和按内容找是两件事，find 与 grep 组合起来才是完整的定位动作。
---

# 找文件和找内容：find 与 grep 各自的边界

> 读完你能分清「文件叫什么」和「文件里有什么」这两类问题，并知道 `find` 输出的路径能直接喂给别的命令。这一章大约 20 分钟。

<ModuleMeta module-id="03-search" />

## 前置条件

```bash
ls /etc | head -5
```

能看到 `/etc` 下有文件，接下来才有东西可搜。

## 1. 两类问题

| 你想知道 | 用什么 | 例子 |
| --- | --- | --- |
| 文件**叫什么**，在哪 | `find` | 找出所有叫 `nginx.conf` 的 |
| 文件**里有什么** | `grep` | 找出哪个文件里有 `root:x:0:0` |

混用是最常见的错误用法：`grep nginx.conf /etc` 是在**文件内容**里搜字符串 `nginx.conf`，不是在找文件名。

## 2. find：按名字找

```bash
find /etc -name hostname
```

你应该看到：

```bash
/etc/hostname
```

`-name` 是**大小写敏感**的精确匹配。想不区分大小写用 `-iname`。

按模式匹配：

```bash
find /etc -name "*.conf"
```

`*.conf` 里的 `*` 由 find 自己处理，**记得加引号**，否则 shell 会先把它展开成当前目录的文件名。

### 限定类型

```bash
find /etc -type f -name "*.conf"
find /etc -type d -name "nginx"
```

| 选项 | 含义 |
| --- | --- |
| `-type f` | 普通文件 |
| `-type d` | 目录 |
| `-type l` | 符号链接 |

不写 `-type` 时，文件和目录都会被匹配到。搜「文件」时忘了加 `-type f`，会得到一堆目录名。

### 限定深度

```bash
find / -maxdepth 3 -name "*.log"
```

`-maxdepth 3` 限制最多往下三层。不加它搜 `/` 会把整块磁盘走一遍，几十万次 `stat`，慢到像是卡死。

::: warning 搜根目录一定要限深
```bash
find / -name "*.log"           # 慢，且会撞进 /proc 和 /sys
find / -maxdepth 4 -name "*.log"  # 绝大多数情况够用
```
`/proc` 下的文件读一次就变，`/sys` 有海量伪文件，都不适合遍历。养成加 `-maxdepth` 的习惯。
:::

## 3. grep：按内容找

```bash
grep root /etc/passwd
```

你应该看到：

```bash
root:x:0:0:root:/root:/bin/bash
```

grep 默认输出**包含匹配行的整行**。

常用选项：

| 选项 | 作用 |
| --- | --- |
| `-i` | 忽略大小写 |
| `-v` | 反向：输出**不**包含的行 |
| `-n` | 显示行号 |
| `-r` | 递归进子目录 |
| `-c` | 只输出匹配行数 |

### 显示行号很重要

```bash
grep -n root /etc/passwd
```

排查时你需要知道行号才能去看上下文。没有 `-n`，你只能自己数。

### 搜目录用 -r

```bash
grep -rn "root" /etc
```

`-r` 递归。**不加 `-r` 搜目录会直接报错**，而不是「什么也没找到」—— 这个区别很重要，因为它不会让你误以为文件里没有那行。

## 4. 两者的组合

这是本章最有用的部分：**`find` 输出的路径可以直接喂给 `grep`**。

```bash
grep -l "root" $(find /etc -type f)
```

这行的意思是：用 `find` 列出所有文件，把结果作为参数传给 `grep -l`，输出**哪些文件包含** `root`。

::: warning 参数过多会报错
文件超过几千个时，命令行长度会超限，你会看到 `Argument list too long`。

绕过办法用 `xargs`：

```bash
find /etc -type f -name "*.conf" | xargs grep -l "root"
```

`xargs` 把输入**分批**传给命令，自动控制每批的数量。这是排查大目录时的必备写法。
:::

更稳的组合：

```bash
find /etc -type f -name "*.conf" -exec grep -l "root" {} \;
```

`-exec` 让 find 每找到一个文件就执行一次后面的命令。`{}` 是占位符，`\;` 是命令结束符。

::: tip `-exec` 和 `xargs` 怎么选
- `-exec` 每找到文件就启动一次进程 —— 文件少时更直观，可以中途 `Ctrl+C`
- `xargs` 攒一批一起传 —— 文件多时快得多

记得给 `-exec` 的命令加 `-print` 或 `+` 收尾，漏了反斜杠是最常见的写法错误。
:::

## 排障

**Q1：find 搜不到明明存在的文件？**

1. `find 起点 -name 文件名` —— 确认起点路径对，`find` 不会向上走
2. `find 起点 -iname 文件名` —— 可能是大小写差异，`-name` 区分大小写
3. `find 起点 -name "文件名*"` —— 可能是部分匹配，加通配符试试

**Q2：grep 报「Is a directory」？**

1. 你没加 `-r`，却直接给了它一个目录
2. `grep -rn "关键词" 目录` 加上递归
3. 只搜文件就先用 `find` 过滤出文件列表再喂给它

**Q3：find 跑很久像是卡住了？**

1. `find / -maxdepth 3 ...` —— 加上深度限制
2. `-path /proc -prune -o ...` —— 跳过 `/proc`
3. 缩小起点目录，别从 `/` 开始

## 什么时候别用

| 场景 | 别用 | 用什么 |
| --- | --- | --- |
| 按文件名找 | `grep` 拼路径 | `find -name` |
| 按内容找且文件已知 | `find` 遍历整个盘 | `grep` 直接给文件 |
| 搜「最近改过的文件」 | `find` 遍历 | `ls -lt` 或 `find -newer` |
| 在代码里找符号定义 | 文本 `grep` | 真的代码搜索工具（依赖 `ctags` / LSP 之类） |

**文本 `grep` 找不到「函数定义在哪」这类语义问题** —— 它只认字符。比如查 `UserService` 类的声明，`grep UserService` 会把文档、注释、调用处全捞出来，混在一起。

## 哪些是通用的

| 这里学的 | 别处对应 |
| --- | --- |
| 按名找 vs 按内容找的区分 | 所有系统都有这个区分 |
| 搜索结果喂给下一个命令 | Unix 管道，Windows 是 `ForEach-Object` |
| 限制搜索范围 | `rg`（ripgrep）自带并行与忽略规则，更快 |

**不通用的是命令行写法**。真要在几万文件里搜，`ripgrep`（`rg`）比 `grep -rn` 快一个数量级，因为它默认遵守 `.gitignore` 且自动跳过二进制文件 —— 这一点值得知道，但不改变「先想清楚搜什么」的思路。

## 跑完之后

下一章讲**压缩归档与装软件**：`tar` 的三个必记选项，以及装包之前该先确认什么。

→ [压缩归档与装软件：tar 与包管理器](/linux/guide/08-archive)

## 🎮 实战演练

<ArenaTasks module-id="03-search" />

<ToyShellTerminal module-id="03-search" />

## 📝 配套练习

<QuizBlock module-id="03-search" />
