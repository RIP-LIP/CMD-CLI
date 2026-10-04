/**
 * Linux 线实战任务。
 *
 * 每条 check 接收 (输入行, 执行结果, 当前目录)，返回是否命中。
 * 正则按**真实 shell 语法**写，不迁就旧站 —— 学习者在这里练错会带到真机上。
 */

import type { TaskDef } from './shell-linux'

export const LINUX_TASKS: Record<string, TaskDef[]> = {
  '01-intro': [
    { id: 'pwd', label: '用 pwd 查看当前所在目录', check: (l) => /^\s*pwd\s*$/.test(l) },
    { id: 'ls-etc', label: '用 ls 查看 /etc 目录', check: (l) => /^\s*ls\b.*\/etc/.test(l) || /^\s*ls\s+\/etc\s*$/.test(l) },
    { id: 'mkdir', label: '用 mkdir 创建 /tmp/practice 目录', check: (l) => /^\s*mkdir\b.*\/tmp\/practice/.test(l) },
    { id: 'touch', label: '用 touch 在家目录创建 hello.txt', check: (l) => /^\s*touch\b.*hello\.txt/.test(l) },
  ],

  '02-view': [
    { id: 'cat', label: '用 cat 输出 /etc/hostname 的内容', check: (l) => /^\s*cat\b.*\/etc\/hostname/.test(l) },
    { id: 'head', label: '用 head 只看文件前几行', check: (l) => /^\s*head\b/.test(l) },
    { id: 'tail', label: '用 tail 看文件末尾几行', check: (l) => /^\s*tail\b/.test(l) },
    { id: 'wc', label: '用 wc 统计行数或字节数', check: (l) => /^\s*wc\b/.test(l) },
  ],

  '03-search': [
    { id: 'find', label: '用 find 按文件名查找', check: (l) => /^\s*find\b/.test(l) },
    { id: 'grep', label: '用 grep 在文件内容里搜索', check: (l) => /^\s*grep\b/.test(l) },
    { id: 'cp', label: '用 cp 复制一个文件', check: (l) => /^\s*cp\b/.test(l) },
    { id: 'mv', label: '用 mv 移动或重命名', check: (l) => /^\s*mv\b/.test(l) },
  ],

  '04-permission': [
    { id: 'ls-l', label: '用 ls -l 看文件的权限位', check: (l) => /^\s*ls\b.*-l/.test(l) },
    { id: 'chmod', label: '用 chmod 修改权限', check: (l) => /^\s*chmod\b/.test(l) },
    { id: 'chown', label: '用 chown 修改属主', check: (l) => /^\s*chown\b/.test(l) },
    { id: 'badmode', label: '给 chmod 一个非法权限串，看它怎么报错', check: (l, r) => /^\s*chmod\b/.test(l) && r.exit !== 0 },
  ],

  '05-process': [
    { id: 'ps', label: '用 ps 列出进程', check: (l) => /^\s*ps\b/.test(l) },
    { id: 'top', label: '用 top 看实时资源占用', check: (l) => /^\s*top\b/.test(l) },
    { id: 'kill', label: '用 kill 结束一个进程', check: (l) => /^\s*kill\b/.test(l) },
    { id: 'free', label: '用 free 看内存用量', check: (l) => /^\s*free\b/.test(l) },
    { id: 'df', label: '用 df 看磁盘占用', check: (l) => /^\s*df\b/.test(l) },
  ],

  '11-systemd': [
    { id: 'status', label: '用 systemctl 查看服务状态', check: (l) => /^\s*systemctl\b.*\bstatus\b/.test(l) },
    { id: 'journal', label: '用 journalctl 查看服务日志', check: (l) => /^\s*journalctl\b/.test(l) },
    { id: 'restart', label: '用 systemctl 重启服务', check: (l) => /^\s*systemctl\b.*\b(restart|reload)\b/.test(l) },
    { id: 'failed', label: '用 systemctl --failed 找出所有失败的单元', check: (l) => /--failed/.test(l) },
  ],

  '12-docker': [
    { id: 'ps', label: '用 docker ps 看运行中的容器', check: (l) => /^\s*docker\b.*\bps\b/.test(l) },
    { id: 'images', label: '用 docker images 看本地镜像', check: (l) => /^\s*docker\b.*\bimages\b/.test(l) },
    { id: 'run', label: '用 docker run 跑一个容器', check: (l) => /^\s*docker\b.*\brun\b/.test(l) },
    { id: 'logs', label: '用 docker logs 看容器日志', check: (l) => /^\s*docker\b.*\blogs\b/.test(l) },
    { id: 'compose-up', label: '用 docker compose up -d 拉起一组服务', check: (l) => /^\s*docker\s+compose\b.*\bup\b/.test(l) || /^\s*docker-compose\b.*\bup\b/.test(l) },
  ],

  '14-cron': [
    { id: 'crontab-l', label: '用 crontab -l 查看当前任务', check: (l) => /^\s*crontab\b.*-l/.test(l) },
    { id: 'crontab-e', label: '用 crontab -e 编辑任务', check: (l) => /^\s*crontab\b.*-e/.test(l) },
    { id: 'cron-path', label: '用 export 在脚本里补上 PATH', check: (l) => /^\s*export\s+PATH=/.test(l) },
    { id: 'date', label: '用 date 确认当前时间，验证定时是否触发', check: (l) => /^\s*date\b/.test(l) },
  ],

  '15-acl': [
    { id: 'getfacl', label: '用 getfacl 查看某文件的 ACL', check: (l) => /^\s*getfacl\b/.test(l) },
    { id: 'setfacl-u', label: '用 setfacl 给某个用户单独授权', check: (l) => /^\s*setfacl\b.*-m\b.*\bu:/.test(l) },
    { id: 'setfacl-x', label: '用 setfacl -x 删掉一条 ACL 规则', check: (l) => /^\s*setfacl\b.*-x\b/.test(l) },
    { id: 'ls-plus', label: '用 ls 看到权限位末尾多出的 + 号', check: (l) => /^\s*ls\b/.test(l) },
  ],
}
