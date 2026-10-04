---
title: systemd：服务起不来时按什么顺序查
description: unit 文件的三段结构、journalctl 的过滤写法，以及 failed 之后该看哪几行。
---

# systemd：服务起不来时按什么顺序查

> 读完你能读懂一个 unit 文件的三段，会用 journalctl 把某次失败的日志捞出来，并且知道「改了 unit 文件没生效」和「服务反复重启」这两类问题分别从哪查起。约 28 分钟。

<ModuleMeta module-id="11-systemd" />

## 前置条件

先确认这台机器真的有 systemd 跑在 PID 1 上：

```bash
ps -p 1 -o comm=
```

| 输出 | 意味着什么 |
| --- | --- |
| `systemd` | 正常，继续往下 |
| `init`、`bash`、`sleep` | **容器或 WSL 默认配置。**`systemctl` 会报 `System has not been booted with systemd as init system (PID 1)` |

确认版本：

```bash
systemctl --version
```

**你应该看到 `systemd 2xx` 加一行包信息。** 2.4x 和 25x 在 `journalctl` 的过滤和 `systemctl show` 的输出上有可见差别，混用别人的命令时先看版本。

再确认你能用 journalctl 读到日志：

```bash
journalctl -n 1
```

**你应该看到一行带时间戳的日志。** 如果报 `No journal files were found` 或者权限不足，见第 4 节。

## 1. unit 文件的三段结构

systemd 把「要管的东西」叫做 unit，文件放在 `/etc/systemd/system/`、`/usr/lib/systemd/system/`（发行版自带）、`/lib/systemd/system/`。**判断句：一个服务起不来，先确认它是谁提供的、配置文件在哪一份。**

| 目录 | 谁写的 | 会被包升级覆盖吗 |
| --- | --- | --- |
| `/etc/systemd/system/` | 你 | ❌ 不会 |
| `/usr/lib/systemd/system/` | 发行版或软件包 | ✅ **会** |

所以**永远不要直接改 `/usr/lib` 下的文件**，升级时会被覆盖且没有提示。改法见第 3 节。

一个 unit 文件由三段组成，**段名和顺序固定**：

