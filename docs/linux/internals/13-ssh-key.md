---
title: SSH 与密钥：免密登录与主机验证
description: 密钥对生成与推送、known_hosts 的作用，以及「第一次连接时的那个 yes/no」到底在确认什么。
---

# SSH 与密钥：免密登录与主机验证

> 读完你能免密登录一台机器，并且知道那把私钥的权限一旦松了会发生什么、那个 `yes/no` 问的到底是什么、以及 `Permission denied (publickey)` 该按什么顺序查。约 30 分钟。

<ModuleMeta module-id="13-ssh-key" />

## 前置条件

```bash
ssh -V
ls -la ~/.ssh 2>/dev/null || echo "~/.ssh 不存在"
```

**你应该看到类似 `OpenSSH_9.6p1` 的版本号。** 版本低于 8.8 的客户端对旧式 RSA 签名有兼容性差异，第 3 节会讲到那个症状。

再看 `~/.ssh`：

| 你应该看到的 | 含义 |
| --- | --- |
| 不存在 | 第一次用 SSH，先 `mkdir -p ~/.ssh && chmod 700 ~/.ssh` |
| 有 `id_*` 且没有 `.pub` | 这是私钥，权限必须是 `600` |
| 有 `id_*.pub` | 对应公钥，这个可以公开 |
| 有 `known_hosts` | 记录你连过的机器的指纹 |

**判断句：先看清楚 `.ssh` 目录里哪些是你的私钥，再动任何东西。** 私钥权限不对会导致密钥被 sshd 拒绝，同时私钥本身也已经不安全了。

## 1. 两种认证方式

| 方式 | 你提供什么 | 服务端检查什么 | 抗暴力破解 |
| --- | --- | --- | --- |
| 密码 | 口令 | 存的哈希 | ❌ 可被反复试 |
| 公钥 | 用私钥签的一段数据 | 你公钥对应的验证 | ✅ 私钥不通过网络传输 |

**判断句：免密登录传的不是私钥，是「用私钥签出来的结果」。** 所以私钥永远不出你的机器，网络上跑的是公钥。

配置方向永远是**从客户端推送到服务端**：

```text
本机 ~/.ssh/id_ed25519          私钥，绝不外传
本机 ~/.ssh/id_ed25519.pub      公钥，可以随便给人
        │ 推送到
远端 ~/.ssh/authorized_keys     允许用哪些公钥登录这台机器
```

**两台机器之间的免密是单向的。** 你把公钥推到 B，B 就能免密登录 A；反之不成立，各自有各自的 `authorized_keys`。

## 2. 生成密钥对

```bash
ssh-keygen -t ed25519 -C "max@laptop-2026" -f ~/.ssh/id_ed25519_work
```

**你应该看到类似 `Your identification has been saved in .../id_ed25519_work` 的输出。**

| 参数 | 作用 | 是否改动数据 |
| --- | --- | --- |
| `-t` | 算法：`ed25519` 或 `rsa` | — |
| `-b` | RSA 的位数，3072 起，4096 更慢但更从容 | — |
| `-C` | 注释，一般写「这是谁的、哪台机器的」 | — |
| `-f` | 输出文件路径，**给不同用途的密钥起不同名字** | ✅ 建文件 |
| `-N ''` | 空口令（只在自动化场景用） | — |
| 交互式输入口令 | **给私钥加密，推荐** | — |

| 算法 | 说明 |
| --- | --- |
| `ed25519` | **默认选它。** 短、快、安全强度足够，OpenSSH 6.5（2014 年）起支持 |
| `rsa -b 4096` | 只在对接很老的主机或硬件设备时用，见第 3 节 |

**判断句：文件名要能看出用途**（`id_ed25519_work`、`id_ed25519_git`），因为配 `~/.ssh/config` 时靠的是这个路径，而一台机器上同时存在好几把密钥是常态。

::: tip

一把密钥按用途拆，不要一把走天下
密钥泄露的影响范围和它的用途成正比。**给工作一台、给 Git 托管服务一把、给跳板机一把。** 有了多把密钥之后要配 `~/.ssh/config`（第 6 节），并且加 `IdentitiesOnly yes` —— 否则 ssh 会把 agent 里所有密钥挨个递给服务端，密钥一多就可能撞上 `Too many authentication failures`。
:::

## 3. 把公钥推上去

```bash
ssh-copy-id -i ~/.ssh/id_ed25519_work.pub max@192.168.1.50
```

**你应该看到 `Number of key(s) added: 1`，以及一条提示说下次不用输密码了。**

