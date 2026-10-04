---
title: WinRM 与远程会话
description: PSSession 怎么建立的，凭据与跳板机分别怎么配。
---

# WinRM 与远程会话

> 读完你会在两台 Windows 之间开一个远程 PowerShell，并且知道工作组里为什么默认连不上、跳板机该怎么配。这一章大约 30 分钟。

<ModuleMeta module-id="11-remote" />

::: danger 改 WinRM 配置之前，先确认你还连得上
`Enable-PSRemoting` 和 `winrm quickconfig` 会**同时修改服务启动类型、防火墙规则和监听器**。配错了的表现是远程连不上；如果这台机器你只有远程这一条路，那你就把自己锁在外面了。

**动手之前确认：**

1. 你现在有本地控制台、或者物理/虚拟机控制台，或者另一条已知能用的远程通道（另一台跳板机）
2. 你知道这台机器的管理员密码 —— 有些 WinRM 配置错误会导致连本机的 `localhost` 也失败，只能靠本地改回来

**机器已经被锁在外面时的恢复办法是：用控制台本机执行 `winrm reset`。** 这条命令是留给「配置改坏了」的，所以要有控制台。
:::

## 前置条件

**先看 WinRM 服务和监听器的现状，不要直接开。**

```powershell
Get-Service WinRM
winrm enumerate winrm/config/listener
```

你应该看到 `WinRM` 服务状态，以及至多一条 HTTP 监听器（如果已经配过的话）。

```powershell
$PSVersionTable.PSVersion.ToString()
```

`5.1` 和 `7` 都能用 WinRM，但功能有差别，第 5 节的 SSH 传输只有 `7` 有。

**默认端口记下来：**

| 用途 | 端口 | 协议 |
| --- | --- | --- |
| WinRM over HTTP | 5985 | WSMan over HTTP |
| WinRM over HTTPS | 5986 | WSMan over HTTPS |

**5985 走的是明文**（密码由 Kerberos 或 NTLM 加密，不是明文，但流量本身没有 TLS 保护）。跨不可信网络必须用 5986。

## 1. 打开远程：先备份，再开启

```powershell
# 备份当前监听器和配置
winrm enumerate winrm/config > C:\Temp\winrm-config-before.txt
winrm enumerate winrm/config/listener > C:\Temp\winrm-listener-before.txt
```

你应该得到两个文本文件。**它们是出问题后唯一的还原依据。**

```powershell
Enable-PSRemoting -Force
```

你应该看到几条进度输出，最后是配置成功的提示。

它做了四件事：

| 动作 | 结果 |
| --- | --- |
| 启动 WinRM 服务 | `WinRM` 变 `Running` |
| 改服务启动类型 | 开机自动 |
| 建防火墙规则 | 放行 5985 入站 |
| 注册会话配置 | 客户端能连了 |

等价的 CMD 侧命令：

```cmd
winrm quickconfig -quiet -force
```

::: warning `Enable-PSRemoting` 在域环境里可能被组策略挡住
企业域里的机器上，WinRM 的服务启动类型和防火墙规则常常由组策略统一管理。手工执行 `Enable-PSRemoting` **会被组策略在下次刷新时刷回去**，表现为「刚配好能用，过一天连不上了」。

判断是不是这种情况：

```powershell
Get-Item WSMan:\localhost\Service\Auth\Basic | Select-Object Name, Value
gpresult /r
```

真要长期配置，走组策略下发，不要靠命令行。
:::

::: tip 32 位客户端需要额外的会话配置
在 64 位系统上，**32 位的 PowerShell 客户端默认可能连不上**，因为它需要的会话配置名叫 `Microsoft.PowerShell32`，而这个名字不是每次都会自动建。

先看有没有：

```powershell
Get-PSSessionConfiguration | Select-Object Name
```

**没有 `Microsoft.PowerShell32` 的话，64 位客户端能用、32 位客户端报「找不到会话配置」—— 而且报错信息不会告诉你这个区别。** `TODO：待补充` —— 具体要不要手动注册，取决于系统版本和 PowerShell 版本，在目标机器上用上面这条命令实测一次比查文档可靠。
:::

## 2. 建会话：三种方式

