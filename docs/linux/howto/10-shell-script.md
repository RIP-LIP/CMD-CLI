---
title: Shell 脚本：把一串手动操作固化成可重跑的东西
description: 变量、条件、循环、函数四个必备结构，以及脚本里最容易出错的三处引号。
---

# Shell 脚本：把一串手动操作固化成可重跑的东西

> 读完你能写出一个幂等、带错误处理、能被别人改的脚本，并且知道为什么「加不加双引号」会让同一个脚本在一个目录下正常、另一个目录下崩掉。约 35 分钟。

<ModuleMeta module-id="10-shell-script" />

## 前置条件

```bash
bash --version
```

**你应该看到一行版本号，且第一行包含 GNU bash。** 如果只有 `dash` 或 `sh`，本章讲的数组、`[[ ]]`、进程替换都用不了 —— 确认 `bash` 在 `PATH` 里：

```bash
command -v bash
```

有条件的话装一个静态检查器，它是本章价值的最大来源：

```bash
command -v shellcheck || echo "未安装（Debian/Ubuntu: apt install shellcheck）"
```

**判断句：装不上 shellcheck 也能写脚本，但至少要开 `bash -n` 做语法检查。** 下面每一条规则你都可以用 `bash -n` 验证它是否语法正确。

## 1. 骨架：三行头部决定了一半的行为

```bash
#!/usr/bin/env bash
set -euo pipefail
```

| 这一行 | 作用 | 关掉它会怎样 |
| --- | --- | --- |
| `#!/usr/bin/env bash` | 用 `PATH` 里的 bash 启动 | 硬编码 `/bin/bash` 在有些发行版上不存在（那是 `/usr/bin/bash`） |
| `set -e` | 任一命令失败就退出 | 脚本带着错误继续往下跑，破坏后面的状态 |
| `set -u` | 引用未定义变量就报错 | 变量名打错时静默当成空字符串，错误推迟到很后面才暴露 |
| `set -o pipefail` | 管道的退出码取**任一环**的失败 | `find ... \| xargs rm` 里 find 挂了，管道仍返回 xargs 的 0 |
| `IFS=$'\n\t'` | 字段分隔去掉空格 | 少一个常见的「文件名带空格」故障源 |

**判断句：`set -euo pipefail` 是「让脚本在出错时停下来喊你」，而不是「让脚本更聪明」。** 代价是它会暴露你没写错误处理的分支。

::: warning

`/usr/bin/env bash` 在计划任务里可能直接失败
`env` 靠 `PATH` 找 bash。**cron、systemd、或者被精简过的容器里 `PATH` 往往不含 `/usr/bin`**，于是脚本报 `bad interpreter: No such file or directory` —— 而文件明明存在。

对策二选一：shebang 写绝对路径 `#!/bin/bash`，或者在 crontab 里显式设 `PATH`。详见 [计划任务的环境变量陷阱](/linux/internals/14-cron)。
:::

::: warning

`set -e` 有三个不生效的场合，不是万能的
- 命令出现在 `if` / `while` 的条件部分
- 命令是 `&&` 或 `||` 的左侧
- 命令前面加了 `!`

所以**`set -e` 不会替你检查每一步**，需要显式处理的地方仍然要写。**判断句：写完脚本后专门在几个关键步骤后加一次显式检查，比依赖 `set -e` 可靠。**
:::

### 变量和位置

| 写法 | 含义 | 是否改动数据 |
| --- | --- | --- |
| `name=value`（**等号两侧不能有空格**） | 赋值 | 只改当前 shell |
| `export NAME=value` | 赋值并导出给子进程 | 同上 |
| `readonly NAME=value` | 之后不能改 | — |
| `SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)` | 脚本自己所在目录 | 只读 |
| `mktemp -d` | 建一个随机名的临时目录 | ✅ 建目录 |

`SCRIPT_DIR` 那一行是脚本里最该抄的一段。**判断句：脚本里不要写死相对路径，因为它可能从任何目录被调用。**

## 2. 三处引号，这是最容易错的地方

**判断句：bash 的变量展开默认会分词和通配，这两件事没关掉之前，脚本在「文件名规整」的目录下永远是对的。**