```ini
[Unit]
Description=我的服务
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=appuser
WorkingDirectory=/srv/app
EnvironmentFile=-/etc/app/app.env
ExecStartPre=/usr/bin/test -d /srv/app
ExecStart=/usr/bin/app --config /etc/app/app.conf
Restart=on-failure
RestartSec=5s
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

| 段 | 放什么 | 最容易写错的字段 |
| --- | --- | --- |
| `[Unit]` | 描述、依赖、顺序 | `After` 只管**顺序**，`Wants`/`Requires` 才是**依赖** |
| `[Service]` | 怎么跑 | `ExecStart` 必须是**前台进程**；`User` 决定文件权限视角 |
| `[Install]` | 开机自启用哪个 target | 只有这条才会被 `systemctl enable` 消费 |

::: warning

`After=` 和 `Requires=` 不是一回事
`After=network.target` 只保证**顺序**（本单元在 network.target 之后启动），**不保证后者真的被拉起来**。想要这个保证必须写 `Wants=` 或 `Requires=`。

两者都写、只写一个，各有各的失败场景，所以模板里通常是成对出现。
:::

## 2. 起停操作，以及每条命令改了什么

| 命令 | 是否改动系统状态 | 作用 |
| --- | --- | --- |
| `systemctl status nginx` | 只读 | 状态摘要 + 最近几行日志 |
| `systemctl is-active nginx` | 只读 | **给脚本用**：用退出码判断，不解析输出 |
| `systemctl start nginx` | ✅ 启动 | 只影响现在 |
| `systemctl stop nginx` | ⚠️ 停止 | 中断正在处理的请求 |
| `systemctl restart nginx` | ⚠️ 停+起 | 旧进程已经没了才起新的 |
| `systemctl reload nginx` | ⚠️ 重载 | 多数服务支持，部分不支持 |
| `systemctl reload-or-restart nginx` | ⚠️ | 不支持 reload 就退化成 restart |
| `systemctl enable nginx` | ✅ 开机自启 | 写一条符号链接，**不影响现在** |
| `systemctl enable --now nginx` | ✅ 两者都做 | |
| `systemctl disable nginx` | ✅ 取消自启 | 不影响现在 |
| `systemctl daemon-reload` | ✅ 让 systemd 重读 unit 文件 | **改完 unit 文件必跑** |
| `systemctl mask nginx` | ⚠️⚠️ 彻底禁止启动 | 连手动 start 都会失败 |
| `systemctl unmask nginx` | ✅ 解除禁止 | |

**判断句：`enable` 管「重启机器后」，`start` 管「现在」。做了一件事不代表另一件发生了。** 查法：`systemctl is-enabled X` 和 `systemctl is-active X` 是两条独立的信息。

::: warning

改完 unit 文件不生效的顺序问题
这是最高频的一类问题。**编辑保存之后依次要做两件事：**

```bash
sudo systemctl daemon-reload
sudo systemctl restart nginx
```

`daemon-reload` 只是让 systemd 重新**读** unit 文件，**已经在跑的进程还是老配置**。所以 reload 之后必须再 restart 才真正生效。

**判断句：漏了 `daemon-reload` 是「改了没反应」，漏了 `restart` 是「reload 之后还是老行为」。**
:::

::: danger

`restart` 是「先停后起」，不是「平滑重启」
`systemctl restart` 一定先执行 `stop`，**在 stop 完成之前新进程不会起来**。对 Nginx 这类支持 reload 的服务，应该用 `systemctl reload`（`reload-or-restart` 更稳）以免中断连接。

另外：`restart` 之后新进程起不来，旧进程也已经没了 —— **这时候你失去了一个本来还能工作的服务。** 生产上要重启一个起不来的服务，先 `status` 看清楚失败原因。
:::

::: tip

改配置用 `systemctl edit`，不要手改文件
```bash
sudo systemctl edit --full nginx    # 编辑完整 unit
sudo systemctl edit nginx           # 只写一个 drop-in 覆盖
```

`systemctl edit` 会创建 `/etc/systemd/system/nginx.service.d/override.conf`，里面只需要写你要改的字段，**其余从原文件继承**。手改 `/usr/lib` 下的文件会在包升级时被静默覆盖。

执行 `edit` 之后 systemd 会自动做 `daemon-reload`，省掉一步。
:::

## 3. 进程与 user 决定了你看到的世界

| 字段 | 决定什么 | 写错的后果 |
| --- | --- | --- |
| `Type=simple` | `ExecStart` 的进程就是主进程 | 进程 fork 出去后 systemd 认为服务已退出 |
| `Type=notify` | 进程要主动用 `sd_notify` 报告就绪 | 没实现通知就一直停在 `activating` |
| `Type=forking` | 启动脚本会 fork 后退出，systemd 靠 `PIDFile=` 找主进程 | **没写 `PIDFile` 就无法管理** |
| `User=appuser` | 服务的文件访问视角 | 读不了属主是别人的配置/数据 |
| `WorkingDirectory=` | 相对路径的基准目录 | 相对路径全部失效 |
| `EnvironmentFile=-/etc/app/app.env` | 读环境变量 | **`-` 前缀表示文件不存在也不报错** |
| `ExecStartPre=` | 启动前的检查，失败即中止 | 目录不存在就永远起不来 |

::: warning

`ExecStart` 里不要加 `&`
`Type=simple` 时 systemd 期望 `ExecStart` 的进程**一直待在前面**。写成 `ExecStart=/usr/bin/app &` 会让 shell 立刻退出，systemd 认为服务已经结束，报 `Service ... exited` 并进入 `failed`。

**判断句：`ExecStart` 里出现 `&`、`nohup`、`>` 重定向到文件，就说明写法错了** —— 日志该走 journal，用 `StandardOutput=` 控制，不要自己重定向。
:::

### 看服务实际拿到的环境

```bash
systemctl show nginx -p User -p WorkingDirectory -p Environment -p ExecMainStatus
```

**你应该看到 `ExecMainStatus=0` 表示成功退出；非 0 就是那个命令的退出码。**

| 退出码 | 含义 |
| --- | --- |
| `0` | 正常 |
| `1` | 应用程序自己报错退出，看它的日志 |
| `126` | 文件找到了但**没有执行权限** |
| `127` | 文件或命令**不存在** |
| `203` | `EXIT_EXEC`，**无法执行 `ExecStart` 里那个命令**（路径写错、没执行位、解释器不存在） |

**判断句：`Result: exit-code` 且状态码是 203 / 126 / 127，说明 systemd 根本没把程序跑起来，此时去翻应用日志是浪费时间，直接查 `ExecStart` 的路径和执行位。**

## 4. journalctl：把日志捞对

| 写法 | 是否改动数据 | 过滤条件 |
| --- | --- | --- |
| `journalctl -u nginx` | 只读 | 该 unit 的全部日志 |
| `journalctl -u nginx -n 50` | 只读 | 最近 50 行 |
| `journalctl -u nginx -f` | 只读 | 跟随输出（**排查必用**） |
| `journalctl -u nginx -b` | 只读 | 仅本次开机 |
| `journalctl -u nginx -b -1` | 只读 | 上一次开机 |
| `journalctl -p err` | 只读 | 级别 ≤ err（emerg 到 err） |
| `journalctl -u nginx -p err` | 只读 | 两者取交集 |
| `journalctl --since '10 min ago'` | 只读 | 相对时间 |
| `journalctl -o short-precise` | 只读 | **带时区的精确时间**，对日志 |
| `journalctl -k` | 只读 | 只有内核消息 |
| `journalctl _PID=1234` | 只读 | 按进程 ID |
| `journalctl --disk-usage` | 只读 | 日志占了多少磁盘 |
| `journalctl --vacuum-size=500M` | ⚠️ 删除旧日志 | 收缩到 500M |

**判断句：`-f` 配合 `restart` 一起用 —— 先开 `journalctl -u X -f`，再执行 `systemctl restart X`，失败的那一刻你不用离开终端。**

::: warning

级别过滤的字母和数字方向相反
`journalctl -p` 的数值越小越严重：

| 范围 | 含义 |
| --- | --- |
| `0` emerg | 系统不可用 |
| `1` alert | 必须立即处理 |
| `2` crit | 崩溃 |
| `3` err | 错误 |
| `4` warning | 警告 |
| `5` notice` / `6` info` / `7` debug |

**所以 `-p err` 表示「err 及以上」，`-p 4` 才是「warning 及以上」。** 直接写 `-p warning` 和 `-p 4` 等价。
:::

::: warning

日志盘满了也要先看
```bash
journalctl --disk-usage
df -h /var/log
```

`/var/log` 满会导致**一堆和磁盘无关的服务同时写不进日志**，症状是「服务莫名其妙停了，日志还停在某个时间点」。`journalctl --vacuum-size=500M` 会**删除旧的日志条目**，属于不可逆操作 —— 先确认 disk-usage 数字再决定收多少。
:::

## 5. 出现 failed 之后，看这几行

按这个顺序读 `systemctl status` 的输出：

1. **`Active:` 那一行** —— `failed (Result: exit-code)` 告诉你失败方式。`Result: timeout`、`Result: exit-code`、`Result: signal` 指向完全不同的问题
2. **`Process:` / `Main PID:` 那一行** —— 主进程 PID。有 PID 说明起来过又退了；`0` 或没有说明根本没起来
3. **最后几行日志** —— 真正的错误信息在这一段，往上翻找第一处 `error` / `failed` / `Traceback`
4. **`CGroup` 那一段** —— systemd 给这个 unit 建的 cgroup 路径，容器和资源限制相关时有用

## 排障

**Q1：服务 `failed`，从头开始按这个顺序查：**

1. `systemctl is-active X` —— 先拿到确定状态，别看 `status` 的人类可读输出
2. `systemctl status X` —— 记下 `Result:`、PID、日志最后 20 行
3. `journalctl -u X -b -n 100 -o short-precise` —— **完整时间线**，包括启动前的失败
4. `systemctl show X -p ExecStart -p User -p WorkingDirectory -p ExecMainStatus` —— 配置和退出码对不对得上
5. `sudo systemctl status X` —— 换 root 再看一次。**权限不足时很多信息是看不到的**
6. `journalctl -u X -b | grep -iE 'error|denied|refused'` —— 把错误行挑出来

**Q2：`exit-code 203` 或者根本看不到应用日志？**

1. `systemctl show X -p ExecStart` —— 把命令抄出来，**直接手动执行一次**
2. `ls -l` 那个二进制路径 —— 有没有执行位
3. `file 那个路径` —— 是不是 shell 脚本但缺 shebang，或解释器路径不对
4. `cat -A` 脚本头一行 —— 有没有多出来的 `^M`（CRLF）
5. 都不是的话，把 `ExecStart` 里的相对路径换成绝对路径

**Q3：服务在 `activating` 状态卡着不动？**

1. `systemctl show X -p TimeoutStartUSec` —— 看启动超时是多少
2. `journalctl -u X -f` —— 贴上去看它卡在哪一步
3. `Type=notify` 的服务要自己发就绪通知，**没发就一直等**，直到超时
4. `Type=forking` 但没写 `PIDFile=`，systemd 找不到主进程
5. `ps aux | grep ExecStart里那个名字` —— 进程其实起来了，只是 systemd 不认

**Q4：服务反复重启，日志刷屏？**

1. `journalctl -u X -b | grep -c 'Scheduled restart'` —— 数一下重启了多少次
2. `journalctl -u X -b -n 100` —— 找**第一次**失败，不要看最后一次
3. `systemctl show X -p RestartSec` —— 退避时间太小会刷屏，太大你又等得久
4. 临时止损：`systemctl stop X`，改成正确配置后再 `start`
5. 注意 `Restart=always` 的语义：它连**你主动 stop 时**都会重启，只有 `systemctl stop` 才真的停 —— **手改配置时别用 kill 进程的方式「停一下」**

**Q5：`systemctl start` 成功但重启机器后没了？**

1. `systemctl is-enabled X` —— enable 和 start 是两件事
2. `sudo systemctl enable X` —— 只影响以后的开机
3. `systemctl list-dependencies multi-user.target | grep X` —— 确认符号链接挂到了哪个 target
4. `systemctl is-enabled X` 返回 `static` —— 这个 unit 没有 `[Install]` 段，**设计上就不能被 enable**，需要别的 target 拉起它

**Q6：改了 unit 文件，什么都没变？**

1. `systemctl daemon-reload` 跑了吗 —— **最常见原因**
2. 改的是 `/usr/lib` 下那份，实际生效的是 `/etc` 或 drop-in —— `systemctl cat X` 会把所有来源合并打印出来
3. 改完只 reload 没 restart —— 跑着的还是老配置
4. `systemctl cat X` 确认最终生效内容，**这个命令专门用来解决「我明明改了」**

## 什么时候别用

- **不要用 `systemctl restart` 当「重载配置」。** Nginx、Apache 这类支持 `reload`，restart 会断连接。**优先 `systemctl reload`，不确定就用 `reload-or-restart`。**
- **不要用 `mask` 代替 `disable`。** `disable` 只是取消开机自启，`mask` 让它**彻底无法启动**。`mask` 主要用于防止包管理器意外拉起某个 unit，用错了会导致你 `start` 也起不来，而且 `status` 里的报错（`Unit is masked`）不够显眼。
- **不要用 `systemctl isolate` 切 target。** 它会停掉所有不在目标 target 里的 unit，在图形会话或远程连接里执行有把系统搞成只能单用户模式的风险。用 `isolate` 前先 `systemctl list-dependencies <目标>` 看清楚会停什么。
- **不要在 `ExecStart` 里用 `&`、`nohup` 或 shell 语法。** systemd 不走 shell，这段命令会被直接 exec，复杂逻辑写成 `ExecStartPre` 或独立的 `EnvironmentFile`。
- **不要手改 `/usr/lib/systemd/system/` 下的文件。** 包升级时会被覆盖且没有合并提示。用 `systemctl edit`。
- **不要给每个服务都加 `Restart=always`。** 依赖缺失、配置写错这类**不会自愈**的故障，重启一万次也是一样的结果，只会刷满日志。**先查清原因再决定要不要开自动重启。**
- **不要靠 `systemctl status` 的输出做自动化判断。** 它是人类可读的，措辞会随版本变化。脚本里用 `systemctl is-active` 的退出码。

## 哪些是通用的

| 这一章的判断 | Windows 上对应什么 |
| --- | --- |
| 「服务 = 一个能启停、有状态、能查日志的单元」 | Windows 服务 / `Get-Service` |
| 「改配置 → 重读 → 重启」 | `sc.exe config` + `Restart-Service` |
| 「按 unit 过滤日志」 | `Get-WinEvent -FilterHashtable @{LogName='System'}` |
| 「区分 enabled 和 active」 | 启动类型 vs 当前状态，完全是同一对概念 |
| 「查退出码判断失败原因」 | `Get-Service` 依赖、`sc queryex` 返回码 |
| 「不手改安装目录下的文件」 | 不改 `%WinDir%` 里的配置，用组策略或 `-LocalFile` |

**不通用的是「everything is a unit」这个设计。** systemd 把 socket、timer、路径挂载、设备、快照全都统一成同一种对象管理，这个抽象 Windows 和 macOS 都没有。**换成别的系统时不要试图找对应物，只保留「服务有状态、有日志、有启停动作、退出码能说明原因」这套判断方式。**

## 跑完之后

你能读 unit 文件、捞到失败那一刻的日志、并区分「没起过」和「起了又挂」。下一章把「起不来」的排查思路再套一层：容器起不来时，unit 文件和 `docker logs` 各管什么。

→ [Docker：镜像、容器、卷三者的关系](/linux/internals/12-docker)

## 🎮 实战演练

<ArenaTasks module-id="11-systemd" />

<ToyShellTerminal module-id="11-systemd" />

## 📝 配套练习

<QuizBlock module-id="11-systemd" />