| 方式 | 命令 | 用在哪 |
| --- | --- | --- |
| 交互式进去 | `Enter-PSSession -ComputerName server` | 手动排查 |
| 跑一条拿结果 | `Invoke-Command -ComputerName server -ScriptBlock { }` | 一次性查询 |
| 建对象反复用 | `New-PSSession` + `Invoke-Command -Session` | 多次操作或交互式 |

```powershell
Invoke-Command -ComputerName dc01 -ScriptBlock { hostname; (Get-Date) }
```

你应该拿到远端的主机名和时间。

```powershell
Enter-PSSession -ComputerName dc01
```

提示符从 `PS C:\Users\...>` 变成 `PS dc01\CUsers\...>`。**`exit` 或 `Ctrl+Z` 退出。** 确认你真的在远端：

```powershell
$env:COMPUTERNAME
```

应该返回远端机器名。

::: danger `PSSession` 对象活不过当前 PowerShell 进程
```powershell
$s = New-PSSession -ComputerName dc01
```

**关掉这个窗口，`$s` 就没有了。** 重新开窗口后 `$s` 是未定义变量，远端的那个会话在超时后被清理。

所以任何需要复用的会话，都要在**同一个 PowerShell 进程里**完成创建和使用。跨脚本用的话，把整个流程写在一个 `.ps1` 里跑。

需要真正跨会话保存的，用断连重连：

```powershell
$s | Disconnect-PSSession
# 之后的窗口里
$s2 = Connect-PSSession -Session $s2
```

**重连的对象还是原来那个**，不新建会话 —— 断连期间远端的进程也还活着。用完记得 `Remove-PSSession` 释放。
:::

::: warning 交互式会话和 `Invoke-Command` 的默认身份不同
`Invoke-Command` 在远程创建一个**临时的、非交互的**会话，很多依赖用户登录态的东西在里面拿不到：用户证书、用户级证书存储、`HKEY_CURRENT_USER` 里的东西、`Desktop` 目录（那个路径不存在于服务上下文）。

排查必须交互式时用 `Enter-PSSession`。判断依据：**你需要的是「像登录用户那样」还是「像系统那样」。** 大多数远程运维任务要的是后者，交互式反而更麻烦。
:::

## 3. 凭据

```powershell
Enter-PSSession -ComputerName dc01 -Credential (Get-Credential)
```

你应该看到一个凭据对话框，填 `DOMAIN\用户名` 和密码。

::: danger 密码写在命令行等于写进命令历史
```powershell
# 不要这样
Enter-PSSession -ComputerName dc01 -Credential (New-Object PSCredential('max', (ConvertTo-SecureString '明文密码' -AsPlainText -Force)))
```

这条会把明文密码留在 PowerShell 的历史文件里。**历史文件是明文可读的，别的用户或以后读到你历史的人都能看到。**

需要非交互传密码时，从安全的地方读：

```powershell
$pw = Read-Host '密码' -AsSecureString
$cred = New-Object PSCredential('DOMAIN\max', $pw)
Enter-PSSession -ComputerName dc01 -Credential $cred
```

密码本身不落历史。**生产环境的自动化用 Windows 凭据管理器或组策略存凭据，不要用明文变量。**
:::

::: warning 工作组里用户名必须带机器名
工作组（没有域）的环境里，凭据对话框填 `max` 会认证失败，**报错是「用户名或密码不正确」，不会提示你少了机器名**。

正确写法是 `主机名\用户名` 或 `.\用户名`：

```powershell
Enter-PSSession -ComputerName 192.168.1.20 -Credential (Get-Credential '.\max')
```

**用 IP 连接时这个问题最常出现** —— 因为没法从 IP 推出机器名。
:::

## 4. 工作组：为什么默认连不上，以及 TrustedHosts 的代价

**工作组环境下用主机名连接，Windows 默认拒绝，因为它无法验证这台机器的身份。**

现象是：

```text
WinRM 无法完成操作，因为验证目标计算机的证书链和 NetBIOS 名称不匹配
```

或者「客户端无法连接到目标主机」。

原因是 Kerberos 只在域里有意义，**工作组走 NTLM，而 NTLM 本身不验证服务器身份**。为了弥补，WinRM 要求你在客户端的信任列表里显式列出目标。

