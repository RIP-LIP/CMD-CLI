---
title: Docker：镜像、容器、卷三者的关系
description: 容器和虚拟机的实际差别，docker compose 从零到跑起来，以及容器起不来的排查顺序。
---

# Docker：镜像、容器、卷三者的关系

> 读完你能说清镜像和容器差在哪、容器数据为什么会丢，以及一个容器 `Exited (137)` 时按什么顺序查到根因。约 35 分钟。

<ModuleMeta module-id="12-docker" />

## 前置条件

```bash
docker --version
docker compose version
```

**两个版本号都要有。** `docker compose`（不带连字符）需要 Compose V2，它是 Docker CLI 的插件；如果你只有 `docker-compose`（带连字符，Python 写的 V1），本章的写法基本通用，但建议升级。

确认守护进程在跑、你的用户有权限：

```bash
docker info | head -20
```

**你应该看到一段配置，包含 `Server Version` 和 `Storage Driver` 两行。** 要精确取某个字段时用 `docker info --format`，写成 <span v-pre><code>docker info --format 'Server {{.ServerVersion}}'</code></span>，**单引号不能省**，否则 shell 会先吃掉大括号。

| 现象 | 说明什么 |
| --- | --- |
| `permission denied ... /var/run/docker.sock` | **你不在 docker 组里**，见第 2 节 |
| `Cannot connect to the Docker daemon` | 守护进程没起，或者你连的是远程 context |
| 正常打印一大段配置 | 可以继续 |

确认连的是哪台机器 —— 这一条比版本更容易出错：

```bash
docker context ls
```

**判断句：连错 context 时，所有命令都成功，但操作的是另一台机器。** 写脚本前先看一眼 `docker context show`。

## 1. 镜像、容器、卷：三个不同的东西

**判断句：镜像是只读模板，容器是它的运行实例，卷是独立于容器生命周期的存储。三者各自有各自的生命周期命令。**

| 对象 | 是什么 | 创建 | 查看 | 删除 |
| --- | --- | --- | --- | --- |
| 镜像 image | 只读分层模板，含文件系统快照 | `docker build` / `docker pull` | `docker images` | `docker rmi` |
| 容器 container | 镜像跑起来的实例，**有可写层** | `docker run` / `docker create` | `docker ps` | `docker rm` |
| 卷 volume | 独立存储，**容器删了它还在** | `docker volume create` | `docker volume ls` | `docker volume rm` ⚠️ |

**容器删掉，可写层里的东西一起消失；卷不删，数据一直在。** 这一条决定了数据库绝对不能把数据写在容器自己的文件系统里。

镜像是分层的：每一层对应 Dockerfile 里的一条指令，层之间共享。**判断句：改 Dockerfile 靠后的指令不会让靠前的层失效，所以把「很少变化的东西」写在前面，镜像构建会快很多。**

## 2. 容器和虚拟机的实际差别

| 维度 | 容器 | 虚拟机 |
| --- | --- | --- |
| 内核 | **和宿主机共用** | 自己的内核 |
| 隔离靠什么 | namespace（名字空间）+ cgroups（资源限制）+ overlay2 文件系统 | Hypervisor 虚拟硬件 |
| 启动时间 | 毫秒到秒级 | 几十秒 |
| 体积 | 几十到几百 MB | 几 GB 起 |
| 能装另一个内核 | ❌ 不行 | ✅ 可以 |

**判断句：容器不是「轻量虚拟机」。** 因为共用内核，**Linux 容器只能跑在 Linux 宿主上**，而且它跑不了宿主内核不支持的内核特性。这是 Podman 之类工具必须用 user namespace 模拟「root」的原因。

### 权限：把用户加进 docker 组等于给它 root

```bash
sudo usermod -aG docker "$USER"
```

**加完必须重新登录才生效**（`su - "$USER"` 也不行，要完整重开会话）。

::: danger

