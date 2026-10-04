---
title: 网络：机器通不通、端口开没开、配置对不对
description: ping / curl / ss / dig 分工，DNS 解析失败时先查哪一样。
---

# 网络：机器通不通、端口开没开、配置对不对

> 读完你能按「网卡 → 路由 → 解析 → 端口 → 应用」的顺序把一次连不上一层层缩小到具体一层，而不是靠反复 ping 猜。约 28 分钟。

<ModuleMeta module-id="06-network" />

## 前置条件

```bash
command -v ip ss curl ping
```

**四个命令各管一层，缺一个都会让排查断在半路。** `ss` 来自 `iproute2`，`dig` 属于 `bind9-dnsutils`（Debian/Ubuntu）或 `bind-utils`（RHEL 系），最小化安装里常常都没有：

```bash
command -v dig || echo "dig 未安装"
```

**没装 dig 不影响排查**，第 2 节给了 `getent` 替代方案，而且它测的其实才是程序真正走的解析路径。

看自己的网卡：

```bash
ip -br addr
```

你应该看到 `lo` 和至少一块有真实 IP 的网卡。**只有 `lo`（`127.0.0.1`）说明没连上网络，后面所有测试的结果都不可信，先解决这层。**

## 1. 四个工具分属四层，不要错用

| 工具 | 测的是哪一层 | 回答什么问题 | 是否改动数据 |
| --- | --- | --- | --- |
| `ip addr` / `ip route` | 链路 / 网络 | 本机有没有 IP、该走哪条路 | 只读 |
| `ping` | 网络（含 ICMP） | 主机可达吗 | 只读（发包） |
| `dig` / `getent` | DNS 解析 | 名字能变成 IP 吗 | 只读 |
| `ss` | 传输 | 本机这个端口在监听吗 | 只读 |
| `curl` | 应用 | 服务真的响应吗 | 只读（但会改变服务端状态，如触发写操作） |

**判断句：ping 通只能证明网络层通，不证明服务活着；ping 不通也不证明服务死了。**

::: warning

ping 不通先别急着换网线
大量生产环境的安全组和防火墙**默认丢弃 ICMP**，只放行业务端口。这种机器 ping 必然不通，但业务访问完全正常。**判断「通不通」优先用 TCP 层测试**：

```bash
curl -sS -o /dev/null -w '%{http_code}\n' -m 5 http://目标地址/
```

**你应该看到 `200` 或 `3xx`；看到 `000` 才是连不上。**
:::

## 2. 名字解析：dig 和 getent 测的不是同一件事

```bash
getent hosts example.com
dig +short example.com
```

| 现象 | 含义 |
| --- | --- |
| 两个都有输出 | 正常 |
| `dig` 有、`getent` 没有 | **问题不在 DNS，在本机的解析顺序**（`/etc/hosts`、`nsswitch.conf`），或者程序在容器/不同网络命名空间里 |
| 两个都没有 | 解析器或上游确实有问题 |
| `dig` 返回多个 A 记录 | 正常，程序会挨个试 |

**判断句：程序说「找不到主机」时，以 `getent hosts` 的结果为准**，因为程序走的是 NSS（`/etc/nsswitch.conf` 里定义的那条链），不是 `dig` 那条路。`dig` 成功而 `getent` 失败是真实存在的故障，不矛盾。

看解析链的顺序：

```bash
grep '^hosts' /etc/nsswitch.conf
```

**你应该看到类似 `hosts: files dns`**，含义是**先查 `/etc/hosts`，再走 DNS**。所以：

::: tip

`/etc/hosts` 永远赢过 DNS
`/etc/hosts` 里的一行记录会让程序用你写的 IP，**即使 DNS 返回完全不同的地址**。联调时把自己加进去是最快的办法，但这条记录会静默劫持所有解析。**排查「为什么程序连到了旧服务器」时，第一件事就是 `cat /etc/hosts`。**
:::

### systemd-resolved 系统的额外一层

```bash
cat /etc/resolv.conf
```

**在用了 systemd-resolved 的机器上，你会看到 `nameserver 127.0.0.53` —— 这不是真的 DNS 服务器，是一个本机转发器。** 它有自己的缓存和 per-link 配置：

```bash
resolvectl status
```

**判断句：`resolv.conf` 里是 `127.0.0.53` 时，「改 `/etc/hosts`」和「改上游 DNS」是两件事**，前者是 NSS 层，后者要动 `resolvectl dns <网卡>`。很多「我明明改了 DNS 为什么没用」就是改错了文件。

::: warning

`ndots` 会让短名字先走搜索域
`/etc/resolv.conf` 里常见 `options ndots:5` 之类。它的含义是：名字里的点少于 ndots 时，**先把它加上每个搜索域去查**，全失败才按绝对名字查。在公司内网用 `db01` 这种短名时，你会看到解析请求发到一串 `db01.xxx.corp` 上 —— 不是故障，是设计如此。查内网服务要写全 FQDN。
:::

## 3. 端口有没有在监听

```bash
ss -tlnp
```

