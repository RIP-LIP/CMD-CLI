---
title: 计划任务：crontab 的五个字段与环境变量陷阱
description: 为什么 cron 里的脚本找不到命令，以及排查任务没执行的固定顺序。
---

# 计划任务：crontab 的五个字段与环境变量陷阱

> 读完你能写出一条能跑起来的 crontab，并能解释「手动跑好好的、放到 cron 里就找不到命令」这件事 —— 它的原因不是命令写错了。约 25 分钟。

<ModuleMeta module-id="14-cron" />

## 前置条件

```bash
command -v crontab
```

**你应该看到 `crontab` 的路径。** 没有它说明 cron 没装（Debian/Ubuntu 是 `cron` 包，RHEL 系是 `cronie`）。

确认调度器在跑，并且搞清楚它叫什么 —— **这一步的名字在两个发行版家族里不同**：

```bash
systemctl is-active cron 2>/dev/null || systemctl is-active crond
```

| 输出 | 含义 |
| --- | --- |
| `active` | 调度器在跑，继续 |
| `inactive` / `failed` | 没装或没启用，先 `apt install cron` 或 `dnf install cronie` 再 `systemctl enable --now` |
| `Unknown unit` | 系统里没有 cron，改用第 5 节的 systemd timer |

看已有的系统级任务布局：

```bash
ls -d /etc/cron.* 2>/dev/null
```

**你应该看到 `cron.d`、`cron.daily`、`cron.hourly` 之类的目录（Debian 系）或 `cron.d`（RHEL 系）。**

## 1. 五个字段，从左到右

```cron
30  4  *  *  *  /usr/local/bin/backup.sh >> /var/log/backup.log 2>&1
│   │  │  │  │  └─ 要执行的命令
│   │  │  │  └──── 星期（0-6，0 和 7 都是周日）
│   │  │  └─────── 月（1-12）
│   │  └────────── 日（1-31）
│   └───────────── 时（0-23）
└───────────────── 分（0-59）
```

| 字段 | 取值 | 常用写法 |
| --- | --- | --- |
| 分 | 0-59 | `*/15` 每 15 分钟 |
| 时 | 0-23 | `4` 凌晨 4 点 |
| 日 | 1-31 | `*` 每天 |
| 月 | 1-12 | `1,6,12` 或 `* * *` |
| 周 | 0-7 | `1-5` 周一到周五；**0 和 7 都是周日** |

四种修饰符：

| 写法 | 含义 |
| --- | --- |
| `*` | 每一个 |
| `a-b` | 范围，`1-5` |
| `*/n` | 步进，`*/15` |
| `a,b,c` | 列表 |

也支持简写形式：

| 简写 | 等价于 |
| --- | --- |
| `@reboot` | 每次开机后执行一次 |
| `@hourly` | 每小时整点 |
| `@daily` / `@midnight` | 每天 00:00 |
| `@weekly` | 每周日 00:00 |
| `@monthly` | 每月 1 号 00:00 |
| `@yearly` / `@annually` | 每年 1 月 1 日 00:00 |

**判断句：时间一律用本机本地时区，夏令时切换那天凌晨的那一小时任务会被跳过或者跑两次。** 把重要任务放在凌晨 1 点到 4 点之外，或者干脆在任务里自己判断。

::: warning

日和周同时被限定时，cron 按「或」算
这一条几乎每个教程都写错。规则是：**只有当「日」和「周」两个字段都不是 `*` 时，cron 才把它们当「或」关系。**

| 写法 | 实际触发 |
| --- | --- |
| `0 0 1 * 1` | **每个周一，以及每月 1 号**（或） |
| `0 0 * * 1` | 每周一（因为日是 `*`） |
| `0 0 1 * *` | 每月 1 号 |

**判断句：想让任务在「每月第一个周一」执行，cron 写不出来。** 用 `0 0 * * 1` 加上脚本里的日期判断，或者改用 systemd timer。
:::

::: warning

命令里的 `%` 会被换成换行符
cron 把 `%` 当成「换行」的分隔符。所以：

```cron
0 3 * * * /usr/bin/backup --since=$(date -d yesterday +%F)
```

会被截断。**必须写成 `%\%`。** 备份命令里带日期格式是最容易撞上这个坑的地方。

**判断句：任务日志里只看到命令的前半截，后半截没了 —— 就是这个。**
:::

## 2. 环境变量陷阱：cron 里和你的 shell 不是同一个环境