docker 组等价于免密 root
`docker` 组的用户可以启动一个挂载宿主机根目录的容器，然后在里面以 root 身份读写宿主机上的任意文件。**能进 docker 组就能拿到这台机器的 root 权限，没有例外。** 这条只对完全受控的开发机成立，不要在生产机上这么做。
:::

## 3. 常用命令，以及每条改了什么

| 命令 | 是否改动系统状态 | 说明 |
| --- | --- | --- |
| `docker run -d --name web -p 8080:80 nginx:alpine` | ✅ 创建并启动容器 | `-d` 后台 |
| `docker ps` | 只读 | 只看运行中的 |
| `docker ps -a` | 只读 | **包括已退出的，排查必加 `-a`** |
| `docker logs -f --tail 100 web` | 只读 | 看最近 100 行并跟随 |
| `docker exec -it web sh` | 只读（在容器内执行） | 进容器调试 |
| `docker inspect web` | 只读 | 完整配置与状态，**排查主力** |
| `docker stats --no-stream` | 只读 | 一次性资源占用 |
| `docker system df` | 只读 | 镜像/容器/卷各占多少 |
| `docker stop web` | ⚠️ 发 SIGTERM 停止 | 超过 10 秒才升级到 SIGKILL |
| `docker restart web` | ⚠️ | 停+起 |
| `docker rm web` | ⚠️ 删除容器 | **可写层的数据一起没** |
| `docker rm -f web` | ⚠️⚠️ | 强制删除，运行中也删 |
| `docker rmi nginx:alpine` | ⚠️ 删除镜像 | 有容器在用会失败 |
| `docker volume rm app-data` | ⚠️⚠️ 删除数据 | **数据不可恢复** |
| `docker system prune` | ⚠️⚠️ 删除停止的容器/网络/悬空镜像 | 见下方警告 |

::: danger

`docker system prune -a --volumes` 会删掉正在用的数据
- 不带参数：删掉**已停止的容器**、未使用的网络、悬空镜像和构建缓存
- 加 `-a`：**所有没被容器使用的镜像**，包括你下次还要用、但刚 `docker rmi` 过的
- 加 `--volumes`：**所有没被容器使用的卷 —— 里面的数据直接消失**

`docker compose down` 已经会删掉容器和网络，**但保留卷**；加上 `-v` 就连卷一起删，数据库的数据就没了。

**判断句：清理磁盘时先 `docker system df` 看清每一项占多少，再决定删哪一类，不要习惯性敲 prune。** 要养成习惯就只敲 `docker image prune`（只删悬空层）。
:::

### 端口发布默认是暴露给整个网络的

```bash
docker run -d -p 8080:80 nginx:alpine      # 监听 0.0.0.0:8080
docker run -d -p 127.0.0.1:8080:80 nginx:alpine   # 只监听本机回环
```

**判断句：`-p 宿主端口:容器端口` 第一个参数写 `0.0.0.0` 还是 `127.0.0.1`，决定了这个端口在网络上是否可见。** 开发机上的数据库、缓存、管理界面应该显式绑 `127.0.0.1`，因为默认值等于把它发布到所有网卡上。

确认实际监听：

```bash
ss -tlnp | grep 8080
```

**你应该看到 `0.0.0.0:8080`；只想要本机访问就得是 `127.0.0.1:8080`。**

## 4. 存储：卷和绑定挂载

| 方式 | 写法 | 适合 | 注意事项 |
| --- | --- | --- | --- |
| 命名卷 | `-v app-data:/var/lib/data` | 数据库、上传目录 | 由 Docker 管理，`docker volume ls` 看得见 |
| 绑定挂载 | `-v /srv/data:/var/lib/data` | 代码、配置、要直接编辑的文件 | 宿主机上是什么就是什么 |
| 临时内存盘 | `--tmpfs /tmp` | 临时文件、缓存 | 重启即丢，不落磁盘 |

**判断句：数据要活过容器，就放卷；要活过机器，就放绑定挂载。** 这两条决定了备份策略，不是一个风格问题。

