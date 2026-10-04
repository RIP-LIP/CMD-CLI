---
title: 跨平台协作：WSL、Samba 与远程桌面
description: Linux 和 Windows 互相传文件的几种方式，各自的坑在哪。
---

# 跨平台协作：WSL、Samba 与远程桌面

> 读完你能判断自己现在是在 WSL、容器还是真机上，并按「同一台机器 / 两台机器 / 图形界面」三种需求选对传文件的方式，避开性能陷阱和 SMB1 那类年代问题。约 28 分钟。

<ModuleMeta module-id="09-cross-platform" />

## 前置条件

先确认你到底身处哪种环境 —— 这一章的每条建议都取决于答案：

```bash
uname -a
cat /etc/os-release | head -3
```

你应该看到内核版本和发行版名。再看一眼有没有微软或容器痕迹：

```bash
grep -qi microsoft /proc/version && echo "这是 WSL"
cat /proc/1/cgroup 2>/dev/null | head -2
ls -d /mnt/c /mnt/wsl 2>/dev/null
```

| 命令输出 | 你在哪 | 影响本章哪部分 |
| --- | --- | --- |
| 内核含 `microsoft` 或 `WSL2`，且有 `/mnt/c` | WSL2 | 第 1 节全部适用 |
| 有 `/mnt/c` 但内核不含 microsoft | WSL1 | 性能问题不同，第 1 节的 9p 结论不适用 |
| `/proc/1/cgroup` 含 `docker` / `kubepods` | 容器 | 第 2 节的 SMB 挂载基本用不了 |
| 都没有 | 一台普通 Linux 机器 | 直接看第 2 节起 |

**判断句：先把「我在哪」确认清楚再动手。** WSL 里改 `/etc/samba/smb.conf` 不会让 Windows 看到任何东西，容器里装 Samba 也只是容器内自娱自乐。

## 1. WSL：先搞清挂载为什么慢

WSL2 的 `/mnt/c` 是通过 9p 协议把 Windows 目录映射进来的。**判断句：`/mnt/c` 上编译慢不是玄学，是跨文件系统的元数据开销。** 大量小文件（`node_modules`、Python 虚拟环境、Maven 仓库、`.git`）在这上面比在 WSL 原生 ext4 上慢一个数量级。

| 目录类型 | 放在哪 | 原因 |
| --- | --- | --- |
| 源码、小脚本、要传的文件 | `/mnt/c/...` | 双向可见，最省心 |
| `node_modules`、虚拟环境、构建产物 | `~/` （ext4） | 元数据操作密集 |
| 频繁读写的日志、数据库文件 | `~/` | 同上 |

### 让两个世界的路径互相转换

```bash
wslpath -w /home/max/project     # Linux 路径 → Windows 路径
wslpath -u 'C:\Users\max\project' # Windows 路径 → Linux 路径
```

**你应该看到 `\\wsl.localhost\发行版名\home\max\project` 这类输出。** 不装这两个工具就得自己拼 `/mnt/c/Users/...`，转 FQDN 和转盘符的差别全在这条命令里。

### 三个必须改的 /etc/wsl.conf 设置

```bash
cat /etc/wsl.conf
```

| 配置项 | 建议值 | 作用 |
| --- | --- | --- |
| `[boot] systemd=true` | 启用 | 让 `systemctl` 可用，否则报错 `System has not been booted with systemd` |
| `[interop] appendWindowsPath=false` | 建议关 | 阻止 Windows 的 PATH 混进 WSL |
| `[automount] metadata=umask` | 默认 | 控制挂载后的权限映射方式 |

```bash
sudoedit /etc/wsl.conf
```

改完必须**在 Windows 侧执行 `wsl --shutdown`** 才生效，WSL 里重启没用。**你应该看到 `wslpath` 与 `systemctl status` 都能正常工作。**

::: warning

`appendWindowsPath` 开着是 WSL 里最隐蔽的一类故障源
默认配置下，WSL 启动时会把 Windows 的 PATH 拼进来。于是 WSL 里可能命中 `C:\Windows\System32` 里的同名程序，或者命中 Windows 装的各种 shell 封装 —— **命令的行为和文档描述不一致，报错格式也是 Windows 风格。**

排查时先确认它是不是在干扰你：

```bash
echo $PATH | tr ':' '\n' | grep -n '/mnt/c'
```

**有输出就说明 Windows 路径在里面。** 关掉它之后，Windows 侧的程序要用绝对路径 `/mnt/c/.../prog.exe` 显式调用。