**这是本章的核心。判断句：cron 不是「你的终端」，它是一个几乎空的环境，PATH、SHELL、HOME 都和你手动敲命令时不一样。**

| 变量 | cron 里的值 | 后果 |
| --- | --- | --- |
| `PATH` | 极简，通常只有 `/usr/bin:/bin` | **你装在 `~/.local/bin`、`/usr/local/bin`、nvm/pyenv 里的命令找不到** |
| `SHELL` | `/bin/sh`（**不是你的 bash**） | `source`、`[[ ]]`、数组这些 bash 语法直接语法错误 |
| `HOME` | 通常是对的，但 `sudo` / `su -l` 场景下可能不是 | 配置文件读不到 |
| 无 TTY | 没有任何终端 | 要读输入的程序会**永久挂起**，把整条 crontab 堵死 |
| `umask` | 022 | 生成的文件是别人可读的 |

补救办法是把环境写进 crontab，**写在所有任务行的最上面**：

```cron
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/home/max/.local/bin
MAILTO=""

30 4 * * * /usr/local/bin/backup.sh </dev/null >> /var/log/backup.log 2>&1
```

| 写法 | 作用 |
| --- | --- |
| `SHELL=/bin/bash` | 让任务用 bash 解释 |
| `PATH=...` | 把命令路径补齐，**用 `command -v xxx` 确认后再写** |
| `MAILTO=""` | 关掉邮件通知，**强烈建议**，理由见下 |
| `</dev/null` | 给命令一个「输入已结束」的 stdin，防止挂起 |
| `>> 文件 2>&1` | 输出进日志，否则见下条 |

::: warning

输出必须重定向，否则可能整个 cron 静默失效
cron 会把任务的 stdout 和 stderr **用本地邮件发出去**。而最小化安装的机器上通常没有 MTA（邮件转发程序），于是 cron 会尝试调用一个不存在的命令，**这个调用会失败并把这次任务判为失败** —— 表现就是你配了任务却什么都没发生。

判断句：**每条 crontab 任务都该有 `>> /some/log 2>&1`，并且顶部写 `MAILTO=""`。** 想收到失败通知，正确的做法是自己往日志里写，或者用 `mailx` 配一个真实的 MTA。
:::

## 3. 三种存放位置，别放错

| 位置 | 是否带用户名列 | 谁能改 | 适用 |
| --- | --- | --- | --- |
| `crontab -e`（用户自己的） | ❌ 不带 | 登录用户 | **99% 的情况用这个** |
| `/etc/crontab` | ✅ 带 | root | 全局任务 |
| `/etc/cron.d/*` | ✅ 带 | root | 多个系统组件共享的目录 |

`crontab -e` 打开的编辑器由 `EDITOR` 变量决定，没配就依次试 `vi`/`nano`。**在脚本里改 crontab 不要用 `-e`**，用管道：

```bash
printf '0 4 * * * /usr/local/bin/backup.sh\n' | crontab -
crontab -l
```

**你应该看到刚写进去的那一行。** ⚠️ `crontab -r` 会**删掉你当前用户的全部任务且没有确认、没有回收站**。

::: warning

`/etc/cron.d/` 有三条额外约束
放进去的文件比用户 crontab 更严格，写错了会被**静默忽略**：

1. **必须包含用户名列**（`0 4 * * * root /usr/bin/foo.sh`），少了这一列整个文件失效
2. **文件名不能带点**（`backup.sh` 可以，`my.backup` 不行）
3. **文件权限不能有 group/other 写**（`644` 可以，`664` 会被忽略）

**判断句：文件明明在那儿就是不执行 → 先查这三条，其中「少了用户名列」最常见。**
:::

## 4. 避免任务重叠执行

::: warning

前一轮没跑完，下一轮又开始了
cron 不知道你的任务要跑多久。**一个跑 10 分钟的备份配上 `*/5 * * * *`，最多会同时跑 12 份**，日志互相覆盖、数据库连接被打满。

用 `flock` 加锁，这是最省事的一条：

```cron
*/5 * * * * /usr/bin/flock -n /tmp/backup.lock -c '/usr/local/bin/backup.sh >> /var/log/backup.log 2>&1'
```

**`-n` 的含义是「拿不到锁就立刻退出」，不会排队堆积。** 上一轮还在跑时，这一轮直接跳过。

**判断句：日志里同一个时间点出现多条记录、任务之间互相干扰，第一件事就是加 `flock`。**
:::

## 5. systemd timer：多数情况下更该用它