::: warning

绑定挂载的属主是容器里那个用户
容器内进程以什么 UID 跑，绑定挂载里新建的文件在宿主机上就是那个 UID。**默认容器以 root 跑，于是挂载目录里会留下一堆 root 属主的文件**，你回到宿主机用普通用户就改不动了。

两个办法：compose 里写 `user: "1000:1000"`，或者事后 <span v-pre><code>sudo chown -R "$USER":"$USER" /srv/data</code></span>。用 `-v` 而不是 `--mount` 时路径解析有几处历史差异，**新写的脚本建议用 `--mount`**，它在路径不存在时会直接报错而不是悄悄建成一个目录。
:::

::: warning

镜像里没有 shell 时 `docker exec` 必然失败
```bash
docker exec -it web sh
```

你会看到 `exec: "sh": executable file not found in $PATH`。这不是容器坏了，是**镜像本身不含 shell**（distroless、scratch 基础镜像、部分精简镜像）。这类镜像只能：

- 用 `docker cp` 把文件拷进去看一眼
- 用 `docker logs` 看它自己的输出
- 换成有 shell 的变体镜像（很多项目提供 `-debug` 或 `-alpine` 标签）来调试

**判断句：`exec: "sh": not found` 是镜像设计问题，不是权限问题，加 sudo 也没用。**
:::

## 5. 容器起不来：固定排查顺序

**第一步永远是 `docker ps -a`**，不加 `-a` 你看不到已经退出的容器：

```bash
docker ps -a --filter status=exited
```

看到 `Exited (137)` 这样的标记时，**括号里是退出码，它直接告诉你问题类型**：

| 退出码 | 含义 | 下一步查什么 |
| --- | --- | --- |
| `0` | 正常结束 | 主进程跑完就退了，容器该配一个长驻进程 |
| `1` | 应用自己报错 | **看应用日志** |
| `125` | Docker 守护进程无法启动这个容器 | 参数或挂载有问题 |
| `126` | 找到命令但不可执行 | 镜像里的文件缺执行位 |
| `127` | 命令找不到 | 镜像里没这个命令，常见于 distroless |
| `137` | `128 + 9`，被 `SIGKILL` 打死 | **几乎总是内存不足** |
| `139` | `128 + 11`，段错误 | 应用本身的问题 |
| `143` | `128 + 15`，收到 `SIGTERM` | 收到停止信号，属于正常停止 |

`Exited (137)` 的完整查法：

1. `docker inspect web | grep -E '"ExitCode"|"OOMKilled"|"Error"'` —— 确认是不是 OOM
2. `docker stats --no-stream` 看当前容器的内存上限
3. `docker logs --tail 200 web` —— **被 OOM 杀掉时往往一行日志都没有**，这本身就是证据
4. `dmesg -T | grep -i 'killed process'` —— 内核侧记录

**判断句：137 且 OOMKilled 为真，直接加内存；137 但 OOMKilled 为假，说明是别的东西发的 SIGKILL（常见于 stop 超时后被强制杀）。**

其他几种起不来的情况：

| 症状 | 按顺序查 |
| --- | --- |
| `port is already allocated` | `ss -tlnp \| grep 端口` 找到占用者，或换一个宿主端口 |
| 容器一直 `restarting` | `docker logs --tail 100 web` 看崩溃点；`docker inspect web \| grep RestartCount` |
| 容器运行但服务访问不到 | 容器内服务是不是只监听了 `127.0.0.1`，必须监听 `0.0.0.0` |
| 容器 `Created` 但没起来 | `docker inspect web \| grep '"Error"'` |
| 刚建就消失 | `docker events --since 5m --filter container=web` |

## 6. compose：把一组服务写成一个文件

```yaml
services:
  db:
    image: postgres:16
    environment:
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - db-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 5

  web:
    build: .
    ports:
      - "127.0.0.1:8080:80"
    depends_on:
      db:
        condition: service_healthy
    restart: unless-stopped
    user: "1000:1000"

volumes:
  db-data:
```

