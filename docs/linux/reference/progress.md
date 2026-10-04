---
title: Linux 学习进度
description: 已完成章节、平均分与徽章。进度只存在你自己的浏览器里。
---

# Linux 学习进度

<ProgressRing track="linux" />

## 章节总表

<ChapterTable track="linux" />

## 徽章

<BadgeWall track="linux" />

## 数据存在哪

全部在你的浏览器 `localStorage` 里，键名 `commandcraft.v2.linux`。

不上传、不同步、关掉浏览器标签页也不会丢（除非你清了浏览器数据）。

换了浏览器或清了缓存，进度会从头开始 —— 这是纯静态站的固有限制。

## 从旧站迁移

如果你是从旧版 Cabin 站过来的，第一次打开本页时会把旧进度读过来。旧数据保留一个周期，确认无误后可以自己清掉：

```js
// 在浏览器控制台执行，只清旧的键
Object.keys(localStorage)
  .filter(k => k.startsWith('commandcraft.') && !k.startsWith('commandcraft.v2'))
  .forEach(k => localStorage.removeItem(k))
```