| 字段 | 含义 |
| --- | --- |
| `t` / `u` | TCP / UDP |
| `l` | 只看 LISTEN 状态 |
| `n` | 显示数字，不做名字反查（**排障时一定加上**，否则会卡在 DNS 反查上） |
| `p` | 显示占用进程，**看别人的进程需要 sudo** |

**你应该看到类似这样的行：**

```text
LISTEN 0  128  0.0.0.0:22    0.0.0.0:*    users:(("sshd",pid=812,fd=3))
```

**判断句：`Local Address` 是 `127.0.0.1:8080` 就只有本机能连；`0.0.0.0:8080` 才是对外监听。** 这一点解释了大量「curl localhost 通、换 IP 就不通」的情况。

快速筛一个端口：

```bash
ss -tlnp 'sport = :8080'
```

`lsof` 是替代方案，容器里常常没装：

```bash
sudo lsof -i :8080
```

### 监听不代表能连上

```bash
nc -vz 127.0.0.1 8080
```

**你应该看到 `succeeded` 或 `open`。** `nc` 不存在时用 `curl`，或用 bash 自身的重定向：

```bash
timeout 3 bash -c 'cat < /dev/null > /dev/tcp/127.0.0.1/8080' && echo open || echo closed
```

::: warning

端口被占、或者防火墙挡了，`ss` 都看不出来
`ss` 只看**本机**的 socket 表。以下三种情况它都会显示「正常在监听」，但外面连不上：

1. 主机防火墙规则 —— `sudo nft list ruleset`（旧系统 `sudo iptables -S`）看有没有 DROP
2. 上游云安全组 / 网络 ACL —— 机器内完全查不到，只能去云控制台或联系网络组
3. Docker 改了宿主机转发规则 —— 用 Docker 时 8080 可能被映射走了，详见 [Docker 容器起不来的排查顺序](/linux/internals/12-docker)

**判断句：`ss` 说在监听而外部连不上，问题在 ss 看不到的地方。** 别在 `ss` 上反复重试。
:::

::: danger

不要为了「让连上」去清空防火墙规则
`iptables -F` 和 `nft delete ruleset` 会把**整台机器**的规则清空，包括你用来远程进来的那条规则。**如果你是通过 SSH 操作的，清规则那一瞬间你就断线了，而且回不去。** 正确做法是**追加一条允许规则**而不是清空：

```bash
sudo iptables -I INPUT 1 -p tcp --dport 5432 -j ACCEPT
```

`-I` 是插入到第 1 条（立即生效），`-A` 是追加到末尾（可能排在 DROP 后面，等于没加）。
:::

## 4. 用 curl 确认服务真的响应

```bash
curl -sS -o /dev/null -w '%{http_code} %{time_total}\n' -m 5 https://example.com/
```

**你应该看到 `200 0.184`。** 三个数字：状态码、总耗时（秒）。

| 选项 | 作用 | 是否改动数据 |
| --- | --- | --- |
| `-sS` | 静默但保留错误输出 | 只读 |
| `-o /dev/null` | 丢弃响应体 | 只读 |
| `-w '格式'` | 按模板输出指标 | 只读 |
| `-m 5` | **5 秒超时** | 只读 |
| `-I` | 发 HEAD 请求 | 只读，但部分服务不实现 HEAD，会返回 405 |
| `-v` | 打印完整握手过程 | 只读，**排障主力** |
| `--resolve 域名:端口:IP` | 指定这一次请求的解析结果 | 只读 |
| `-k` | 跳过证书校验 | ⚠️ 见下 |

::: warning

curl 不加超时可能挂几分钟
`curl` 默认**没有整体超时**，连接建立后一直不返回时会长期占用你的终端。**任何脚本里写 curl 都要带 `-m`。**
:::

`-v` 是最有用的一条。**你应该看到这几行（按顺序）：**

```text
* Connected to example.com (93.184.x.x) port 443
*   Trying 93.184.x.x...
* ALPN: server accepted h2
> GET / HTTP/2
< HTTP/2 200
```

**判断句：从上往下读 `*` 开头的行，第一条 `Connected to` 就失败 → 网络或防火墙问题；连上了但卡在 `Trying` → 包被丢；连上了但证书报错 → TLS 问题。**

::: warning

`-k` 只是让报错消失，不是让问题消失
`curl -k` 跳过证书校验。**如果去掉 `-k` 才报证书错误，那一定有个真问题**：域名不匹配、证书过期、或者中间人。`-k` 适合本地自签名临时调试，不适合用来判断「生产环境证书是否正常」。
:::

### 怀疑 DNS 有问题时，直接指定 IP 测试

```bash
curl --resolve example.com:443:93.184.x.x -sS -o /dev/null -w '%{http_code}\n' -m 5 https://example.com/
```

**判断句：这条通了但普通请求不通 → DNS 的问题，不是网络或服务的问题。** 这个写法不修改任何本地文件，也不污染 `known_hosts`。

## 排障

**Q1：一个域名连不上，固定按这个顺序查**

