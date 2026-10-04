---
title: 压缩归档与装软件：tar 与包管理器
description: tar 的三个必记选项，以及 apt / dnf 装包前该先确认什么。
---

# 压缩归档与装软件：tar 与包管理器

> 读完你能打出正确的备份命令，也知道装包之前该先查一遍什么 —— 避免装出一个和系统其它部分打架的版本。这一章大约 22 分钟。

<ModuleMeta module-id="08-archive" />

## 前置条件

```bash
tar --version | head -1
```

看到类似 `tar (GNU tar) 1.34` 即可。

## 1. 归档与压缩是两件事

| 动作 | 做什么 | 常用命令 |
| --- | --- | --- |
| 归档 | 把多个文件打成一个 | `tar -cf` |
| 压缩 | 减小体积 | `gzip` / `xz` / `zstd` |

**先澄清一个常见误解：`tar` 本身不压缩。** `tar -cf backup.tar 目录` 只是把文件打包，体积可能反而变大（因为要存元数据和块对齐）。

要压缩必须显式指定：

```bash
tar -czf backup.tar.gz 目录      # gzip，速度快通用
tar -cJf backup.tar.xz 目录      # xz，压缩率高但慢
tar -cjf backup.tar.zst 目录     # zstd，兼顾速度和压缩率
```

| 后缀 | 压缩方式 | 特点 |
| --- | --- | --- |
| `.tar` | 不压缩 | 只归档 |
| `.tar.gz` / `.tgz` | gzip | 最通用，压缩率一般 |
| `.tar.xz` | xz | 压缩率高，CPU 占用大 |
| `.tar.zst` | zstd | 新一点的系统默认，速度与压缩率平衡最好 |

::: tip 看文件类型先确认后缀
```bash
file backup.tar.gz
```
不解压就能看出它是不是真的 gzip。有些「压缩包」其实是 tar 直接改了个后缀名，解压会失败。
:::

## 2. 三个必记选项

### `-c` 创建 / `-x` 解压 / `-t` 列表

```bash
tar -czf backup.tar.gz /etc/nginx    # c 创建
tar -tzf backup.tar.gz               # t 列表，看里面有什么
tar -xzf backup.tar.gz -C /tmp      # x 解压
```

**`-t` 是解压前的安全检查。** 解压别人给的包之前先 `-t` 看一眼，能避免把文件铺到意料之外的位置。

### `-C` 指定解压目录

```bash
tar -xzf backup.tar.gz -C /opt/app
```

不加 `-C` 时解压到**当前目录**。解压一个从根目录打出来的包而不带 `-C`，可能把文件铺满你的工作目录。

### `-v` 显示过程

```bash
tar -xzvf backup.tar.gz
```

备份时也建议加 `-v`，能立刻看出哪些文件被处理了。

::: warning 备份 tar 的时候不要把备份文件也打进去
```bash
tar -czf backup.tar.gz /home          # ⚠️ /home 里已有 backup.tar.gz 时会把自己打包进去
```
先写到别处，或者用 `--exclude` 排除掉。归档自己会一直增长直到打包失败。
:::

## 3. 备份该备份什么

备份不是备份文件，是备份**权限和属主**。少了一样东西，恢复的时候就是一堆麻烦。

```bash
sudo tar -czvf backup.tar.gz /etc/nginx
```

`-v` 的输出里能看到权限位。恢复时用 `sudo` 同样保留属主。

::: danger 恢复要 sudo，但备份前不要
```bash
sudo tar -czf backup.tar.gz /etc    # ⚠️ 不要
tar -czf backup.tar.gz /etc         # ✅ 读文件通常不需要 root
```
用 sudo 备份可能让某些临时文件混进来；更实际的问题是养成 sudo 习惯后，一条手滑的命令后果就不一样了。能不用就不用的地方不用。
:::

## 4. 查包管理器

不同发行版用不同的：

| 发行版系 | 包管理器 | 搜包 | 装包 |
| --- | --- | --- | --- |
| Debian / Ubuntu | apt | `apt search` | `apt install` |
| RHEL / CentOS / Fedora | dnf | `dnf search` | `dnf install` |
| Alpine | apk | `apk search` | `apk add` |

先确认自己是什么：

```bash
cat /etc/os-release
```

`ID=` 那一行告诉你属于哪一系。这是装任何东西之前的第一个动作 —— 用错包管理器会得到「找不到软件包」的错误，而这个错误信息不会告诉你「你用错工具了」。