```powershell
Get-Item WSMan:\localhost\Client\TrustedHosts
```

你应该看到 `Value` 那一列（默认是空的）。

```powershell
Set-Item WSMan:\localhost\Client\TrustedHosts -Value '192.168.1.20' -Force
```

**注意这个值是逗号分隔的，而且不要有空格。** `'a, b'` 会被当成两项，第二项是带前导空格的 `b`，匹配不上。写多个目标时：

```powershell
Set-Item WSMan:\localhost\Client\TrustedHosts -Value '192.168.1.20,192.168.1.21' -Force
```

清空：

```powershell
Set-Item WSMan:\localhost\Client\TrustedHosts -Value '' -Force
```

::: danger 不要图省事写 `TrustedHosts = *`
写成通配符之后，所有主机名都被信任，**意味着你的域凭据可能被转发给任意一台声称自己是你想连的机器的设备**（NTLM 凭据转发攻击）。

这在隔离的开发环境里是常见偷懒，在有真实域账号的机器上是实打实的风险。**写具体的主机名列表。** 需要变更时走 `Set-Item` 逐台加。

**加之前先记下原值** —— 改这个不需要管理员，但这属于「本机全局配置」，会影响你之后所有的远程连接：

```powershell
Get-Item WSMan:\localhost\Client\TrustedHosts | Select-Object -ExpandProperty Value
```
:::

域环境不需要动 TrustedHosts —— 域里有 Kerberos 和 DNS 提供的服务器身份验证。

### `winrs`：不想开 PowerShell 会话时

```cmd
winrs -r:http://192.168.1.20:5985 -u:.\max -p:密码 cmd
```

::: warning `winrs` 用冒号，PowerShell 用连字符
`winrs` 的参数是 `-r:` `-u:` `-p:` `-tl:`，**值跟在冒号后面**，不带空格。写成 `-r http://...` 会被当成命令的第一个参数。

而 PowerShell 侧的 `Enter-PSSession` 用的是 `-ComputerName` / `-Credential`。**两套参数风格混用是最容易搞混的地方** —— 网上复制来的命令经常一边是 `winrs` 风格一边是 PowerShell 风格。

另外 `winrs` 的 `-p:` 会把密码留在命令行里，和上一节的 `Set-Item` 密码问题是同一类。**它不提示输入密码就是明文暴露。**
:::

## 5. 走 HTTPS 和走 SSH

### HTTPS：加密传输

```powershell
$cert = New-SelfSignedCertificate -Subject 'CN=dc01' -CertStoreLocation Cert:\LocalMachine\My
$thumb = $cert.Thumbprint
winrm create winrm/config/Listener?Address=*+Transport=HTTPS+CertificateThumbprint=$thumb
```

**自签证书的证书链不在受信任根里，客户端默认会拒绝。** 两种处理：

| 办法 | 做什么 | 代价 |
| --- | --- | --- |
| 把根证书导入客户端的受信任存储 | 正规做法 | 要先把根证书分发到所有客户端 |
| `-SkipCACheck` | 客户端跳过验证 | ⚠️ 退化成不验证身份 |

```powershell
$s = New-PSSessionOption -SkipCACheck -SkipCNCheck -SkipRevocationCheck
$ps = New-PSSession -ComputerName dc01 -UseSSL -SessionOption $s
```

::: danger `-SkipCACheck` 等于不验证服务器身份
跳过校验之后，连接**不再确认对面是不是你要连的那台机器**。在有中间人风险的网络（公共 WiFi、跨不可信网段）里，这等于把凭据交给任何应答者。

**生产环境应该把自签根证书导入客户端的受信任根存储，而不是用 `-SkipCACheck` 绕过去。** 导入命令是 `Import-Certificate -FilePath 根证书.cer -CertStoreLocation Cert:\LocalMachine\Root`。
:::

### SSH：PowerShell 7 才有

```powershell
Enable-WindowsOptionalFeature -Online -FeatureName OpenSSH-Server-In-Ping
Start-Service sshd
Set-Service -Name sshd -StartupType Automatic
```

你应该看到 OpenSSH 服务装好并启动。

```powershell
Enter-PSSession -HostName linux-or-windows-host -UserName max
```