现代机器上 systemd timer 已经全面优于 cron，三个理由：**有 journal 日志、能用 `OnCalendar` 的自然语言表达、有持久化补跑**。

| | crontab | systemd timer |
| --- | --- | --- |
| 日志 | 要自己重定向到文件 | `journalctl -u <单元>` |
| 依赖顺序 | 要自己判断 | `After=` / `Requires=` |
| 机器当时关机了 | 那一次就丢了 | `Persistent=true` 会在开机后补跑 |
| 时间表达式 | 五个数字字段 | `OnCalendar=daily`、`Mon *-*-* 04:30:00` |
| 抖动 | 无 | `RandomizedDelaySec=` 避免整点齐发 |

| 命令 | 是否改动状态 | 说明 |
| --- | --- | --- |
| `systemctl list-timers` | 只读 | **看哪些定时器什么时候触发，第一条命令** |
| `systemd-analyze calendar 'Mon *-*-* 04:30'` | 只读 | 校验时间表达式，**写完先跑它** |
| `systemctl cat myjob.timer` | 只读 | 看实际生效的配置 |
| `systemctl start myjob.service` | ✅ 立刻跑一次 | 测试用 |
| `systemctl enable --now myjob.timer` | ✅ | 开机启用 |

配一个最小 timer：

```ini
[Unit]
Description=每日备份

[Timer]
OnCalendar=daily
Persistent=true
RandomizedDelaySec=10m

[Install]
WantedBy=timers.target
```

::: warning

`Persistent=true` 是 cron 给不了的东西
它的含义是：**如果到点时机器是关着的，开机后立刻补跑一次。** 备份、证书续期、日志轮转这类任务都需要它；反过来，像「每 5 分钟看一眼有没有新消息」这种低频轮询任务**不要**开 `Persistent`，否则每次开机都会先补一大堆。

**判断句：任务漏跑过一次会造成后果，就要开 `Persistent`。**
:::

::: warning

`systemd` 里 `%` 也需要转义
`OnCalendar` 和 `ExecStart` 里，`%` 是 systemd 的占位符起始符，写单个 `%` 会报解析错误。**日期格式要写成 `%%`。** 这条和 cron 的 `%` 陷阱是同一个坑的两个变体。
:::

## 排障

**Q1：任务完全没执行，按这个顺序查，不要跳步：**

1. `crontab -l` —— **任务行真的存在吗**，注意别看的是别的用户的
2. `date` —— 机器时间对吗？**时间错了任务当然不触发**，容器里时区是 UTC 是常见原因
3. `systemctl is-active cron || systemctl is-active crond` —— 调度器在跑吗
4. `sudo grep CRON /var/log/syslog` 或 `journalctl -u cron --since today` —— 调度器**看到过这条任务吗**
5. 如果第 4 步没输出但任务确实在 crontab 里 → **五个字段的某处写错了，重点看日和周的「或」规则，以及 `%`**
6. `sudo -u <用户> env -i /bin/bash -lc '你的完整命令'` —— **用最接近 cron 的空环境复现一次**

**Q2：任务触发了但说「命令找不到」，手动跑却正常：**

1. `crontab -e` 顶部**没有设 `PATH`** → cron 的默认 PATH 不含 `~/.local/bin`、`/usr/local/bin`、nvm、pyenv
2. 写的是绝对路径的**那个文件没有执行位** → `ls -l` 确认
3. 确认你写的是绝对路径，不是别名
4. 用 `command -v 那个命令` 查真实路径，把这个路径抄进 crontab

**Q3：脚本报语法错误，但手动 `bash 脚本.sh` 没问题：**

1. cron 默认用 `/bin/sh`，而你的脚本用了 bash 语法（`[[ ]]`、数组、`source`）
2. 顶部加 `SHELL=/bin/bash`，**或者在命令行显式写 `bash /path/脚本.sh`**
3. `/bin/sh` 在 Debian/Ubuntu 上是 dash，报的错和 bash 完全不同，容易误判成脚本写错了
4. 确认脚本首行有 shebang，且**文件不是 CRLF**（`file 脚本.sh`）

**Q4：任务偶尔没跑，或同一时刻跑了两遍：**

1. `timedatectl` —— **看时区和夏令时状态**，凌晨那一小时会跳
2. `date '+%Z %z'` —— 确认是本地时区
3. 前一轮还没跑完 → 加 `flock`
4. crontab 里有重复行 → `crontab -l | sort | uniq -d`
5. 机器当时关机 → crontab 会直接漏掉这一次，**这就是该换 systemd timer `Persistent=true` 的信号**