## 5. 装包之前先确认三件事

```bash
apt search nginx        # 1. 包名对不对
apt policy nginx         # 2. 有没有装过、版本是多少
apt list --installed | grep nginx   # 3. 有没有同名相关包已经在了
```

| 确认什么 | 命令 | 为什么 |
| --- | --- | --- |
| 包名对不对 | `apt search 关键词` | 名字猜错报「Unable to locate package」 |
| 装没装过 | `apt policy 包名` | 已装的话会显示 Installed 和版本 |
| 版本对不对 | `apt policy 包名` | 源里可能是旧版本 |

```bash
apt update               # 先更新软件源列表
apt install nginx
```

::: warning apt install 之前必须 apt update
软件源里可用版本的列表是缓存的。不更新就装，可能装到旧版本，或者报「找不到包」（明明包是存在的，只是列表里没有）。

`apt update` 只更新列表，不改动已安装的软件 —— 它是安全的。
:::

### 装之前先看会动什么

```bash
apt install --dry-run nginx
```

`--dry-run` 只模拟不执行，能看到会装哪些包、会不会顺带升级别的东西。

## 排障

**Q1：`apt install` 报 Unable to locate package，但包明明存在？**

1. `apt update` —— 大概率是这个，软件源列表没更新
2. `apt search 关键词` —— 包名可能不是你猜的那个（`nginx` vs `nginx-core`）
3. `cat /etc/apt/sources.list` —— 源配置是否正确、是否被注释掉了

**Q2：`Permission denied`，但我明明是 root？**

1. `whoami` —— 确认当前身份，`sudo -i` 切过去
2. `sudo` 是否在 PATH 里 —— 有些精简环境没装 sudo
3. `ls -ld 目录` —— 目录权限位是否允许写入

**Q3：解压出来的文件全变成了普通文件，权限丢了？**

1. `tar -tzvf 包` —— 看归档里记录的权限
2. `sudo tar -xzf 包` —— 恢复时加 sudo，否则属主和权限无法还原
3. 检查是不是用图形界面解压的 —— 多数 GUI 工具会忽略 Unix 权限位

**Q4：备份文件越来越大，超过原始目录？**

1. `tar -tzvf 包 | head` —— 看是不是把自己也打进去了
2. 备份文件和被备份目录在同一个目录下 —— 换位置
3. `du -sh 目录` 对比 —— 目录里有隐藏的大文件（日志、缓存）

## 什么时候别用

| 场景 | 别用 | 用什么 |
| --- | --- | --- |
| 要跨机器同步、频繁变动 | `tar` 每次全量打包 | `rsync` |
| 备份要能增量 | `tar` | `rsync -a` 或快照 |
| 备份数据库 | `tar` 直接打包数据文件 | 数据库自己的导出命令 |
| 只是传几个文件 | 打包解压 | `scp` |

::: danger tar 不能用来备份运行中的数据库
直接 tar 打包正在写入的数据库文件，得到的是**不一致的快照** —— 一半是旧的、一半是新的，恢复后可能损坏。

必须用数据库自己的导出：`mysqldump`、`pg_dump`。备份文件后再打包。
:::

**tar 适合的是「文件不会边写边读」的场景** —— 配置、静态资源、源码。运行中的服务数据不在此列。

## 哪些是通用的

| 这里学的 | 别处对应 |
| --- | --- |
| 归档 ≠ 压缩 | `tar` 与 `zip` / `7z` 同样分开 |
| 解压到指定目录 | Windows 的 `-C` 等价物要靠工具本身 |
| 打包前 `--exclude` 自己 | 所有归档工具都有类似排除选项 |
| 装包前先确认源和版本 | 所有包管理器的通用习惯 |

**不通用的是具体选项字母**。BSD 的 `tar` 在细节上和 GNU 有差异，`pax` 又是另一套。跨平台脚本里不要假设某台机器的 tar 完全一致，先 `tar --version` 看一眼。

## 跑完之后

Linux 上手篇到此结束。下一章进入场景篇，从**权限**开始 —— 八进制权限位怎么读，以及 `rwx` 不够用的时候该怎么办。

→ [权限：读懂 ls -l 的第一列](/linux/howto/04-permission)

## 📝 配套练习

<QuizBlock module-id="08-archive" />