**`-HostName` 加 `-UserName`（而不是 `-ComputerName`）走的就是 SSH。** 走 SSH 之后：

- 端口是 22 而不是 5985
- 认证靠 SSH 密钥，不走 Kerberos / NTLM
- 跨 Linux 和 Windows 都能用

`TODO：待补充` —— 具体支持的 OpenSSH 版本和 Windows 客户端/服务端的组合在哪些版本上验证过，需要在目标环境实测。至少确认两端都装了 OpenSSH Server 且密钥认证配通了。

## 6. 跳板机：一台能同时连到两端的机器

**当目标机在你连不到的网络里，但有另一台机器两边都能到时用它中转。**

前提两条：跳板机上必须开了远程（`Enable-PSRemoting`），而且跳板机自己能同时连到两端。

```powershell
$jumpCred = Get-Credential
$targetCred = Get-Credential

$jump = New-PSSession -ComputerName jump-host -Credential $jumpCred
$opt = New-PSSessionOption -ProxyCommand $jump -ProxyCredential $targetCred

$s = New-PSSession -ComputerName 10.0.0.5 -SessionOption $opt -Credential $targetCred
Invoke-Command -Session $s -ScriptBlock { hostname }
```

你应该拿到 `10.0.0.5` 那台机器的主机名。

`-ProxyCommand` 接受的是**一个 PSSession 对象**，`-ProxyCredential` 是**给目标机用的凭据**。这两个凭据是不同用途的：

| 参数 | 给谁用 |
| --- | --- |
| `-ProxyCommand $jump` | 连跳板机（用 `New-PSSession` 时的凭据） |
| `-ProxyCredential $targetCred` | 连最终目标 |

::: tip 清理跳板会话
```powershell
Remove-PSSession $s
Remove-PSSession $jump
```

`$jump` 那个对象还持有一条到跳板机的连接。不显式移除的话，它会一直挂到你退出当前 PowerShell 进程。脚本里用完就清。
:::

## 排障

**Q1：连接报「无法连接到目标机器」或直接超时？**

按这个顺序查，不要跳步：

1. `Test-NetConnection 目标 -Port 5985` —— 端口通不通
2. `Get-Service WinRM` 在**目标机**上 —— 服务是不是 `Running`
3. `winrm enumerate winrm/config/listener` 在目标机上 —— 有没有监听器
4. `Get-NetFirewallRule -Direction Inbound | Where-Object DisplayName -like '*WSMan*'` —— 防火墙规则在不在
5. `netsh advfirewall show allprofiles` —— 目标机连的哪个配置文件，规则在不在那个配置文件里

**Q2：认证失败，报「用户名或密码不正确」？**

1. 工作组里用户名加机器名 —— `.\用户名` 或 `主机名\用户名`
2. 确认这个用户在目标机上**有权远程登录** —— 用户组 `Remote Desktop Users` 或 `Remote Management Users`
3. 域里用 `DOMAIN\用户名` 完整形式，别只写用户名
4. 密码里有特殊字符时用 `Get-Credential` 交互输入，别拼命令行

**Q3：报「找不到会话配置」或者会话建立但立刻断开？**

1. `Enter-PSSession -ComputerName 目标` 看真实报错
2. `Get-PSSessionConfiguration` 在目标机上 —— 有没有 `Microsoft.PowerShell64` / `Microsoft.PowerShell32`
3. 客户端是 32 位的话确认 `Microsoft.PowerShell32` 存在
4. `winrm quickconfig` 在目标机上重跑一次

**Q4：连上了，但远端的命令行为很奇怪？**

1. `Enter-PSSession` 进去，`whoami` 看身份
2. `echo %COMPUTERNAME%` 确认是目标机
3. 大概率是**运行身份不是你以为的那个** —— 域策略或者会话配置里指定了别的账户
4. 注意远端是非交互会话，用户证书、`HKCU` 的部分内容、桌面目录都拿不到

**Q5：跳板机连接失败？**

1. `Enter-PSSession -ComputerName 跳板机` —— 跳板机自己能不能直连
2. 跳板机上 `Enable-PSRemoting` 做了没有
3. 跳板机能不能访问最终目标的 5985
4. 目标机能不能访问跳板机的 5985 —— **两端方向都要通**