| 写法 | 展开后会发生什么 | 什么时候用 |
| --- | --- | --- |
| `"$var"` | 不分词、不通配，作为**一个**参数 | **默认选它** |
| `$var` | 按空格拆成多个参数，并可能变成 glob | 基本不要用 |
| `'...'` | 完全字面，`$` 和 `\` 都不解释 | 写正则、写 `$` 字符 |
| `"..."` | 里面可以嵌变量 | 需要拼字符串时 |

现场复现：

```bash
cd /tmp && mkdir -p 'q' && touch 'q/a b.txt'
for f in q/*.txt; do echo "[$f]"; done
for f in "$(ls q/)"; do echo "[$f]"; done
```

**第一个循环你会看到 `q/a` 和 `b.txt` 两行（被空格拆开了），第二个你会看到 `q/a b.txt` 一行。** 文件名里有空格时，前者的 `rm $f` 会去删两个不存在的文件。

数组和位置参数同理：

| 写法 | 正确场景 |
| --- | --- |
| `"$@"` | 所有位置参数，**各自保持为一个参数**（脚本里表示参数的默认写法） |
| `$@` | 不加引号等于拆散，没有意义 |
| `"$*"` | 拼成一个字符串再传，功能不同 |
| `"${array[@]}"` | 展开数组全部元素，保持边界 |

**判断句：脚本里出现未加双引号的变量展开，一律当成 bug 处理。** shellcheck 报的就是这一类。

## 3. 条件：先比较，再判断

```bash
if [[ -f "$path" ]]; then
  echo "是普通文件"
elif [[ -d "$path" ]]; then
  echo "是目录"
else
  echo "不存在"
fi
```

`[[ ]]` 和 `[ ]` 不是同义词：

| | `[[ ]]` | `[ ]` |
| --- | --- | --- |
| 是 | bash 内建关键字 | 外部命令的调用形式 |
| 内部的分词/通配 | **不发生** | 会发生 |
| 逻辑运算符 | `&&` `\|\|` `!` | `-a` `-o` `!` |
| 正则匹配 | 支持 `=~` | 不支持 |
| 字符串比较 | `>` `<` 直接用 | 需转义 `gt` `lt` |

**判断句：脚本里一律用 `[[ ]]`。** 它不涉及分词，少一整类「加了引号才好使」的问题。

常用测试项：

| 写法 | 判断什么 | 陷阱 |
| --- | --- | --- |
| `-f` / `-d` / `-e` | 是文件 / 是目录 / 存在 | 符号链接要用 `-L` 或 `-h` |
| `-z "$s"` / `-n "$s"` | 空串 / 非空 | **`-z` 后面变量必须有引号** |
| `"$a" = "$b"` | 字符串相等 | 不要用 `==`（bash 里能过，POSIX sh 里是语法错误） |
| `-eq` `-ne` `-lt` `-gt` | 数值比较 | 字符串用 `-eq` 不会报错但结果可能反直觉 |
| `=~ ^regex$` | 正则匹配 | **右侧不加引号**，加了就是字面字符串 |

## 4. 循环：最容易漏掉的是管道里的子 shell

```bash
while read -r line; do
  total=$((total + 1))
done < "$file"
echo "共 $total 行"
```

**你应该看到正确的行数。** 下面这种写法会输出 `共 0 行`：

```bash
cat "$file" | while read -r line; do
  total=$((total + 1))
done
echo "共 $total 行"
```

| 写法 | 结果 |
| --- | --- |
| `while ...; done < "$file"` | 循环在当前 shell 里，变量保留 ✅ |
| `cat "$file" \| while ...; done` | 循环在**子 shell** 里，循环内的赋值全部丢失 ❌ |

**判断句：只要循环体里要改外部变量，就把重定向放在 `while` 后面，不要用管道。**

另外两个必须知道的细节：

- **`read -r` 的 `-r` 不能省。** 少了它，反斜杠被当转义符吃掉，`C:\path\new` 这种内容读进来就变了。
- **文件最后一行没有换行符时，`while read` 会跳过它。** 需要兼容不规整文件时用：

```bash
while read -r line || [[ -n "$line" ]]; do
  echo "$line"
done < "$file"
```

## 5. 函数与错误处理

```bash
backup() {
  local src="$1"
  local dest="$2"

  if [[ ! -f "$src" ]]; then
    echo "源文件不存在: $src" >&2
    return 1
  fi

  cp -p -- "$src" "$dest"
  echo "已备份到 $dest"
}

backup "/etc/hosts" "/tmp/hosts.bak"
```

| 要点 | 写法 | 原因 |
| --- | --- | --- |
| 错误信息走 stderr | `>&2` | stdout 是给下一个管道用的，混进错误信息会污染数据 |
| 参数加引号 | `"$1"` | 见第 2 节 |
| 显式返回状态 | `return 1` | 让调用方能判断 |
| 清理动作 | `trap 'rm -rf "$tmpdir"' EXIT` | 无论成功失败都执行 |

::: warning

`local x=$(命令)` 会吞掉退出码
这是 shellcheck 明确警告的一类，因为 `local` 是内建命令，它的**自己的退出码（0）覆盖了右边命令的退出码**：

```bash
local out=$(flaky-command)     # flaky-command 失败了也看不出来
local out
out=$(flaky-command)           # 这样才能拿到真实退出码
```

**判断句：赋值给 `local` 时把声明和赋值拆成两行。** 这一条在排查「脚本明明失败了却继续跑」时很关键。
:::

::: warning

用 `mktemp` 而不是 `/tmp/myapp.tmp`
固定名字的临时文件在并发执行时会互相覆盖，而且路径可预测。`mktemp -d` 给的是随机名，创建时权限是 `700`。配合 `trap` 清理：

```bash
tmpdir=$(mktemp -d) || { echo "无法创建临时目录" >&2; exit 1; }
trap 'rm -rf "$tmpdir"' EXIT
```

**判断句：脚本里的临时路径必须来自 `mktemp`，且退出时必须清理。**
:::

### 参数解析

```bash
verbose=0
while getopts "vhn" opt; do
  case "$opt" in
    v) verbose=1 ;;
    h) echo "用法: $0 [-v] [-n] 文件"; exit 0 ;;
    n) dry_run=1 ;;
    *) echo "未知参数" >&2; exit 1 ;;
  esac
done
shift $((OPTIND - 1))
target="${1:-}"
```

**判断句：`getopts` 的循环结束后一定要 `shift $((OPTIND - 1))`，否则 `getopts` 循环之后的第一个参数会被当成选项。** 这是 `getopts` 脚本的固定收尾动作。

## 6. 完整骨架

把上面的结构合起来，是一个可以直接改的模板：

```bash
#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly LOG="$SCRIPT_DIR/run.log"

log() { printf '%s %s\n' "$(date '+%F %T')" "$*" | tee -a "$LOG"; }
die() { log "错误: $*"; exit 1; }

main() {
  local target="${1:-}"
  [[ -n "$target" ]] || die "缺少参数"

  for f in "$target"/*.txt; do
    [[ -e "$f" ]] || continue
    log "处理: $f"
  done
}

main "$@"
```

**判断句：写完后先跑 `bash -n 脚本.sh`（只查语法）再跑 `bash -x 脚本.sh`（打印每条实际执行的命令），第二步能在出错时直接指出是哪一行。**

## 排障

**Q1：脚本手动跑好好的，cron / systemd 里跑就失败？**

按这个顺序查，不要跳步：

1. `echo $?` 或在脚本里加 `set -x` —— 失败在哪一行
2. `env -i /bin/bash -x 脚本.sh` —— **用空环境复现**，这最接近计划任务的真实环境
3. `head -1 脚本.sh` —— shebang 里的解释器路径存在吗
4. 检查文件是不是 CRLF：`file 脚本.sh`，出现 `CRLF` 就是从 Windows 传过来的
5. 相对路径在别的目录下找不到 —— 用第 1 节的 `SCRIPT_DIR` 改成绝对路径

**Q2：`command not found`，但那条命令我手动能跑？**

1. 手动跑的是不是你**当前的** `$PATH`，脚本跑的是**计划任务给的** `$PATH`
2. `echo $PATH` 记下你的路径，在脚本开头显式补上
3. 有些命令需要绝对路径（尤其脚本里调 `sudo` 时，`sudo` 默认重置 `PATH`）

**Q3：循环里的计数一直是 0 / 变量莫名其妙没变？**

1. `while ... done < file` 写成了 `cat file | while ...` —— **子 shell，赋值不外传**
2. 命令替换 `$(...)` 本身就在子 shell 里
3. 变量在函数里声明成了 `local`，函数外当然看不到

**Q4：`for f in *.txt` 漏掉了带空格的文件？**

1. `for f in *.txt` 的 glob 本身是安全的，**问题在 `rm $f` 这种不加引号的用法**
2. 改成 `rm -- "$f"`
3. 更稳的写法是 `for f in ./*.txt; do [[ -e "$f" ]] || continue; ...` —— 空 glob 展开成字面字符串时的保护

**Q5：脚本在中文环境下输出乱码，或者匹配不上？**

1. `locale` 看当前 locale
2. 脚本头部加 `export LANG=C.UTF-8`（系统里装了这个 locale 的话）
3. 处理 UTF-8 数据时注意 `awk` 的 `length` 和 `substr` 按**字符**工作，但 `cut -b` 按**字节**工作，需要按字节切就要用 `cut -b`

**Q6：怎么知道这个脚本有没有 shellcheck 能查出来的问题？**

```bash
bash -n 脚本.sh     # 只查语法
shellcheck 脚本.sh  # 查逻辑陷阱：未加引号的变量、set -e 的坑、误用 local
```

**你应该看到 shellcheck 报的是「SC2086: Double quote to prevent globbing」这类具体行号**，而不是笼统的警告。`SC2086`（该加引号没加）出现的频率最高。

## 什么时候别用

- **超过大约 150 行的东西不要写成 shell 脚本。** 数组处理、JSON、错误处理、可测试性都会迅速失控。**改用 Python 或其他真正的编程语言。** shell 脚本适合「十行以内的固定动作」和「把命令串起来」，不适合业务逻辑。
- **需要复杂数据结构时不要硬凑。** bash 4.0 才有普通数组，关联数组、哈希都不如 Python 一行清楚。**shell 里唯一值得手写的复杂结构是「循环里调用外部命令」。**
- **不要用 shell 脚本处理密码。** 密码会出现在 `ps` 的命令行里，也会留在 shell 历史里。**用专门的凭据工具。**
- **不要写「看起来能跑」的脚本。** `set -e` 挡不住所有错误。**关键步骤后加显式检查**（`|| die "..."`），这比堆安全选项可靠。
- **不要依赖交互式命令的行为。** 很多命令发现输出不是终端就换了行为（分页、颜色、进度条）。**在脚本里显式关掉**：`export PAGER=cat`、`git --no-pager`，或者用管道接 `cat`。
- **不要把 shell 脚本当成写代码的起点。** 先用手动命令跑通，确认每一步的输出，再照抄进脚本。**反过来做，你会把一个还没理解的命令固化下来。**
- **不要求可移植就别写 `#!/bin/sh`。** `sh` 在不同系统上可能是 dash 也可能是 bash，行为不同。**要么明确要 POSIX 兼容并只用 POSIX 语法，要么明确写 `#!/usr/bin/env bash`。**

## 哪些是通用的

| 这一章的判断 | Windows 上对应什么 |
| --- | --- |
| 「先跑通手动命令，再固化成脚本」 | 完全成立，PowerShell / 批处理同理 |
| 「一条命令失败就停下来喊你」 | `$ErrorActionPreference = 'Stop'`、`$LASTEXITCODE` |
| 「变量必须加引号」 | 概念一致，写法不同 |
| 「临时文件用随机名 + 退出时清理」 | 完全成立 |
| 「复杂逻辑别用脚本语言硬写」 | 完全成立 |

**不通用的是语言本身。** bash 的一切都是字符串，`$` 既是变量前缀也是普通字符，`[[ ]]` 和 `(` 都能当语法用 —— 这些是 shell 几十年的历史包袱，PowerShell 没有对应物，也不需要。**跨平台脚本的可行做法是：用 Python 或 Go 写一个可执行文件，两边都能跑；或者干脆让 Windows 侧也装 bash（WSL / Git Bash），把脚本收成一份。**

**真正通用的是那套判断习惯：先验证手动步骤、显式处理错误、临时文件用随机名、危险操作前先 dry-run。** 这几条在任何脚本语言里都成立。

## 跑完之后

你能写出一个幂等、可诊断、能被别人改的脚本。下一章进入原理篇：当你说「让这个服务跑起来」而它起不来时，按什么顺序查。

→ [systemd：服务起不来时按什么顺序查](/linux/internals/11-systemd)

## 📝 配套练习

<QuizBlock module-id="10-shell-script" />
