---
title: ACL：rwx 不够用时的精细授权
description: getfacl / setfacl 的读写方式，以及 ACL 与 umask 的叠加效应。
---

# ACL：rwx 不够用时的精细授权

> 读完你能给「就这两个人、其他人都不行」的场景配好授权，并且知道 `getfacl` 里那句 `#effective:` 注释意味着什么、以及为什么加了 ACL 之后 `ls -l` 里的组权限看着变了。约 28 分钟。

<ModuleMeta module-id="15-acl" />

## 前置条件

确认文件系统支持 ACL，并且工具装了：

```bash
mkdir -p /tmp/acl-lab && cd /tmp/acl-lab
touch probe.txt
getfacl probe.txt
```

**你应该看到以 `# file:` 开头的几行，后面跟着 `user::`、`group::`、`other::` 三条基础条目。** 如果报 `getfacl: command not found`，装 `acl` 包（Debian/Ubuntu: `apt install acl`；RHEL 系: `dnf install acl`）。

如果报 `Operation not supported` 而不是正常输出，**说明文件系统没启用 ACL**：

```bash
findmnt -no OPTIONS /tmp
```

**你应该能在选项里看到 `acl`。** 看不到的话挂载时加上：

```bash
sudo mount -o remount,acl /
```

**判断句：`ext3` / `ext4` / `xfs` / `btrfs` / `tmpfs` 支持 ACL，`ext2` 不支持。** 网络文件系统（部分 NFS 挂载）也要看服务端配置。

## 1. 什么时候 rwx 真的不够用

`chmod` 只有三个位置：属主、所属组、其他人。**判断句：只要「同组的人待遇不一样」，三位模型就表达不了。**

| 需求 | 能不能用 chmod 表达 |
| --- | --- |
| 只有我能读写 | ✅ `600` |
| 所有人只读 | ✅ `644` |
| 我和同组的人可写，其他人只读 | ✅ `664` |
| **我 + alice + bob 可写，其他人只读** | ❌ 只有「其他人」这一档能接收 |

一个典型的具体场景：共享目录里有 3 个同事要读写，但组里还有 4 个人不该动。四种解法：

| 方案 | 做法 | 代价 |
| --- | --- | --- |
| 新建共享组 | `groupadd dev` + `chgrp dev` + `chmod 2770`（setgid） | 每次有人进出都要改组成员 |
| **ACL** | `setfacl -m u:alice:rw` | 权限信息在文件上，看 `ls -l` 看不出来 |
| 每人一份拷贝 | 复制文件 | 同步地狱 |
| 每人一个子目录 | 各自建目录 | 结构变了，脚本要改 |

**判断句：组内成员需要精确到人时才用 ACL。** 人数不超过三个、且进出不频繁时，**新建共享组更干净** —— 权限在一个地方维护，而不是散在每个文件上。

## 2. 读：`getfacl` 和那个 `+`

```bash
getfacl probe.txt
```

**你应该看到这样的结构：**

```text
# file: probe.txt
# owner: max
# group: max
user::rw-
group::r--
other::r--
```

| 条目 | 含义 |
| --- | --- |
| `user::` `group::` `other::` | **基础条目**，对应 chmod 的那三个位置，始终存在 |
| `user:名字:` | 命名用户条目（extended） |
| `group:名字:` | 命名组条目（extended） |
| `mask::` | **命名条目的权限上限**，见第 4 节 |
| `default:...` | 默认 ACL，**只出现在目录上** |

一旦有了命名条目，`ls -l` 会在权限位后面多一个 `+`：

```bash
ls -l probe.txt
```

**判断句：`+` 的含义是「这个文件有 ACL」，不是文件坏了。** 看到 `+` 就该用 `getfacl` 读，不要用 `ls -l` 的三组 rwx 去推理 —— 后者的组位置**显示的是 mask，不是 `group::`**（第 4 节）。

看某个目录本身的 ACL（而不是里面的文件列表）：

```bash
ls -ld /tmp/acl-lab
getfacl -d /tmp/acl-lab
```

`-d` 是必须的：**不带 `-d` 时 `ls -l 目录` 列的是目录里的东西，不是目录自己。** 这和 [读文件那一章](/linux/guide/02-view) 里 `ls` 的行为是同一条规律。