**Q6：配完之后自己连不上了（已锁）？**

1. 用控制台登录本机（这就是前置条件里强调要有控制台的原因）
2. `winrm reset` —— 恢复默认配置
3. `winrm repair` —— 修复被改坏的配置存储
4. `winrm configSDDL` 查当前权限设置

## 什么时候别用

**远程 PowerShell 不是所有远程操作的最优解。**

| 需求 | 换成 | 原因 |
| --- | --- | --- |
| 图形界面操作 | RDP | WinRM 没有交互桌面 |
| 传文件 | SMB / `Copy-Item -ToSession` | 走 WinRM 传大文件很慢 |
| 一次性的单命令 | `schtasks` / 计划任务 + 事件日志回传 | 不用维持连接 |
| 跨 Linux 和 Windows 统一管理 | SSH（PS 7） | 一套凭据管理 |
| 高并发批量管理 | 管理平台 / DSC | 逐台建会话太慢 |
| 需要完整审计 | 有审计的方案 | WinRM 本身审计能力有限 |

::: warning 远程会话是「以你的权限在别人机器上操作」
`Enter-PSSession` 进目标机后，你手里的权限**没有缩小**。你在域里是管理员，就能对整个域做管理员能做的事，而且操作发生在对方那个会话上下文里。

::: danger `TrustedHosts` 配合 NTLM 等于把域凭据交出去
NTLM 不验证服务器身份，WinRM 用 `TrustedHosts` 绕过验证 —— 两者组合意味着**任何能冒充目标主机名/IP 的设备都能拿到你的域凭据**。

在办公网里这是可接受的操作环境，在跳板机可被影响的网络里不是。加凭据转发到敏感域环境时，至少要确认网络隔离，以及用了 HTTPS 监听器。

::: danger 不要用 `Enter-PSSession` 改自己的远程配置
连接状态就是你的诊断手段。**改 WinRM 配置、TrustedHosts、防火墙规则的任何操作，都应该在目标机的本地控制台上做。** 在一个远程会话里把自己的通道改断，是最经典的自锁方式。
:::

## 哪些是通用的

**「远程执行 + 凭据 + 通道加密」换平台一样成立。**

| 这里学的 | Linux 上对应 |
| --- | --- |
| `Enter-PSSession` | `ssh` |
| `Invoke-Command` | `ssh host 'command'` |
| `Get-Credential` | 密钥 / `ssh-agent` |
| Kerberos | GSSAPI / Kerberos |
| NTLM | 密码认证 |
| 跳板机 `ProxyCommand` | `ssh -J jump host` |
| `-UseSSL` | `ssh`（默认就是加密的） |
| `TrustedHosts` | `~/.ssh/known_hosts` |
| 会话复用 | SSH ControlMaster / 连接复用 |

**明确不通用的部分：**

- **传输层选择**。Windows 走 WSMan（HTTP 或 HTTPS 上的 5985/5986），Linux 的 SSH 是 22。PowerShell 7 支持两者，但 5.1 只能用 WSMan
- **身份模型**。Windows 的凭据和用户权限是系统级的（域、Kerberos 票据、NTLM 质询响应）；Linux 侧通常是「一对密钥 + authorized_keys 文件」，没有票据缓存这层
- **命令发现的成本**。SSH 目标机上通常没有预装的远端管理工具，所有命令都是那台机器上真实存在的；WinRM 的目标机必须有 PowerShell（5.1 以下的机器不能这样远程管理）
- **会话的连续性**。SSH 是无状态的短连接，重连就重连；`PSSession` 保留了远端进程和变量，断连重连能接着用
- **工作组模型的代价**。Windows 工作组里没有可用的身份验证，必须靠 `TrustedHosts` 妥协；Linux 的密钥认证天然解决了「怎么确认对面是谁」这个问题（`known_hosts`）

## 跑完之后

最后一章讲**写 PowerShell 脚本本身**：参数绑定为什么老出错、函数里的变量为什么改不到外面、以及 `try/catch` 明明写了却接不住异常。

→ [PowerShell 脚本：参数、作用域与错误处理](/windows/internals/12-powershell-script)

## 📝 配套练习

<QuizBlock module-id="11-remote" />
