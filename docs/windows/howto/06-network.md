---
title: 网络诊断：从通不通到端口开没开
description: ping / tracert / Test-NetConnection / ipconfig 组成的排查顺序。
---

# 网络诊断：从通不通到端口开没开

> 读完你会有一套固定的排查顺序，遇到「连不上」不用再东试一条西试一条，而且知道 `ping` 通了为什么服务还是连不上。这一章大约 30 分钟。

<ModuleMeta module-id="06-network" />

## 前置条件

**先看一眼这台机器自己的网络配置，后面每一步都基于它。**

```cmd
ipconfig /all
```

你应该看到：适配器名、IPv4 地址、子网掩码、默认网关、首选 DNS。

PowerShell 里取结构化的版本：

```powershell
Get-NetIPConfiguration | Select-Object InterfaceAlias, IPv4Address, IPv4DefaultGateway
```

你应该看到同样的信息，但是对象形式 —— 管道能直接筛和排序，这就是上一章说的对象管道。

**记下三个值：IPv4 地址、默认网关、首选 DNS。** 后面每一步排查都要回来对照它们。

判断当前配置是否正常，看这三类异常地址：

| 你看到的地址 | 含义 | 是不是问题 |
| --- | --- | --- |
| `169.254.x.x` | APIPA，DHCP 没发到地址 | ⚠️ 网线/交换机或 DHCP 服务器的问题 |
| `127.0.0.1` | 本机回环 | 配置错了，网卡没拿到地址 |
| 网段外的地址但看着合理 | 可能是正常的多网卡 | 看掩码和网关对照 |
| 掩码不是 `/24`（不是 `255.255.255.0`） | 分了子网 | 正常，但排查时要按这个掩码算同网段 |

## 1. 先定顺序，别跳步

**网络问题按层排查，每层用一类命令。跳步的直接后果是拿 `ping` 的结果去判断应用层的问题。**

| 层 | 问的问题 | 用什么 |
| --- | --- | --- |
| 本机配置 | 网卡有地址吗、路由对吗 | `ipconfig` / `Get-NetIPConfiguration` |
| 解析 | 名字能变成 IP 吗 | `nslookup` / `Resolve-DnsName` |
| 路由 | 包能到对方机器吗 | `ping` / `Test-Connection` |
| 路径 | 卡在哪一跳 | `tracert` / `Test-NetConnection -TraceRoute` |
| 传输 | **那个端口开吗** | `Test-NetConnection -Port` / `netstat` |
| 应用 | 协议层握手成功吗 | `curl.exe` / `Invoke-WebRequest` |
| 策略 | 是不是被防火墙挡了 | `netsh advfirewall` / `Get-NetFirewallRule` |

**从本机配置往上一层层走。** 本机配置都不对的时候，后面全部无意义。

## 2. 解析：`ping` 了名字先确认它变成了什么

**`ping example.com` 输出的第一行会显示它解析到的 IP。** 看到 IP 才知道后面拿什么去测。

```cmd
nslookup example.com
```

你应该看到 `Server`（用的哪个 DNS）和 `Address`（解析结果）。

PowerShell 里更完整：

```powershell
Resolve-DnsName example.com
Get-DnsClientServerAddress -AddressFamily IPv4
```

::: danger `nslookup` 和 `ping` 用的是两套解析路径
`ping` 查的是**本机 DNS 客户端缓存**，`nslookup` 查的是**直接向 DNS 服务器发查询**。

所以会出现：修改 DNS 服务器后，`nslookup` 返回新 IP（对的），但 `ping` 还是解析到旧 IP —— 因为缓存里还是旧的。这种时候：

```cmd
ipconfig /flushdns
```

你应该看不到任何输出（成功就是静默）。然后重试 `ping`。**「DNS 改了不生效」十次里有八次是没 flush。**
:::

看缓存里到底是什么：

```cmd
ipconfig /displaydns | findstr /i example.com
```

## 3. 连通性：`ping` 通不等于能用

**`ping` 测的是 ICMP，端口通不通是另一件事。这两件事必须分开测。**

```cmd
ping -n 4 example.com
```

你应该看到 4 行回复和统计信息。

::: warning Windows 的 `ping` 用 `-n`，Linux 用 `-c`
`ping -c 4 example.com` 在 Windows 上会报「参数无效」。**这是从 Linux 迁过来第一个必踩的坑。** Windows 上 `-n` 是次数，Linux 上 `-n` 是数字输出的宽度。