`ssh-copy-id` 做的事是：用密码登录一次，在远端 `~/.ssh/authorized_keys` 追加你的公钥。**它需要远端的密码认证还能用**。如果远端已经关掉了密码认证（生产机器常见），只能用别的方式把公钥送进去：

```bash
cat ~/.ssh/id_ed25519_work.pub
# 复制这一行，在远端上执行：
mkdir -p ~/.ssh && chmod 700 ~/.ssh
echo 'ssh-ed25519 AAAA... max@laptop-2026' >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

**判断句：权限不对是免密失败最常见的原因，而且报错出现在服务端日志里，不在你的屏幕上。** 服务端会拒绝整条 authorized_keys：

| 路径 | 必须是 |
| --- | --- |
| `~/.ssh` | `700` |
| `~/.ssh/authorized_keys` | `600` |
| 私钥 `id_ed25519_*` | `600` |
| `~/.ssh/config` | `600` |
| `~/.ssh/known_hosts` | `644` 即可 |

```bash
ls -ld ~/.ssh && ls -l ~/.ssh
chmod 700 ~/.ssh && chmod 600 ~/.ssh/authorized_keys ~/.ssh/config 2>/dev/null
```

## 4. known_hosts：那个 yes/no 到底在问什么

第一次连一台机器，你会看到：

```text
The authenticity of host '192.168.1.50 (192.168.1.50)' can't be established.
ED25519 key fingerprint is SHA256:xxxxx...
Are you sure you want to continue connecting (yes/no/[fingerprint])?
```

**这个问题的准确含义是：「我第一次见这台机器，我把它记下来，以后如果它换了密钥我会告诉你。你确认现在连的这台是可信任的吗？」**

判断句：你在信任的是**密钥**，不是密码、不是 IP 地址、也不是机器名。

那行 `fingerprint` 是给你拿去**用别的渠道核对**的：控制台面板上、运维同事那边、或者机器本地 `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`。**核对完再输 `yes`。**

之后这台机器的密钥会记在 `~/.ssh/known_hosts` 里，以后每次连接都会自动比对，不需要你再回答。

| 你看到的 | 含义 | 怎么做 |
| --- | --- | --- |
| 第一次问 `yes/no` | 没见过的机器 | **核对指纹后再输 yes** |
| `Host key verification failed` | 指纹对不上 | 见下方警告 |
| `REMOTE HOST IDENTIFICATION HAS CHANGED` | 记录过的密钥变了 | 见下方警告 |
| 什么都不问直接连上 | 你配了 `StrictHostKeyChecking=no` | 你的 TOFU 已经失效了 |

::: danger

指纹变了不要直接 `rm` 掉 known_hosts
`REMOTE HOST IDENTIFICATION HAS CHANGED` 有两种原因，处理方式完全相反：

| 真实原因 | 处理 |
| --- | --- |
| **中间人攻击**（有人在冒充那台机器） | **立刻停止**，用控制台核实，确认自己正在暴露凭据 |
| 那台机器重装过 / IP 换了机器 | 核实指纹正确后，才删除旧记录 |

删除的命令：

```bash
ssh-keygen -F 192.168.1.50     # 先查旧记录长什么样
ssh-keygen -R 192.168.1.50     # 删掉
```

**判断句：先 `ssh-keygen -F` 看旧指纹，再用别的渠道确认新指纹可信，然后才 `-R`。** 跳过第一步就删，等于主动关掉了唯一一道防线。批量处理时用 `ssh-keyscan` 取新指纹，但**它同样是 TOFU，取到的指纹本身也需要核对**。
:::

## 5. 让连接不再每次输密码

### 首次连接用 agent 记住密钥

```bash
eval "$(ssh-agent -s)"
ssh-add ~/.ssh/id_ed25519_work
ssh-add -l          # 列出 agent 里的密钥
```

**判断句：agent 解锁的是密钥的口令，不是登录密码。** agent 退出后要重新 `ssh-add`，所以 `eval "$(ssh-agent -s)"` 那一行要么写进 shell 启动文件，要么每次开新终端都敲一次。

`SSH_AUTH_SOCK` 环境变量是 ssh 找到 agent 的唯一途径。**在 systemd 服务或容器里没有这个变量，所以 agent 方案不适用于自动化** —— 那些场景要么用 `ssh-agent` 转发（把私钥暴露给远端进程，见下），要么干脆不用密钥。

::: warning

`ForwardAgent yes` 把 agent 的控制权交给了远端
`-A` / `ForwardAgent yes` 把本地 agent 的 socket 转发过去，于是**远端那台机器上任何能读到 socket 的进程都能借用你的密钥**。跳板机上如果有别的用户或别的服务，这等于把你的私钥交给了它们。

**判断句：跳板机不可信时不要转发 agent，改用 `ProxyJump`（第 6 节）—— 数据流不落到中间机器上。**
:::

### 一次配置，多处生效

```bash
ssh -o PasswordAuthentication=no -o BatchMode=yes max@192.168.1.50 true
```

**你应该看到命令直接成功返回，没有密码提示。** 这条命令专门用来验证「公钥认证到底通不通」：`-o BatchMode=yes` 让它**绝不去问密码**，能不能连上完全取决于密钥。把它放进你的检查脚本里。

## 6. ~/.ssh/config：这一段值得抄

```sshconfig
Host work
    HostName 192.168.1.50
    User max
    IdentityFile ~/.ssh/id_ed25519_work
    IdentitiesOnly yes
    ServerAliveInterval 30
    ServerAliveCountMax 3