**判断句：同一个命令在 WSL 和原生 Linux 上行为不同，先看 `PATH` 里有没有 `/mnt/c`。**
:::

## 2. Samba：两台机器之间共享目录

当 Linux 和 Windows 是**两台独立机器**时，Windows 上最顺手的方式是 Samba（Linux 提供服务，Windows 用资源管理器直接访问 `\\ip\share`）。

| 步骤 | 命令 | 是否改动数据 |
| --- | --- | --- |
| 装服务 | `sudo apt install samba` | ✅ 装包 |
| 校验配置 | `testparm -s` | 只读，**改完配置必跑** |
| 改配置 | `sudoedit /etc/samba/smb.conf` | ✅ 改配置 |
| 建 Samba 用户 | `sudo smbpasswd -a <用户名>` | ✅ 建账号 |
| 重载 | `sudo systemctl reload smbd` | ⚠️ 影响服务 |

最小可用配置：

```ini
[share]
    path = /srv/samba/share
    browseable = yes
    read only = no
    valid users = @sambagroup
    create mask = 0644
    directory mask = 0755
```

**判断句：Samba 的用户是独立的一套账号体系，和 Linux 的 passwd 不是一回事。** 用户必须同时存在于两边，而且密码要用 `smbpasswd` 设，不能用 Linux 密码。

改完**先 `testparm -s` 看实际生效的配置**（它会打印注释掉的行，方便确认哪些没生效），再 `systemctl reload smbd`。**在 Windows 侧用 `\\IP\共享名` 访问。**

::: warning

别用 SMB1，它已经被主流系统关掉了
`server min protocol` 低于 SMB2 的配置在 Windows 10 1709 之后、以及 Samba 4.11 之后都会连不上，且报错常被误解为「网络不通」或「防火墙问题」。**新配置里不要碰协议版本，用发行版默认的 SMB2/SMB3。** 要确认实际协商到的版本，在 Linux 侧看日志：

```bash
sudo journalctl -u smbd -n 50 | grep -i 'protocol version'
```

**判断句：Windows 侧报「找不到网络路径」但 Linux 机器能 ping 通 → 先查协议版本，再查认证方式。**
:::

::: danger

不要为了图省事开 guest 访问
`map to guest = Bad User` 加上 `guest ok = yes` 会让任何能访问网络的人把你的目录写成可写。**共享目录一旦开了 guest 且暴露在办公网，等于把磁盘公开。** 需要访客只读，用专门的匿名账号和 `read only = yes` 的独立 share，不要在有数据的 share 上开。

`smbpasswd` 生成的凭据要放进文件时，**那个文件必须是 `600` 且属主是你**：

```bash
printf 'username=alice\npassword=...\n' > ~/.smbcred && chmod 600 ~/.smbcred
```

**判断句：凭据文件权限不对时，`mount.cifs` 不会报错，它会静默地走 guest 认证然后失败。** 排查时先 `ls -l` 这个文件。
:::

### Linux 侧挂载 Windows 的共享

```bash
sudo apt install cifs-utils
sudo mount -t cifs //192.168.1.20/share /mnt/win -o username=alice,vers=3.0
```

| 选项 | 作用 |
| --- | --- |
| `vers=3.0` | 指定 SMB 协议，**别用 `vers=1.0`** |
| `credentials=~/.smbcred` | 从文件读密码，**比写在命令行安全**（命令行会进 `ps` 和 shell 历史） |
| `uid=` `gid=` | 强制显示成自己的用户，省掉后面所有的权限麻烦 |

**判断句：`//IP/共享名` 里的反斜杠必须写成正斜杠，Windows 的路径写法在这里是错的。** 写对了却挂不上，依次查协议版本、凭据文件权限、`cifs-utils` 装没装。

## 3. 传文件本身：scp 和 rsync

跨机器传单个文件或目录，`scp` 和 `rsync` 覆盖了绝大多数场景。**Windows 10 1809 之后和 Windows 11 自带 OpenSSH 客户端**，`ssh` / `scp` / `sftp` 可以直接在 CMD 或 PowerShell 里用。

| 命令 | 是否改动数据 | 说明 |
| --- | --- | --- |
| `scp a.txt user@host:/tmp/` | ⚠️ 写远端 | 单文件 |
| `scp -r dir user@host:/tmp/` | ⚠️ 写远端 | 递归目录 |
| `scp -p a.txt user@host:/tmp/` | ⚠️ 写远端 | 保留修改时间 |
| `rsync -avz src/ dst/` | ⚠️ 写目标 | 增量同步 |
| `rsync -avz --delete src/ dst/` | ⚠️⚠️ 写目标并**删除** | 见下方警告 |
| `rsync -avz -e ssh src/ user@host:/dst/` | ⚠️ 写远端 | 走 SSH |