另外 `ping` 默认跑 4 次就停，不会像 Linux 那样一直跑 —— 这在排查「时好时坏」时是个问题，需要更多样本就加次数：

```cmd
ping -n 20 192.168.1.1
```

只看部分回显：

```cmd
ping -n 4 -w 1000 example.com
```

`-w` 是单次超时（毫秒），默认 4000。排查丢包时把它调小，20 次 1 秒超时的测试 20 秒内跑完，比默认的 80 秒快得多。
:::

PowerShell 的等价物返回**对象**而不是文本：

```powershell
Test-Connection example.com -Count 4
Test-Connection example.com -Count 4 -Quiet
```

你应该看到 `PingSucceeded`、`ResponseTime` 等属性。`-Quiet` 只返回布尔值，适合写进条件判断。

::: tip 什么时候可以跳过 `ping`
- 对方明确禁 ICMP —— 云主机、部分企业网关、企业防火墙都默认禁
- 目标不是主机而是**端口**（比如数据库、SSH）—— ICMP 结果跟它毫无关系

这两种情况下 `ping` 不通是**正常且不提供信息**的，直接跳到端口测试。
:::

强制用某个协议版本：

```cmd
ping -4 example.com
ping -6 example.com
```

`ping -6` 在本机没有 IPv6 路由时报「Ping 请求找不到主机」。IPv6 地址还带区域标识（`fe80::1%12`），数字是网卡序号，跨机器配置防火墙时要留意。

## 4. 路径：`tracert` 每一跳都等

```cmd
tracert -d -w 1000 example.com
```

你应该看到一串 IP 和三次测量的毫秒数。

`-d` 是关掉反向 DNS 查询，`-w` 是每次等待毫秒数。**不带 `-d` 的话每一跳都要反查主机名，几十跳的网络能等好几分钟** —— 排查时先加 `-d`。

::: warning `tracert` 慢和卡住是正常的，不是网络有问题
它对每一跳发三个探测包，**不回 ICMP 的中间设备要等超时**才跳到下一跳。一条 20 跳的路径遇到 5 个不回 ICMP 的设备，就是 5 个超时。所以中间几行的 `*` 经常是正常现象。

有意义的信号是：**在第几跳开始整体停住**。第 8 跳之后全是 `*` 就说明包到第 8 跳之后没回包，但不能直接断定是第 8 跳的锅 —— 终点不回 ICMP 也是这样。
:::

看每一跳的 RTT，找抖动大的节点：

```cmd
tracert -h 20 -w 500 example.com
```

`-h` 限制最大跳数（默认 30）。`Test-NetConnection` 自带一个：

```powershell
Test-NetConnection example.com -TraceRoute
```

## 5. 端口：这一层才回答「服务通不通」

**目标端口能不能建立 TCP 连接，一条命令给答案。**

```cmd
powershell -c "Test-NetConnection example.com -Port 443"
```

你应该看到这样的输出：

```text
ComputerName     : example.com
RemoteAddress    : 93.184.216.34
RemotePort       : 443
TcpTestSucceeded : True
```

看 `TcpTestSucceeded`。**只有这一行是结论**，上面几行是上下文。

| 意图 | CMD | PowerShell | 是否改动数据 |
| --- | --- | --- | --- |
| 测端口通不通 | 无内置，用 `powershell -c` 或 `curl.exe` | `Test-NetConnection -Port N` | 否（发几个包） |
| 看详细信息 | 同上 | `Test-NetConnection -Port N -InformationLevel Detailed` | 否 |
| 本机在监听什么 | `netstat -ano` | `Get-NetTCPConnection -State Listen` | 否 |
| 谁占着这个端口 | `netstat -ano \| findstr :443` | `Get-NetTCPConnection -LocalPort 443 \|`<br>`Select-Object OwningProcess` | 否 |

::: tip 端口被占时的标准三连
```cmd
netstat -ano | findstr :8080
tasklist /fi "PID eq 12345"
```

你应该先看到一个末列是 PID 的监听行，再看到那个 PID 对应的进程名。**三行命令就能回答「谁占了这个端口」**，这比打开图形工具点半天快。
:::

PowerShell 一条命令版本：

```powershell
Get-NetTCPConnection -LocalPort 8080 -ErrorAction SilentlyContinue |
  Select-Object LocalAddress, State, OwningProcess,
    @{n='Process';e={(Get-Process -Id $_.OwningProcess).ProcessName}}
```

你应该直接看到端口、状态和进程名。`OwningProcess` 那一列就是 `netstat -ano` 的 `-o`。

### `Test-NetConnection` 不告诉你失败原因