Host bastion
    HostName bastion.example.com
    User max
    IdentityFile ~/.ssh/id_ed25519_work

Host internal
    HostName 10.0.0.20
    User deploy
    ProxyJump bastion
    IdentityFile ~/.ssh/id_ed25519_work
```

配好之后：

```bash
ssh internal          # 直接跳到内网机器，中间那台不落地
```

| 配置项 | 作用 |
| --- | --- |
| `Host` | 别名，后续所有选项都只在匹配它时生效 |
| `IdentityFile` | 这台机器用哪把密钥 |
| `IdentitiesOnly yes` | **只用上面指定的那把**，不把 agent 里所有密钥挨个递出去 |
| `ServerAliveInterval 30` | 每 30 秒发一次心跳，避免 NAT 超时断连 |
| `ProxyJump` | 通过跳板机直连，不需要两段跳转 |

**判断句：`~/.ssh/config` 是按「第一个匹配的 `Host` 块」生效的，所以越具体的别名要越靠前，兜底的 `Host *` 放最后。**

连不上时的诊断开关：

```bash
ssh -v internal 2>&1 | tail -30
```

**在 `-v` 输出里找这三行，顺序就是认证过程：**

```text
Offering public key: /root/.ssh/id_ed25519_work      ← 客户端递了哪把
Server accepts key: ...                              ← 服务端认了哪把
Authentication succeeded (publickey)                 ← 成功
```

**看到 `Authentications that can continue: publickey` 就说明服务端只接受公钥认证。**

## 排障

**Q1：`Permission denied (publickey)`，按这个顺序查：**

1. `ssh -v user@host 2>&1 | grep -E 'Offering|accepts|Authentications'` —— **看客户端递了什么、服务端要什么**
2. `ls -l ~/.ssh; ls -l ~/.ssh/authorized_keys` —— 权限是不是 700 / 600
3. `ssh user@host 'cat ~/.ssh/authorized_keys'` —— 里面到底有没有你的公钥
4. `ssh -o PasswordAuthentication=no -o BatchMode=yes user@host true` —— 排除「其实是密码在起作用」
5. 服务端看真正的理由：`journalctl -u ssh -n 30` 或 `/var/log/auth.log`
6. `ssh-keygen -y -f ~/.ssh/id_ed25519_work` —— 确认私钥本身是完整可用的
7. 本地私钥权限不是 600 → ssh 客户端**会拒绝使用**它，报 `UNPROTECTED PRIVATE KEY FILE`

**Q2：`Too many authentication failures`**

1. `ssh-add -l` —— agent 里塞了多少把钥匙
2. 加 `IdentitiesOnly yes` 到 `~/.ssh/config` 的 `Host` 块，或命令行 `-o IdentitiesOnly=yes`
3. 明确指定 `ssh -i ~/.ssh/id_ed25519_work user@host`
4. 多把密钥的场景是根因，清理 agent：`ssh-agent -k`

**Q3：服务端报 `bad ownership or modes`，但我的权限明明是 600**

1. **是属主不对，不是权限位不对。** 所有文件和 `~/.ssh` 目录的属主必须都是那个登录用户
2. `ls -ld ~ ~/.ssh` —— `~` 本身也不能是 group writable
3. 家目录路径上有别的用户能写 → sshd 的 `StrictModes` 会拒绝
4. 服务端日志里的完整理由是 `Authentication refused: bad ownership or modes`，比客户端提示详细

**Q4：公钥明明在 authorized_keys 里，服务端还是拒绝**

1. **先看是不是 CRLF。** 从 Windows 编辑器复制过去的公钥行尾带 `^M`，整行无法解析：

```bash
ssh-keygen -l -f ~/.ssh/authorized_keys
```

**有 `^M` 时输出里会出现奇怪字符或直接报错。** 修法：

```bash
sed -i 's/\r$//' ~/.ssh/authorized_keys
```

2. `ssh-keygen -l -f ~/.ssh/authorized_keys` —— **这一步能验证每一行是不是一个合法的公钥**，比肉眼可靠
3. 公钥内容要完整（一整行，中间不能被换行截断）
4. 确认推上去的是 `.pub` 文件，不是私钥

**Q5：能连上但每条命令都很慢？**

1. `ssh -v user@host` —— 看有没有在等 DNS 反查（`Connecting to ...` 之后卡住）
2. 服务端 `UseDNS no` 可以省掉这一步
3. 大量密钥互相尝试时也会慢 → 见 Q2
4. 反复执行同一条命令时，**连接复用（`ControlMaster` / `ControlPath` / `ControlPersist`）能把后续连接压到毫秒级**

**Q6：`Host key verification failed`，但我知道这台机器是对的**

1. `ssh-keygen -F host` —— 看记录里是哪台主机
2. `ssh-keygen -F host | ssh-keygen -lf -` —— 打印出当前记录的指纹
3. 和控制台/运维那边的指纹核对
4. 核对无误后 `ssh-keygen -R host` 删除，再重连
5. **跳过第 3 步直接 `-R` 就是把中间人攻击的防护关掉**

## 什么时候别用

- **不要给私钥设空口令。** `-N ''` 产生一个任何拿到文件的人都能直接用的密钥。**唯一合理的场景是无人值守的自动化**，而且那种情况该用专用的受限账号 + `authorized_keys` 里的 `from=` 限制来源。
- **不要把私钥放进版本库、同步盘、聊天工具或 issue 里。** 贴出来的私钥要当作已泄露，立刻换掉。
- **不要为了图省事 `StrictHostKeyChecking=no`。** 那等于关掉主机身份验证，中间人可以随意冒充服务器并拿到你所有的凭据。**需要免确认就只用 `accept-new`**（OpenSSH 7.6 起），它对没见过的机器记录、见过的仍然校验。
- **不要在不可信的跳板机上用 `ForwardAgent`。** 用 `ProxyJump`，让数据流不落在中间机器上。
- **不要用 root 直接登录再 `su` 切用户。** 用普通账号登录，需要提权时用 `sudo`。**跳过一次提权能少一次审计和少一个被入侵后的横向移动入口。**
- **不要给 `authorized_keys` 里的公钥开 `from=0.0.0.0/0`。** 要限制就写明确的网段，否则写了等于没写。
- **不要指望 agent 在自动化里可用。** systemd 服务、cron、CI 里 `SSH_AUTH_SOCK` 通常不存在，脚本需要的是另一套方案 → [计划任务的环境变量陷阱](/linux/internals/14-cron)。
- **不要用一把密钥配 20 个别名。** 出问题时你分不清是哪把。**按用途拆**，然后在 `~/.ssh/config` 里用 `IdentityFile` 明确指定。

## 哪些是通用的

| 这一章的判断 | Windows 上对应什么 |
| --- | --- |
| 「公钥推送到服务端，是单向的」 | 任何非对称认证模型 |
| 「主机身份要在第一次用别的渠道核对」 | 证书信任链、TLS 证书的 TOFU 确认 |
| 「指纹变了先核实再删记录」 | SSH、VPN、容器镜像的 digest 验证 |
| 「私钥权限错了工具会拒绝用」 | 任何私钥文件 |
| 「凭据要按用途拆开」 | 密码管理器里的独立条目 |
| 「跳板机不可信就不转发 agent」 | 代理链的隔离原则 |

**不通用的是这套文件路径和算法。** `~/.ssh/`、`authorized_keys`、`known_hosts` 是 OpenSSH 的约定，PuTTY 存在注册表里，Windows 10 之后的 OpenSSH 客户端才共用这套路径。**算法也在变**：今天新生成的密钥默认用 Ed25519，对接 2015 年前的老设备时还得留一把 RSA。**先 `ssh -V` 看版本，再决定用什么。**

**真正跨平台的原则只有一条：验证对方的身份，别只验证自己的。** 大部分「连接」类故障最后都栽在这一条上。

## 跑完之后

你能免密登录、能解释那个 `yes/no` 问的是什么、并且能在 `Permission denied (publickey)` 时按顺序查到根因。下一章是运维里另一件天天做但最容易出错的事：让一件事在指定时间自动发生。

→ [计划任务：crontab 的五个字段与环境变量陷阱](/linux/internals/14-cron)

## 📝 配套练习

<QuizBlock module-id="13-ssh-key" />