四个不可省的字段组合：

| 字段 | 作用 |
| --- | --- |
| `healthcheck` + `depends_on: condition: service_healthy` | **让启动顺序真的可靠**，只写 `depends_on` 不够 |
| `restart: unless-stopped` | 崩溃后自动拉起，机器重启后也起来 |
| `ports` 显式绑 `127.0.0.1` | 不把服务无意发布到所有网卡 |
| `user` | 避免绑定挂载里生成一堆 root 属主文件 |

**判断句：compose 文件里「谁先起」是启动顺序问题，「等多久算就绪」是健康检查问题，两个要分开写。** 只写 `depends_on` 的服务经常因为数据库还没准备好就崩，然后进入重启循环。

| 命令 | 是否改动系统状态 | 说明 |
| --- | --- | --- |
| `docker compose config` | 只读 | **校验并展开最终配置**，改完先跑这个 |
| `docker compose up -d` | ✅ 创建并启动 | 镜像不存在时才构建 |
| `docker compose up -d --build` | ✅ 并重新构建镜像 | 改了代码必须用这个 |
| `docker compose ps` | 只读 | |
| `docker compose logs -f web` | 只读 | |
| `docker compose restart web` | ⚠️ | 只重启一个服务 |
| `docker compose down` | ⚠️ 删除容器和网络 | **卷保留** |
| `docker compose down -v` | ⚠️⚠️ 删除容器、网络和卷 | **数据没了** |
| `docker compose --env-file .env.prod up -d` | ✅ | 换一份环境变量 |

::: warning

改了代码但 `up -d` 之后行为没变
`docker compose up -d` 发现本地已有同名镜像，**不会重新构建**，会直接用旧镜像继续跑。这解释了绝大多数「我明明改了怎么还是老样子」。

规矩：**代码有改动就 `up -d --build`，或者干脆在开发时用 `docker compose up --build`（前台，日志直接看）。** `restart` 更不会重建镜像，只是重启同一个容器。
:::

::: warning

相对路径是相对 compose 文件，不是相对你当前目录
compose 文件里的 `./data:/var/lib/data`，路径以 **compose 文件所在目录**为基准（Compose V2 的行为）。你在别的目录执行 `docker compose -f ../app/compose.yml up -d`，挂出来的位置和你以为的不一样。

另外 `~` **不会**被展开成家目录，要用 `${HOME}`。**判断句：写死绝对路径，或者用相对路径但心里记住基准是 compose 文件的目录。**
:::

## 排障

**Q1：容器起来就退出，按这个顺序查：**

1. `docker ps -a --filter status=exited` —— 拿到退出码，**退出码已经分类了原因**
2. `docker logs --tail 200 web` —— 应用层错误在这里
3. `docker inspect web | grep -E '"ExitCode"|"Error"|"OOMKilled"'` —— 守护进程层面的错误
4. `docker inspect web | grep -A5 '"State"'` —— 完整状态块
5. 一行日志都没有 + 退出码 137 → 直接按 OOM 处理

**Q2：`docker: permission denied while trying to connect to the Docker daemon socket`**

1. `groups` —— 你在 docker 组里吗
2. `ls -l /var/run/docker.sock` —— 组名是什么（Debian 是 `docker`，RHEL 系可能是 `docker-rootless`）
3. 加完组**必须重开会话**，`newgrp docker` 只对当前 shell 部分生效
4. 确认守护进程在跑：`systemctl status docker`

**Q3：宿主机上什么都正常，容器里 `curl` 一个服务不通？**

1. 容器内服务是不是绑了 `127.0.0.1` —— **容器里的回环地址只有它自己**，必须 `0.0.0.0`
2. 容器在自定义网络里时，用**服务名**而不是 `localhost` 互访：`curl http://db:5432`
3. `docker exec -it web cat /etc/resolv.conf` —— DNS 配置是否正常
4. 两个容器在不同网络里，互相看不见 —— 用 `docker network ls` 和 `docker network inspect` 确认