## 3. 写：`setfacl` 的四个动词

| 命令 | 是否改动数据 | 作用 |
| --- | --- | --- |
| `setfacl -m u:alice:rw probe.txt` | ✅ | 加或改一条命名条目 |
| `setfacl -m u:alice:rx dir/` | ✅ | 同上，权限字母 `rwx` 任意组合 |
| `setfacl -m g:dev:rwx probe.txt` | ✅ | 命名**组** |
| `setfacl -m m::rwx probe.txt` | ✅ | 单独调 mask |
| `setfacl -m u::rw-,g::r--,o::r-- probe.txt` | ✅ | 同时改基础条目 |
| `setfacl -x u:alice probe.txt` | ✅ | **删**一条命名条目 |
| `setfacl -b probe.txt` | ✅ | 删掉全部扩展条目，**只留基础三条** |
| `setfacl -k dir/` | ✅ | 只删默认 ACL |
| `setfacl -R -m u:alice:rx dir/` | ⚠️ 递归 | 目录和里面所有对象一起改 |
| `setfacl -d -m u:bob:rx dir/` | ✅ | 设置**默认 ACL**（只影响以后新建的） |
| `setfacl --restore=acl.txt probe.txt` | ✅ | 从 `getfacl` 的备份文件恢复 |
| `setfacl -n -m u:1001:rw probe.txt` | ✅ | 用数字 UID/GID，**不查名字** |

三个必须记的语义差异：

| 写法 | 含义 |
| --- | --- |
| `-m` | 修改 / 新增，**幂等**，可以反复跑 |
| `-x` | 删除，**一条都不存在时会报错** |
| `-b` | 全部扩展条目清空，退回纯 rwx 模型 |

**判断句：`-m` 是设置，`-x` 是删除，`-b` 是清空扩展部分。** 写自动化时 `-m` 最安全；`-x` 前面先 `getfacl` 确认条目名，否则会因为「本来就没有」而中断脚本。

## 4. mask：ACL 里最容易看不懂的一层

给一个人授权之后，`getfacl` 可能输出这样：

```text
user::rw-
user:alice:rwx
   #effective:r-x
group::r--
mask::r-x
other::r--
```

**判断句：`alice` 那一行写着 `rwx`，但底下写着 `#effective:r-x` —— 真正生效的是 `r-x`，因为 mask 是所有命名条目的上限。**

| 现象 | 原因 |
| --- | --- |
| 命名条目显示 `rwx` 但有 `#effective:` 注释 | 被 mask 挡住了 |
| 加了 `-m u:alice:rwx` 却还是不能执行 | 同上 |
| `ls -l` 的组位置显示的权限比 `group::` 大 | **那一列显示的是 mask** |

```bash
setfacl -m m::rwx probe.txt
```

**你应该看到 `#effective:` 注释消失，alice 真正拿到 rwx。**

::: warning

加了 ACL 之后，`chmod` 的组位置改的是 mask
这是 ACL 和 chmod 混用时最隐蔽的一条：**文件上有扩展 ACL 时，`chmod g=rwx` 改的是 mask，不是 `group::` 条目。**

```bash
setfacl -m u:alice:rwx probe.txt
chmod g=r-- probe.txt        # alice 立刻失去 r 和 w
getfacl probe.txt             # 能看到 mask 被改成了 r--
```

**判断句：文件有 `+` 时，先 `getfacl` 看清现状，再决定用 `chmod` 还是 `setfacl`。** 用 `chmod` 之前先确认 `group::` 是不是你真正想改的东西。

:::

## 5. 目录的默认 ACL：只对以后新建的东西生效

```bash
setfacl -d -m u:alice:rx /tmp/acl-lab
mkdir /tmp/acl-lab/sub
getfacl /tmp/acl-lab/sub
```

**你应该看到 `sub` 上多了一条 `user:alice:rx` 的默认 ACL，以及一条继承来的访问 ACL。**