::: warning

rsync 的结尾斜杠决定复制的是目录还是目录内容
这是 rsync 最容易错的一处，两种写法结果不同：

| 命令 | 结果 |
| --- | --- |
| `rsync -avz src dst/` | 目标下出现 `dst/src/...` |
| `rsync -avz src/ dst/` | `src` 的**内容**直接进 `dst/`，没有中间那层 |

**判断句：末尾斜杠永远跟在源目录上，表示「把这个目录里的东西拿过去」。** 首次同步时用 `-avzn`（`n` 是 dry-run）看一遍列表再决定。
:::

::: danger

`--delete` 会删掉目标端多出来的文件，而且没有回收站
`rsync -a --delete src/ dst/` 的语义是「让 `dst/` 和 `src/` 完全一样」，**目标端多出来的文件会被删除**。`src/` 后面那个斜杠漏了、或者源目录挂载出了，删的就是整棵目标目录。

规矩：第一次用 `--delete` 一定先加 `-n`：

```bash
rsync -avzn --delete src/ dst/
```

**你应该看到一份待删文件的清单。** 确认过再去掉 `n`。这条没有「手滑」的解释余地。
:::

::: tip

OpenSSH 9.0 起 `scp` 底层换成了 SFTP
从 OpenSSH 9.0 开始（Ubuntu 22.04 及以后常见），`scp` 传输走的是 SFTP 协议，行为和老的 SCP 不完全一样，老脚本里的一些边角写法会变。**要退回旧的 SCP 传输方式加 `-O`**，但新脚本里更好的选择是 `sftp` 批处理或者直接 `rsync -e ssh`。

**判断句：`scp` 传大目录很慢且无法续传 —— 那是它的实现方式，不是网络问题，换 `rsync`。**
:::

## 4. 图形界面：三种远程方案

| 方案 | 协议 | 适合 | 前置成本 |
| --- | --- | --- | --- |
| X11 转发（`ssh -X`） | SSH | 单个 GUI 程序 | Linux 侧零配置，Windows 侧要装 X 服务器 |
| `xrdp` | RDP | 想要完整桌面 | Linux 装 `xrdp` + 一个轻量桌面 |
| VNC | VNC | 内网、带宽小 | 两端都要装，服务要额外加固 |

**判断句：只需要在远程机器上打开一个窗口程序，就用 `ssh -X`，别装远程桌面。**

```bash
ssh -X user@host
```

**你应该看到远程 GUI 程序直接显示在本机的 X 服务器窗口里。** 前提是本机（Windows）装了 VcXsrv 或 Xming 之类的 X 服务器，并且在监听。**X11 转发会加密并压缩，所以画图类应用会很卡，动画基本不可用。**

要完整桌面时装 `xrdp`，**但它和图形登录会话互斥**：同一个用户如果已经在本地图形会话里，xrdp 会切走那个会话，反之亦然。**判断句：xrdp 上「登录后本地屏幕黑了」不是故障，是同一个会话不能在两处同时存在。**

VNC 的默认配置常常**不加密、也不要求密码**，只在监听 `127.0.0.1`。判断它安不安全只看一件事：

```bash
ss -tlnp | grep -E '5900|5901|3389'
```

**你应该看到监听地址是 `0.0.0.0` 才有问题。** 是 `127.0.0.1` 说明只能本机连（或者靠 SSH 隧道转发），这一步的加固是值得做的。

## 排障

**Q1：Windows 上 `\\IP\share` 报「找不到网络路径」？**

按这个顺序查，不要跳步：

1. `ping <IP>` —— 机器通吗
2. `testparm -s` —— 配置有没有语法错误，share 段落名和 Windows 上访问的名字是否一致
3. `sudo journalctl -u smbd -n 50` —— **Samba 把真实原因写在这里**，Windows 那边只会给一个笼统的报错
4. `sudo ss -tlnp | grep -E '139|445'` —— 服务在监听吗
5. `sudo smbpasswd -a <用户名>` 重新设一次密码，确认是 Samba 密码而不是 Linux 密码

**Q2：WSL 里装的服务 systemctl 起不来？**