**Q4：端口明明发布了，宿主机还是连不上？**

1. `ss -tlnp | grep 端口` —— 是不是只监听了 `127.0.0.1`
2. `docker port web` —— 发布规则对不对
3. Docker Desktop 上，宿主机是 Windows/WSL2，`0.0.0.0` 的语义和原生 Linux 不完全一样
4. 前面挂过 Nginx / 防火墙 → 见 [网络排查顺序](/linux/howto/06-network)

**Q5：磁盘满了，怎么定位是 Docker 占的？**

1. `docker system df` —— 镜像、容器、卷、构建缓存各占多少
2. `docker system df -v` —— 精确到每个卷和镜像
3. `docker builder prune` —— 只清构建缓存，通常是最大头
4. **不要直接 `docker system prune -a --volumes`**，先按第 3 节的表逐项判断

## 什么时候别用

- **不要给有状态的东西依赖容器的可写层。** 数据库的数据、用户上传的文件、日志，放容器文件系统里，容器一删就没。放卷，或者放绑定挂载。
- **不要用 `--privileged`。** 它关闭了几乎所有隔离，让容器里的 root 等于宿主机的 root。除非你在跑内核相关的工具，且清楚后果。
- **不要用 `docker run --rm` 跑需要保留现场的任务。** 它退出即删容器，日志、退出码、文件系统全没了。排查阶段的容器要留着，用完再显式 `docker rm`。
- **不要把密钥写进镜像。** `docker history` 能看到每一层的内容。**用 secret、或者至少运行时通过环境变量/挂载传入。**
- **不要在 compose 里用 `latest` 标签。** 它指向的镜像会随时间变化，同一份配置今天和下周跑出来不是同一个东西。用明确的版本号或摘要。
- **不要用容器跑「装一次就长期用」的工具。** 需要持久状态、频繁交互的开发环境，用本机装或者虚拟机更合适。容器的强项是「一次性的、环境一致的、自动重建的」。
- **没有容器运行时需求就不要上。** 单机上跑一个服务时，容器带来的镜像分层、网络桥接、卷权限问题都是净增的复杂度。

## 哪些是通用的

| 这一章的判断 | 换个工具还成立吗 |
| --- | --- |
| 「只读模板 vs 运行实例 vs 独立存储」 | Kubernetes 里的 image / pod / PVC 是同一组概念，Podman 完全兼容这套命令 |
| 「退出码分类原因」 | 任何进程模型都适用，包括 systemd，见 [systemd 排查顺序](/linux/internals/11-systemd) |
| 「状态和日志要分两处查」 | 虚拟机、裸机都一样 |
| 「数据要活过容器就放卷」 | 任何编排系统（K8s 的 PVC） |
| 「默认别发布到所有网卡」 | 云主机的安全组、systemd 的 `ListenAddress` 是同一条规则 |
| 「清理前先看用量构成」 | `docker system df` ≈ 云厂商的账单明细 |

**不通用的是命令名。** `docker-compose`（V1，独立二进制）和 `docker compose`（V2，CLI 插件）不是同一个东西，老文章里的写法可能在你机器上根本不存在。**Podman 大部分命令兼容 Docker，但网络、cgroup、rootless 模式的行为差异足以咬人。** 移植的是「只读模板 / 实例 / 独立存储」这组概念和「先看退出码」的排查顺序，不是命令本身。

## 跑完之后

你能分清镜像、容器、卷的生命周期，并按退出码定位容器为什么没起来。下一章处理运维里最高频的一次人工操作：连上一台机器并且不输密码。

→ [SSH 与密钥：免密登录与主机验证](/linux/internals/13-ssh-key)

## 🎮 实战演练

<ArenaTasks module-id="12-docker" />

<ToyShellTerminal module-id="12-docker" />

## 📝 配套练习

<QuizBlock module-id="12-docker" />