| 行为 | 规则 |
| --- | --- |
| 新建子目录 | 继承父目录的**默认 ACL**（作为访问 ACL），同时把默认 ACL 也复制过去 |
| 新建文件 | 从父目录默认 ACL 算出访问 ACL，**但去掉 `x` 和基础条目的执行位**（文件默认不带 x） |
| **已存在的文件** | **完全不受影响** |

**判断句：默认 ACL 不追溯。** 改完默认 ACL 之后，目录里已有的那些文件权限一点没变。要一起改就得显式 `setfacl -R`。

::: tip

让整个目录树保持一致
```bash
setfacl -R -m u:alice:rx /tmp/acl-lab
setfacl -R -d -m u:alice:rx /tmp/acl-lab
```

第一行管已有的，第二行管以后新建的。**两个都要做，缺一个就会出现「老文件能看、新文件不能」这种半生不熟的状态。**
:::

## 6. ACL 与 umask 的叠加效应

**判断句：父目录有默认 ACL 时，umask 不再参与新建文件的权限计算；没有默认 ACL 时，才轮到 umask。**

| 情况 | 新建对象的权限由什么决定 |
| --- | --- |
| 父目录**没有**默认 ACL | 目标的 `666` / `777` 再被 umask 削掉（见 [权限那一章](/linux/howto/04-permission)） |
| 父目录**有**默认 ACL | 由默认 ACL 算出，**umask 被完全忽略** |

这解释了一个看起来矛盾的现象：

```bash
umask                        # 你以为会削掉写权限
# 输出 0022
setfacl -d -m u:alice:rx -m o::rwx /tmp/acl-lab
touch /tmp/acl-lab/new.txt
getfacl /tmp/acl-lab/new.txt
```

**你应该看到 `new.txt` 里有 `user:alice:rx`，而且 `other::rwx` 里的 `w` 还在** —— umask 没把它削掉。

**判断句：设了默认 ACL 之后，`umask` 对这个目录下面的新建文件失效。想让 umask 继续起作用，就别设默认 ACL。** 两者只能选一个当主导。

## 排障

**Q1：加了 ACL 之后别人还是访问不了，按这个顺序查：**

1. `getfacl 路径` —— **不看这个就别往下查**
2. 看有没有 `#effective:` 注释 —— 有就是 mask 挡住了，`setfacl -m m::rwx 路径`
3. `ls -ld 目录的每一层` —— **ACL 只管这一个对象，穿过目录需要每一层都给 `x`**
4. `namei -l 路径` —— 一次列出整条路径上所有目录的权限，这类问题最快的手段
5. `ls -l 路径` 结尾是不是 `+` —— 没有 `+` 说明 ACL 根本没加上
6. 文件系统支持吗 —— `findmnt -no OPTIONS 挂载点` 里有没有 `acl`

**Q2：`setfacl: Operation not supported`**

1. `findmnt -no OPTIONS 挂载点` —— 挂载选项里有没有 `acl`
2. 文件系统类型 —— `ext2` 不支持，换 `ext4` 或重新 `mkfs`
3. NFS / CIFS 挂载要看服务端配置，客户端说了不算
4. 加上 `-o remount,acl` 重挂载

**Q3：复制文件之后 ACL 没了**

1. **默认会丢。** `cp` 不保留 ACL，除非加 `-p`（保留权限和时间）或 `-A`（连 ACL 一起保留）
2. `mv` 在同一文件系统内会保留 ACL，跨文件系统等价于复制 + 删除，会丢
3. `rsync` 要加 `-A` 才传 ACL；`tar` 要加 `--acls`
4. 判断句：**ACL 是文件属性的一部分，需要复制工具显式支持**，遇到「配置目录复制一遍就失效」先查这里

**Q4：`setfacl -x` 报「条目不存在」**

1. `getfacl 路径` 确认条目的准确写法 —— 是 `user:alice` 还是 `group:alice`
2. 基础条目（`user::` `group::` `other::`）**不能用 `-x` 删**，用 `-b` 一次性退回
3. `setfacl -b` 是最彻底的重置，删掉所有扩展条目
4. 脚本里对 `-x` 加 `|| true`，因为「本来就没有」不是错误

**Q5：新文件权限和预期不一样**

