/**
 * 题库。
 *
 * 27 章各一份。题目按「文档里隐蔽、出错不提示原因、能复现」的标准写，
 * 不收命令字面含义这类一看就会的题。
 *
 * ⚠️ 答案键是逐题核对过的，不要照抄旧站的（旧站有 3 个模块根本没题库）。
 */

import type { QuizQuestion } from '../../theme/components/QuizBlock.vue'
import { LINUX_QUIZZ } from './linux'
import { WINDOWS_QUIZZ } from './windows'

export const QUIZZ: Record<string, QuizQuestion[]> = {
  '01-intro': [
    {
      type: 'choice',
      q: '想一次看清目录里所有文件、包括隐藏文件、大小用 KB 显示，应该用哪条？',
      opts: ['ls -a', 'ls -lh', 'ls -lah', 'ls -R'],
      answer: 2,
      explain: '-l 出详细列，-a 带隐藏文件，-h 让大小列显示成 KB/MB。三个都要才用 ls -lah。注意 -h 单独用没有效果，它只影响 -l 输出的那一列大小。',
    },
    {
      type: 'choice',
      q: 'mkdir a/b/c 提示 No such file or directory，但 a 确实存在。最可能是什么原因？',
      opts: ['a 是个文件不是目录', '磁盘满了', '没有 root 权限', 'c 这个名字已被占用'],
      answer: 0,
      explain: 'mkdir 需要在目录内部再建子目录。a 是普通文件时无法进入它创建子目录，于是报路径不存在。加 -p 也无效 —— -p 只处理「不存在的父目录」，不处理「父路径是文件」。',
    },
    {
      type: 'choice',
      q: '下面哪个组合最危险？',
      opts: ['rm -i file', 'rm -v file', 'rm -rf /', 'rm -d file'],
      answer: 2,
      explain: 'rm -rf / 会从根目录递归删除整个系统。真实 bash 对它有保护会拒绝，但 rm -rf /* 能绕过保护，因为目标不是根目录本身。手动删除一律加 -i。',
    },
    {
      type: 'choice',
      q: '提示符里的 ~ 代表什么？',
      opts: ['当前目录', '上一级目录', '当前用户的家目录', '根目录'],
      answer: 2,
      explain: '~ 展开为当前用户的家目录，Linux 下通常是 /home/用户名，root 是 /root。提示符为省地方只写 ~。真实路径用 pwd 确认。',
    },
    {
      type: 'choice',
      q: 'touch 一个已经存在的文件会发生什么？',
      opts: ['清空文件内容', '把文件删掉重建', '只更新修改时间，内容不变', '报错拒绝执行'],
      answer: 2,
      explain: 'touch 只改时间戳。想清空内容要用 > 重定向或 truncate，语义完全不同，这是最容易误判的一点。',
    },
    {
      type: 'fill',
      q: '想回到上一次所在的目录，应该用：',
      prefix: 'cd',
      answer: '-',
      explain: 'cd - 在当前目录与上一次目录之间反复横跳，靠 $OLDPWD 实现。这是 bash 的特性而非 POSIX 标准，脚本里不要依赖它。',
    },
    {
      type: 'fill',
      q: '删掉当前目录下所有 .log 后缀文件，且不逐个询问：',
      prefix: 'rm',
      suffix: '*.log',
      answer: '-f',
      answerAlt: ['-f', '-rf', '-fr'],
      explain: 'rm -f *.log。-f 是 force，删除时不询问。这里 -f 就够，因为 *.log 匹配的是文件不是目录。',
    },
    {
      type: 'fill',
      q: '一次创建 app、config、test 三个空文件：',
      prefix: 'touch',
      answer: ' app config test',
      answerAlt: ['app config test', 'app.py config.py test.py', 'a b c'],
      explain: 'touch 接受多个文件名参数，空格分隔。touch app config test 一次建三个空文件。',
    },
  ],

  '02-view': [
    {
      type: 'choice',
      q: '打开一个 20 GB 的日志，用哪个命令最安全？',
      opts: ['cat 日志', 'less 日志', 'head 日志', 'wc -l 日志'],
      answer: 1,
      explain: 'less 只读当前显示的那一屏，不会把整个文件读进内存。cat 会全部读出并渲染，此时终端被塞满，你按的 Ctrl+C 会被 cat 吞掉。',
    },
    {
      type: 'choice',
      q: '终端在疯狂滚动输出、什么键都控制不了，第一步该做什么？',
      opts: ['关掉终端窗口', '按 Ctrl+Q', '等它自己结束', '连按多次 Ctrl+C'],
      answer: 1,
      explain: 'Ctrl+Q 是 XON/XOFF 流控，让终端先别接收输出，命令还活着但不再刷屏。之后再 Ctrl+C 真正中断。直接关窗口会丢掉当前会话里其它状态。',
    },
    {
      type: 'choice',
      q: '想实时看日志末尾新增的内容，用哪条？',
      opts: ['cat -f 日志', 'head -f 日志', 'tail -n 100 -f 日志', 'less -f 日志'],
      answer: 2,
      explain: 'head 从文件开头读，开头是固定的，跟随对它没意义。tail 从末尾追加处读，-f 让它一直等新内容。less 的 -f 不是这个语义。',
    },
    {
      type: 'choice',
      q: 'wc -l /etc/hosts 只输出「行数 文件名」。改成 wc /etc/hosts 之后呢？',
      opts: ['完全一样', '多出词数和字节数两列', '只输出字节数', '会报错'],
      answer: 1,
      explain: 'wc 不带参数时三样都数：行数、词数、字节数。带 flag 时输出列数会变，脚本里用 awk 解析时要留意这一点。',
    },
    {
      type: 'fill',
      q: '实时跟随日志最后 100 行：',
      prefix: 'tail',
      answer: ' -n 100 -f /var/log/syslog',
      answerAlt: [' -n 100 -f /var/log/syslog', '-n 100 -f /var/log/syslog', '-f -n 100 /var/log/syslog'],
      explain: 'tail -n 100 -f 文件。-f 会一直等新内容，退出按 Ctrl+C，不是 q（q 是 less 的退出键）。',
    },
    {
      type: 'fill',
      q: '在 less 里搜索关键词 error，应该输入：',
      prefix: '',
      answer: '/error',
      answerAlt: ['/error', '/'],
      explain: 'less 里按 / 然后输入关键词回车，匹配项会高亮，n 跳下一个、N 跳上一个。这是打开大日志的第一件事，比往下滚快得多。',
    },
  ],

  '03-search': [
    {
      type: 'choice',
      q: '在 /etc 下找所有 .conf 结尾的普通文件，-type f 的作用是什么？',
      opts: ['按文件名过滤', '只看普通文件、不看目录', '按大小过滤', '限制搜索深度'],
      answer: 1,
      explain: '-type f 只匹配普通文件。不写 -type 时目录也会匹配进来，然后你会困惑「为什么搜文件名却出来一堆目录」。',
    },
    {
      type: 'choice',
      q: '想在 /etc 下按文件名找 nginx.conf，用 grep 会怎样？',
      opts: ['找到该文件', '报 Is a directory，因为没加 -r', '在文件内容里搜字符串，通常搜不到就返回空', '报权限错误'],
      answer: 2,
      explain: 'grep 搜内容不搜名字。grep nginx.conf /etc 会在每个文件内容里找这串字符，通常一无所获，而且返回空而不是报错 —— 这个静默最容易让人误判成「文件不存在」。',
    },
    {
      type: 'choice',
      q: 'find / -name "*.log" 在文件很多的机器上很慢，最该加什么？',
      opts: ['加 sudo', '-maxdepth 3', '-type f', '-iname'],
      answer: 1,
      explain: '不限深度会遍历整块磁盘，还撞进 /proc 和 /sys 的海量伪文件。-maxdepth 3 绝大多数情况够用。-type f 不解决慢的问题。',
    },
    {
      type: 'choice',
      q: 'grep 没找到匹配时返回的退出码是？为什么重要？',
      opts: ['0，因为没出错', '1', '2', '127'],
      answer: 1,
      explain: '找不到匹配返回 1 而不是 0。脚本里 if grep ...; then 会因此走 else 分支，把「没找到」误当成「出错了」。要区分用 grep -q 并配合退出码判断。',
    },
    {
      type: 'fill',
      q: '递归在目录里搜内容，忽略大小写并显示行号：',
      prefix: 'grep',
      answer: ' -rn -i root /etc',
      answerAlt: [' -rn -i root /etc', '-rn -i root /etc', '-i -rn root /etc', '-rn root /etc'],
      explain: '-r 递归，-i 忽略大小写，-n 显示行号。搜目录不加 -r 会直接报 Is a directory。',
    },
    {
      type: 'fill',
      q: 'find 出的文件很多时，把结果分批喂给 grep -l（用 xargs 避免参数超长）：',
      prefix: 'find /etc -type f -name "*.conf"',
      answer: ' | xargs grep -l "root"',
      answerAlt: [' | xargs grep -l "root"', '| xargs grep -l "root"', ' | xargs grep -l root'],
      explain: '$(find ...) 展开成参数会超长报 Argument list too long。xargs 自动分批传参。',
    },
  ],

  ...LINUX_QUIZZ,
  ...WINDOWS_QUIZZ,
}