1. `ip -br addr` —— 本机有 IP 吗？只有 `lo` 就到此为止
2. `ip route get 目标IP` —— 内核会走哪条路？输出里的 `dev` 和 `src` 是不是你要的网卡
3. `ping -c 4 网关IP` —— 网关通吗？不通就是链路或路由问题，跟 DNS 无关
4. `getent hosts 域名` —— 名字能解析吗？不能就停在解析层
5. `ss -tlnp` —— 服务在监听吗？监听地址是 `127.0.0.1` 吗？
6. `nc -vz 目标IP 端口` —— 纯 TCP 能不能连上
7. `curl -v -m 5 完整URL` —— 应用层说了什么

**Q2：`curl` 报 `Connection refused` 和 `Connection timed out`，区别很大**

| 报错 | 含义 | 查什么 |
| --- | --- | --- |
| `Connection refused` | 包到了，**对方明确拒绝** | 端口没在监听、或者被 REJECT 规则命中 → `ss -tlnp` |
| `Operation timed out` | 包发出去了，**没有任何回包** | 防火墙 DROP、安全组、路由不通 |
| `Could not resolve host` | 名字都没变成 IP | DNS 层 → 第 2 节 |
| `SSL certificate problem` | 连上了，TLS 失败 | 证书过期 / 域名不匹配 / 系统时间错 |

**Q3：`ping` 通但 SSH 连不上？**

1. `ss -tlnp | grep ':22'` —— sshd 真的在监听 `0.0.0.0:22` 吗
2. `sudo sshd -T | grep -E '^(port|listenaddress|passwordauthentication)'` —— 看 sshd **实际生效**的配置（不是配置文件里写的）
3. `journalctl -u ssh -n 30` —— 认证失败记录在这里
4. `sudo nft list ruleset | grep -i ssh` —— 防火墙有没有挡

**Q4：容器里能 ping 通外面，但容器外访问不了容器的服务？**

1. `docker port <容器>` —— 端口有没有发布出来
2. `sudo iptables -t nat -L DOCKER -n` —— Docker 的转发规则
3. 容器内服务是不是只监听了 `127.0.0.1` —— **容器里的 `127.0.0.1` 只有它自己**，必须监听 `0.0.0.0`
4. → [Docker 容器起不来的排查顺序](/linux/internals/12-docker)

**Q5：`getent hosts` 很慢 / 返回一堆奇怪的地址？**

1. `grep '^hosts' /etc/nsswitch.conf` —— 解析链里是否有慢的模块（比如 `sss`、LDAP）
2. `cat /etc/resolv.conf` —— 搜索域和 `ndots` 是否导致一串无效查询
3. `resolvectl flush-caches` —— 缓存了坏结果时清一次

## 什么时候别用

- **不要用 `ping` 判断服务可用性。** 它测的是 ICMP，和业务端口无关。判断服务用 `curl -m 5 -o /dev/null -w '%{http_code}\n'`。
- **不要用 `telnet` 测端口。** 它在多数发行版里没预装，而且它是明文协议，测 HTTPS 端口会直接报错误导你。用 `nc -vz` 或 `curl`。
- **不要为了「能 ping 通」去在防火墙上放行所有 ICMP 并对外开放。** 企业环境里 ping 不通是常态，为了排障方便放宽规则，事后没人收回，等于开了一个长期的口子。**排障用 TCP 层测试替代。**
- **`traceroute` / `mtr` 的结果不要当证据。** 中间节点不回 ICMP 是普遍现象，某一跳显示 `*` 什么都不代表。判断用 `mtr --report` 多次采样，或者干脆只看终点。
- **不要在没有基线的情况下解读 `ss` 里的连接数。** `ss -s` 显示的几万个 ESTAB 到底正常不正常，只有和你自己的历史基线比才知道。运维前先留一份快照。
- **`dig` 只在 Linux 上是标准工具。** macOS 自带，Windows 要装，或者改用 [Windows 网络诊断](/windows/howto/06-network) 里的 `Resolve-DnsName`。

## 哪些是通用的

| 这一章的判断 | Windows 上对应什么 |
| --- | --- |
| 「本机有没有 IP」 | `ipconfig` / `Get-NetIPAddress` |
| 「该走哪条路」 | `route print` / `Find-NetRoute` |
| 「名字能不能变 IP」 | `Resolve-DnsName` / `nslookup` |
| 「端口在不在监听」 | `netstat -ano` / `Get-NetTCPConnection` |
| 「服务真的响应吗」 | `Test-NetConnection`、`Invoke-WebRequest` |
| 分层逐个排除 | 完全一样 |

**不通用的是工具名字和默认参数。** 同一个「ping 4 次」，Linux 是 `ping -c 4`，Windows 是 `ping -n 4`；Linux 的 `ss -tlnp` 在 Windows 上完全没有对应物，需要换成 `Get-NetTCPConnection`。**移植的是「先查哪一层」的顺序，不是命令本身。**

## 跑完之后

你能把一次「连不上」定位到具体一层，并且知道 DNS 解析失败时先看哪两样。下一章处理连上之后的事：怎么从一堆文本里找出你要的那几行。

→ [文本三件套：grep / sed / awk 各自负责哪一段](/linux/howto/07-text)

## 📝 配套练习

<QuizBlock module-id="06-network" />