`TcpTestSucceeded : False` 有五种可能，这条命令**不区分**：

| 可能原因 | 怎么排除 |
| --- | --- |
| 目标没在监听 | 从服务端本机查 `Get-NetTCPConnection -State Listen` |
| 中间设备拦了 | 换网络环境（比如手机热点）再试 |
| 防火墙 | 见下一节 |
| 端口号写错 | 跟服务端配置核对 |
| 路由不通 | 先 `ping` 或 `tracert` 看这一跳 |

::: danger `curl` 在 PowerShell 里不是 curl
**Windows PowerShell 5.1 里 `curl` 是 `Invoke-WebRequest` 的别名**，不是那个真的命令行 curl。后果很直接：

- `curl -d "a=1" url`（真 curl 是 POST 数据）→ 报参数错误
- `curl -o out.html url`（真 curl 是输出文件）→ 报参数错误
- 它的「成功」是 HTTP 200 就算成功，跟真 curl 的语义也不一致

**PowerShell 5.1 里要写真 curl 必须写全名 `curl.exe`。** 想要 PowerShell 原生的就写 `Invoke-WebRequest` / `Invoke-RestMethod`，别混用。

```cmd
curl.exe -s -o NUL -w "%%{http_code}" https://example.com
```

```powershell
(Invoke-WebRequest https://example.com -UseBasicParsing).StatusCode
```

两边都应该返回 `200`。PowerShell 5.1 里 `Invoke-WebRequest` 需要 `-UseBasicParsing` 才有 `.StatusCode`，因为默认用 IE 的解析引擎。

`Invoke-RestMethod` 更省事：它直接把 JSON 响应解析成对象返回，不用再 `ConvertFrom-Json`。

## 6. 防火墙：确认是不是它挡的

```cmd
netsh advfirewall show allprofiles
```

你应该看到三个配置文件（域 / 专用 / 公用）的状态，入站默认规则是「阻止」。

**Windows 防火墙有三个独立的配置文件，同一台机器在「域」和「公用」下的行为可能完全相反。** 判断某条规则在不在你当前所处的配置文件里生效，要看 `Profile` 那一列。

PowerShell：

```powershell
Get-NetFirewallProfile | Select-Object Name, Enabled, DefaultInboundAction
Get-NetFirewallRule -Direction Inbound -Enabled True -Action Block |
  Select-Object -First 5 DisplayName, Profile
```

加规则（需要管理员）：

```cmd
netsh advfirewall firewall add rule name="MyApp 8080" dir=in action=allow protocol=TCP localport=8080
```

**改防火墙前先 `netsh advfirewall export 备份名.wfw` 导出**，恢复用 `netsh advfirewall import`。理由和注册表、服务配置一样：这是「会一直保持」的改动，导出一次比事后回忆稳妥。

::: tip 最快的排除法
**临时关掉防火墙再测一次**。如果关掉就通，问题一定在防火墙，恢复防火墙并加精确规则 —— 不要让它保持关闭状态。

```cmd
netsh advfirewall set allprofiles state off
netsh advfirewall set allprofiles state on
```

这是排查手段，不是解法。防火墙保持关闭的机器等于对整个网络裸奔。
:::

## 排障

**Q1：能 ping 通，但应用连不上？**

按这个顺序查，不要跳步：

1. `Test-NetConnection 目标 -Port 端口` —— 用对的那个端口测，ping 的结论不算数
2. 在**服务端机器**上 `netstat -ano | findstr 端口` —— 确认它真的在监听
3. 看监听地址是 `127.0.0.1` 还是 `0.0.0.0` —— 只监听回环的进程外部永远连不上
4. 客户端和服务端都 `netsh advfirewall show allprofiles` —— 确认所属配置文件
5. 换网络环境（手机热点）再测一次 —— 区分中间设备和本机

::: warning 「监听 127.0.0.1」是应用连不上的头号原因
服务启动时绑到了回环地址，意思是**只有本机能连**。本机测试一切正常，别的机器一律连接被拒。改配置让服务绑 `0.0.0.0` 或具体网卡地址。这类问题在开发环境极难发现，因为开发机上永远是本机访问。
:::

**Q2：改了 DNS 之后还是老 IP？**

1. `ipconfig /displaydns | findstr 域名` —— 看缓存里的旧记录
2. `ipconfig /flushdns` —— 清缓存
3. `nslookup 域名` —— 确认 DNS 服务器本身返回的是新 IP
4. `netsh interface ip show dns` —— 确认这台机器实际配的是哪个 DNS