1. `grep -qi microsoft /proc/version` —— 确认是 WSL
2. `cat /etc/wsl.conf` —— 有没有 `[boot] systemd=true`
3. Windows 侧执行 `wsl --shutdown` —— **改完 wsl.conf 必须在 Windows 侧重启 WSL，WSL 内部重启无效**
4. `systemctl status` 看报错是不是 `System has not been booted with systemd`

**Q3：`scp` 传大文件传到一半断了？**

1. `scp -O` —— 试试退回旧协议（旧服务端不认 SFTP）
2. 改用 `rsync -avz -e ssh --partial src/ user@host:/dst/` —— 断了能续
3. `ssh -v user@host` —— 看握手卡在哪
4. 中间有跳板机的话加 `-J 跳板机`

**Q4：WSL 里的服务 Windows 侧访问不到？**

1. 服务是不是只监听了 `127.0.0.1` —— **WSL2 里有自己的网络，Windows 需要通过 localhost 转发访问**
2. `ss -tlnp` 看监听地址，改成 `0.0.0.0`
3. Windows 侧的防火墙可能拦 WSL 的转发流量
4. WSL1 和 WSL2 的网络模型不同，**在 WSL2 上「同一个局域网里其他机器直接访问 WSL 里的服务」需要额外配置**，不是默认行为

**Q5：rsync 同步完，目标目录里多了些没见过的文件？**

1. `rsync -avzn --delete src/ dst/` —— 先 dry-run
2. 看清单里哪些会被删，确认它们确实是源端已经没有的
3. 确认命令里 `src/` 的斜杠没漏 —— 漏了的话源目录本身被当成要创建/清空的对象

## 什么时候别用

- **同一台机器的 Windows 目录和 Linux 目录，不要用 Samba。** 直接挂 `/mnt/c`，或者干脆把项目放 WSL 原生目录。**Samba 解决的是跨机器问题，同机用它只是给自己加了一层协议和一套权限映射。**
- **不要在 `/mnt/c` 上放 `node_modules` 或虚拟环境。** 9p 上的小文件元数据操作会拖垮构建。放 `~/`，需要同步再单独处理。
- **不要为了「方便」在共享目录上开 guest 或全局可写。** Samba 的 `nobrowse` 和 `read only` 是有意义的默认值，开之前先想清楚谁能访问这个网络段。
- **不要用 VNC 暴露到 `0.0.0.0`。** 默认的 VNC 配置常常是弱认证甚至无认证。要远程图形优先 `xrdp`（走 RDP，能复用 Windows 客户端），或者 `ssh -L` 端口转发把 VNC 限制在隧道里。
- **不要用 scp 传大目录或需要续传的任务。** 用 `rsync`。`scp` 没有增量、没有续传，中断只能重来。
- **只在你的机器上改 `/etc/wsl.conf` 之前先 `sudo cp /etc/wsl.conf /etc/wsl.conf.bak`。** 配错了会让 WSL 起不来，Windows 侧的文件可以再从 Windows 分区里手动恢复。
- **不要用 WSL 去跑必须直接访问硬件的服务**（直通 GPU 除外需要 WSL2 支持），虚拟化层会带来难以排查的性能和行为差异。

## 哪些是通用的

| 这一章的判断 | 换个平台还成立吗 |
| --- | --- |
| 「先确认自己在哪种环境」 | 完全成立，是所有排障的第一步 |
| 「传文件用增量同步而不是全量复制」 | 任何环境都成立，rsync 在 macOS 上也有 |
| 「凭据不放命令行」 | 完全成立，`ps` 和 shell 历史在哪个平台都存在 |
| 「远程服务默认只监听回环地址」 | 完全成立，暴露前要有意识 |
| 「批量删除/同步前先 dry-run」 | 完全成立 |
| 「图形界面优先用加密协议而非明文协议」 | 成立，X11 转发就是靠 SSH 加密 |

**不通用的是具体协议。** SMB 是 Windows 生态的实现，Linux 侧共享目录也可以用 SSH 的 SFTP 或 NFS。NFS 在 Linux 之间更合适，但在 Windows 上的成熟度不如 SMB。**原则是：同构平台用原生协议，跨平台用双方都支持得最好的那一个。**

## 跑完之后

你能说清自己在 WSL、容器还是真机上，并按「同机 / 跨机 / 图形」三种需求选对工具。下一章把手动操作固化成脚本，让它可以反复跑。

→ [Shell 脚本：把一串手动操作固化成可重跑的东西](/linux/howto/10-shell-script)

## 📝 配套练习

<QuizBlock module-id="09-cross-platform" />