1. `getfacl 新文件` —— 看有没有继承默认 ACL
2. 父目录有没有默认 ACL：`getfacl -d 目录`
3. 有默认 ACL → umask 被忽略，检查是不是默认 ACL 里写了不该给的权限
4. 没有默认 ACL → 是 umask 的事，`umask` 确认当前值
5. 文件上不该有 `x` —— **默认 ACL 给文件继承时会自动去掉执行位**，看到 `user:alice:rwx` 在普通文件上就是异常

**Q6：怎么审一遍某个目录树上的所有授权**

```bash
getfacl -R /srv/shared 2>/dev/null | grep -E '^user:|^group:|^# file:'
```

**你应该得到一份「文件 → 命名条目」的对照清单。** 这份输出可以直接喂给 `setfacl --restore` 用来备份 ACL 配置 —— **ACL 比 rwx 难恢复得多，值得单独存档。**

## 什么时候别用

- **人数不超过三个、进出不频繁时，不要用 ACL，用共享组。** 组成员信息集中在一个地方，`id 用户名` 一查就知道全貌；ACL 是散在每个文件上的，想查「alice 到底能访问哪些文件」得扫全树。
- **不要用 ACL 代替 setgid 目录。** 需要「新建的文件自动属于这个组」时，正确做法是 `chmod 2770`（setgid），**不是**给每个文件加 `g::rwx` 的默认 ACL。setgid 一条命令管所有后续创建。
- **不要用 `setfacl -R` 给整棵树开 `rwx`。** 它会把**普通数据文件的执行位也打开**，让一批本不该可执行的文件变成可执行。正确姿势是给目录 `rx`、给文件 `rw` 分开处理。
- **不要用 `setfacl -b` 当「重置」以外的用途。** 它会一次性删掉所有命名条目，**共享目录上执行等于让所有人只剩基础权限**。执行前先 `getfacl -R 存档`。
- **不要用 ACL 绕过 setuid 提权类程序的管理策略。** 某些程序（历史上是 `sshd`、一些编译器）会忽略 ACL 维持自己的安全模型，在那些路径上配 ACL 是无效功。
- **不要在多人共享目录上用命名用户条目做长期授权。** 人离职了，那条 `user:名字` 会永远留在文件上，因为没人会记得去删。**组会自然跟着人走，命名条目不会。**
- **不要指望 ACL 在非 POSIX 的地方一致。** Samba、rsync、tar、备份工具对 ACL 的支持各不相同，跨系统搬运时先验证。

## 哪些是通用的

| 这一章的判断 | 换个平台还成立吗 |
| --- | --- |
| 「三位模型表达不了组内差异」 | Windows NTFS ACL 更细，直接就是条目列表 |
| 「权限散在对象上还是集中在一处，是个选择」 | 同样成立，是设计取舍不是对错 |
| 「mask 是一层全局上限」 | Windows 没有独立的 mask，但有「继承」造成的类似效果 |
| 「默认设置只影响以后新建的」 | Windows 的继承 ACL 完全是同一套语义 |
| 「复制工具可能不保留权限」 | 跨平台拷贝时必须验证 |
| 「授权信息要有地方可查」 | 审计要求，跨平台通用 |

**不通用的是概念名字。** `mask`、`getfacl`/`setfacl`、默认 ACL 是 POSIX ACL 的术语，Windows 上对应的是「访问控制条目（ACE）」和「继承」。**Windows 的模型本来就是 ACL，Linux 的 ACL 是后来加的补丁**，所以 Linux 上多出来的 `mask` 层在 Windows 那边没有对应概念。

**可移植的判断只有一条：给谁开权限、会不会被继承、复制之后还在不在。** 这三个问题在任何平台的权限系统上都要问一遍。

## 跑完之后

你能给指定的人开权限，并能解释 `#effective:` 注释和 `+` 号背后的原因。权限这一路就到这里了，下一步回到 [速查表](/linux/reference/cheatsheet) 把整条 Linux 线的东西压成一页能贴在屏幕边上用的东西。

→ [Linux 速查表](/linux/reference/cheatsheet)

## 🎮 实战演练

<ArenaTasks module-id="15-acl" />

<ToyShellTerminal module-id="15-acl" />

## 📝 配套练习

<QuizBlock module-id="15-acl" />