**Q3：`Test-NetConnection` 一直卡着不动？**

1. `Test-NetConnection 目标 -InformationLevel Detailed` —— 慢的时候会显示已经测了哪些步骤
2. 加 `-WarningAction SilentlyContinue`
3. 目标名解析慢就先用 IP 直接测，排除 DNS 干扰

**Q4：`ping` 时好时坏？**

1. `ping -n 50 网关IP` —— 50 次采样，丢包率才有统计意义
2. `ping -n 50 -w 500 目标` —— 缩短超时让测试跑得完
3. 网关有丢包先查网线/交换机，别急着怀疑应用
4. `tracert -d -w 500 目标` —— 找第一个开始丢包的跳数

**Q5：DNS 解析时好时坏？**

1. `Resolve-DnsName 域名 -Server 8.8.8.8` —— 指定一个已知正常的 DNS 对比
2. 两个 DNS 都测一遍，判断是域名本身的问题还是本地 DNS
3. `ipconfig /displaydns` 看有没有半截缓存记录
4. 换 IP 直接访问验证是不是 DNS 单独的问题

## 什么时候别用

**「ping 得通」和「ping 得快」都不是服务可用性的证据。**

| 别用 | 换成 | 原因 |
| --- | --- | --- |
| 用 `ping` 判断 Web 服务可用 | `Test-NetConnection -Port 80` 或 `curl.exe` | ICMP 通不代表端口开 |
| 用 `tracert` 判断网络质量 | 多点多次采样 + 应用层测速 | 每一跳的超时不代表丢包 |
| 靠 `ping` 判定主机在线 | 应用层探测 | 很多设备禁 ICMP |
| 长期关闭防火墙 | 精确规则 | 见第 6 节 |
| 在公网暴露管理端口 | VPN / 堡垒机 | 端口开放 = 攻击面 |

::: warning `tracert` 的结果不能用来定位责任方
中间路由器转发时经常降低 TTL，这是**设计行为**。所以「第 N 跳超时」只说明包走到了那里附近，不说明那台设备有问题。共享路径上的某一跳可能是运营商、可能是云厂商，也可能是你的网关 —— 单靠 `tracert` 分不出来，要结合反向 `tracert` 和应用层延迟测量。
:::

**`Test-NetConnection` 会向目标发真实的 TCP 连接。** 在生产环境里拿它做定时探测，等于持续扫描你自己的服务，确认探测频率不会触发对方的限流或告警。

## 哪些是通用的

**「按层从下往上排查」这个方法换平台完全一样。**

| 这里学的 | Linux 上对应 |
| --- | --- |
| 本机配置 | `ip a` / `ifconfig` |
| 看路由表 | `route print` / `ip route` |
| 连通性 | `ping -c 4` ⚠️ 参数不同 |
| 路径 | `traceroute` ⚠️ 协议不同 |
| 测端口 | `nc -zv 目标 端口` / `curl` |
| 解析 | `nslookup` / `dig` |
| 清 DNS 缓存 | `resolvectl flush-caches`（systemd-resolved） |
| 防火墙 | `ufw status` / `iptables -L` / `firewall-cmd` |
| DHCP 重新获取 | `ipconfig /release` `/renew` |

**明确不通用的部分：**

- **`ping` 的参数**。Windows `-n` 是次数，Linux `-c` 是次数；Windows `-w` 是超时毫秒，Linux `-w` 是等待秒数。同一个字母在两边意思不同
- **路径探测协议**。Windows 的 `tracert` 用 ICMP，Unix 的 `traceroute` 默认用 UDP。两者中途显示的跳数**不对应**
- **traceroute 的 `-n` 正好相反**。Linux 的 `traceroute -n` 是不做 DNS 反查（对应 Windows `tracert -d`）
- **HTTP 客户端**。Windows 有内建 `curl.exe`，Linux 上 `curl` 通常要装；PowerShell 的 `Invoke-WebRequest` 在 Linux 的 `pwsh` 里也有，但行为和 Windows 版有差异
- **防火墙模型**。Windows 是三个配置文件加规则列表，Linux 侧常见的是 `ufw`、`firewalld`、裸 `iptables`/`nftables` 三种不同抽象

## 跑完之后

下一章讲**文本处理**：`findstr` 和 `Select-String` 各自怎么写，以及那个「文件里明明有这行，搜却搜不到」的编码问题。

→ [文本处理：Findstr 与 Select-String](/windows/howto/07-text-processing)

## 📝 配套练习

<QuizBlock module-id="06-network" />