**Q5：`/etc/cron.d/` 里的文件不执行：**

1. `ls -l /etc/cron.d/文件名` —— **文件名带点会被忽略**
2. `ls -l` 确认权限不是 664 / 666
3. `cat` 每一行 —— **必须有用户名列**（`0 4 * * * root /usr/bin/foo.sh`）
4. 文件末尾要有换行符，最后一行没有换行会被忽略
5. 仍不执行 → `journalctl -u cron` 里找 `error` 关键字

**Q6：任务卡住不动，别的任务也不跑了：**

1. `ps -ef | grep -E 'cron|你的脚本'` —— 是不是有个任务在等输入
2. 任务命令加上 `</dev/null`
3. `crontab -e` 里确认某条命令不是交互式程序（`top`、`vim`、交互式 `ssh`）
4. 一个任务卡住确实会**堵住后续所有任务** —— 这是 cron 单线程的固有行为

**Q7：脚本里的相对路径全部失效：**

1. cron 的工作目录是**登录用户的家目录**，不是你 `cd` 到的那个目录
2. 脚本内部用绝对路径，或者开头先 `cd` 到脚本所在目录：

```bash
cd "$(dirname "$0")" || exit 1
```

3. 日志文件写相对路径时，确认家目录可写

## 什么时候别用

- **不要用 crontab 跑需要长期常驻的服务。** 那应该写成一个 systemd 服务（`Restart=always`），crontab 只适合「到点做一次」的事。
- **不要在 crontab 里写超过几行的逻辑。** 逻辑写在脚本里，crontab 只留一行调用。**因为 crontab 没有语法检查，写错一个字段没人告诉你。**
- **机器大部分时间关着的话不要用 crontab。** 笔记本、虚机、开发机上休眠是常态，任务会静默漏掉。要么用 systemd timer 加 `Persistent=true`，要么用 anacron。
- **不要用 `0 0 * * *` 这种整点。** 成百上千台机器的定时任务都在整点触发，备份存储和上游服务会瞬间被打满。用 `systemd` 的 `RandomizedDelaySec`，或者在 crontab 里加几分钟的固定偏移。
- **不要在 crontab 里写 `sudo` 却没配 `NOPASSWD`。** 它会等密码输入，而 cron 没有 TTY —— **任务会永久卡在那里。** 要提权就用 `NOPASSWD` 精确到那条命令，或者直接把任务跑在 root 的 crontab 里。
- **不要用 `crontab -r`。** 它删掉当前用户的全部任务，没有确认和回收站。删一条任务用 `crontab -e` 编辑。
- **不要把 cron 当成可靠的消息队列。** 它没有重试、没有去重、没有并发控制。**任务可能重复执行，也可能永远不执行。** 需要可靠性就用消息队列或 CI 流水线。

## 哪些是通用的

| 这一章的判断 | Windows 上对应什么 |
| --- | --- |
| 「定时器和业务程序分开两处」 | schtasks 的任务 + 被调用的脚本 |
| 「环境变量要显式设置，不能继承」 | Windows 任务的默认环境同样很干净 |
| 「必须有日志重定向」 | 把输出重定向到文件，任务历史只记启动成功与否 |
| 「到点执行 + 持久化补跑」 | 任务计划程序的「错过后立即启动」选项 |
| 「要防止任务重叠」 | Windows 任务默认就不允许多实例，可以设成排队 |
| 「时区、夏令时是隐形故障源」 | 完全一样 |
| 「不要在整点集中触发」 | 同样适用于计划任务 |

**不通用的是表达方式。** cron 的五个数字字段和 systemd 的 `OnCalendar=` 是两套语法，Windows 又是第三套。**但「先手工跑通、再配成定时、然后验证它真的跑了」这个流程在任何平台都一样。** 换平台时先手工验证，别指望定时器能告诉你命令本身对不对。

## 跑完之后

你知道 cron 为什么找不到你手动能跑的命令，也知道日志该怎么重定向。下一章是权限篇的最后一章：当 `rwx` 三位真的不够表达你要的授权关系时。

→ [ACL：rwx 不够用时的精细授权](/linux/internals/15-acl)

## 🎮 实战演练

<ArenaTasks module-id="14-cron" />

<ToyShellTerminal module-id="14-cron" />

## 📝 配套练习

<QuizBlock module-id="14-cron" />
