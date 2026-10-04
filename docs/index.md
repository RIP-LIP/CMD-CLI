---
layout: home
hero:
  name: COMMANDCRAFT
  text: 把命令行敲顺，而不是背下来
  tagline: 27 章分 Linux 与 Windows 两条线，每章末尾有一个能真敲的终端。读完能复现，不是读过。
  image:
    src: /logo.svg
    alt: CommandCraft
  actions:
    - theme: brand
      text: 从 Linux 第一章开始
      link: /linux/guide/01-intro
    - theme: alt
      text: Windows 线
      link: /windows/guide/01-file-system
    - theme: alt
      text: 命令速查表
      link: /linux/reference/cheatsheet

features:
  - title: Linux 线
    details: 15 章，从定位文件和读内容，到权限、进程、文本三件套，再到 systemd、Docker、SSH、cron、ACL。
    link: /linux/guide/01-intro
    linkText: 打开上手篇
  - title: Windows 线
    details: 12 章，CMD 与 PowerShell 两种写法并列给出，含批处理、管道、注册表、WinRM 远程。
    link: /windows/guide/01-file-system
    linkText: 打开上手篇
  - title: 浏览器内终端
    details: 每章末尾挂一个真的能敲的终端：虚拟文件系统跟着命令变，写错了会报错，做完任务会打勾。
    link: /linux/guide/01-intro
    linkText: 试一下
  - title: 练习与进度
    details: 每章 8 到 10 道题，60 分及格。进度存在你自己的浏览器里，不上传任何数据。
    link: /linux/reference/progress
    linkText: 看进度页
  - title: 只讲隐性规则
    details: 只收文档里隐蔽、出错不提示原因、且能复现的那类坑。每条命令都标了它会改动什么。
    link: /linux/reference/cheatsheet
    linkText: 看速查表
  - title: 什么时候别用
    details: 每章都写了「什么情况下不该用它」。踩过坑的人比没踩过的人更知道边界在哪。
    link: /linux/howto/07-text
    linkText: 读一章看看
---

## 这套文档解决什么

终端难的地方不在记命令，在于**出错了不知道从哪查**。命令报错往往只给一句话，不告诉你该先看什么。

这份站补的是排查顺序：每章的「排障」一节给的是一条可复制的命令序列，不是零散技巧。

写给三类人：

- 刚配好一台 Linux 或 Windows 机器，终端一进去就不知道该敲什么
- 会用但不快，做重复操作时想不起来该用哪个命令
- 需要在服务器上排查问题，想知道先查哪一样

## 内容结构

每条线都按「你是谁」分成三段，不按工具分：

| 分段 | 你的处境 | 怎么用 |
| --- | --- | --- |
| 上手篇 | 我要把命令敲顺 | 按顺序读，一章一章来 |
| 场景篇 | 我遇到了具体麻烦 | 带着问题查 |
| 原理篇 | 出故障了想自己定位 | 选读，能自己查出来 |

<ChapterTable track="linux" />

## 两条线怎么选

先学一条。两条线的思维习惯不一样，同时学容易互相干扰。

- 已经有 Linux 基础，只想解决 Windows 上的活 → 直接走 Windows 线
- 只会 Windows，想搞明白服务器上那些命令 → 走 Linux 线
- 完全新手 → Linux 线，概念更少，文档和社区更多
