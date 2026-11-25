# @local/roblox-dev

把「VSCode 任务面板 + 跑 rojo + git 拉推」搬进 DSH：会话头一个 Roblox 按钮，打开右侧面板；每次操作同时落成对话里的命令卡片，输出可回看。

面板优先读项目里的 **`.vscode/tasks.json`** —— 也就是你现在那排按钮（配置表、导出 Excel、同步 UI 资源、项目检查、开发监听、安装 Studio 插件）在 VSCode 里的来源。所以同一个文件在 DSH 里会变成同一组按钮，不需要另写配置。

## 任务是怎么映射的

| tasks.json 里的写法 | 面板里的样子 |
|---|---|
| 普通 `shell` / `process` 任务 | 一个按钮，点击执行 `command` + `args` |
| `args` 里引用 `pickString` 输入 | 可展开的分组按钮，每个 option 一个子按钮（对应 `配置表 ▾`、`项目检查 ▾`） |
| `args` 里引用 `promptString` 输入 | 一行「标签 + 输入框 + 运行」，默认值取 `input.default` |
| label/命令含 `watch`、`监听` 或 `isBackground: true` | 后台启动，命令卡片立刻返回；面板显示运行中，可随时停止 |
| 没有 `tasks.json` | 退回列出 `package.json` 的全部脚本 |

支持 `${workspaceFolder}`、`${env:NAME}`、`${input:ID}`；其他占位符会直接报错，不会带着字面量去执行。

## 它还带什么

| 面板/命令 | 行为 |
|---|---|
| `拉取 / 推送 / 提交` | 在会话工作目录执行 `git pull` / `git push` / `git commit -am` |
| `启动 / 停止服务` | 托管 `rojo serve --port <端口>`，插件卸载时一并停掉 |
| `/rb install` | 把 `.rbxm` 复制到 `%LOCALAPPDATA%\Roblox\Plugins` |

## 命令

```text
/rb list                          列出 tasks.json 任务和 package.json 脚本
/rb task <label>                  运行一个 VSCode 任务
/rb task <label> § <值>           给任务的 ${input:…} 传值
/rb run <script>                  运行一个 npm 脚本（默认 15 分钟超时，可用 taskTimeoutMs 调）
/rb cancel                        停掉正在跑的 npm / git / 任务子进程
/rb git status|pull|push|fetch    只读/同步类 git 操作
/rb git commit -m 说明            提交（-a，已跟踪文件的改动一起提交）
/rb serve [端口]                  启动 rojo serve
/rb stop                          停止本插件启动的 rojo
/rb status                        刷新目录 / Rojo / Git / 脚本概览
/rb install [文件或目录]          安装 Studio 插件
```

`/rb task` 的名字就是 tasks.json 里的 `label`，含 emoji 也照抄；`§`（前后各一个空格）后面是这次运行要用的输入值。

## 可选覆盖：`roblox-dev.json`

只有当项目里**没有** `.vscode/tasks.json` 时，面板才读这个文件来手工排按钮：

```json
{
  "port": 34872,
  "taskTimeoutMs": 900000,
  "studioPlugin": "studio-plugins/RojoManagedPlugin.rbxm",
  "menus": [
    { "label": "配置表", "items": [{ "label": "同步飞书", "script": "config:pull" }] }
  ],
  "tasks": [{ "label": "同步 UI 资源", "script": "assets:sync" }],
  "background": ["⚙️ 开发监听"],
  "foreground": ["🧩 安装 Studio 插件"]
}
```

## 状态从哪来

Host 半每次执行都写 `.dsh/roblox-dev/state.json`（先写临时文件再改名，目录自带一个只忽略自己的 `.gitignore`，不会弄脏 `git status`）。面板每 2 秒读一次：Rojo 是否在跑、上次任务是运行中/成功/失败、日志尾部。任务进行中会显示「停止」，它发 `/rb cancel` 杀掉那个子进程。

Rojo 和运行中的任务按**项目目录**归属：同一台机器开两个 Roblox 仓库不会互相误停。

## 限制

- 命令卡片是「跑完一次给一段输出」，不是持续滚动的终端；后台任务（watch/监听）的日志只在面板底部。
- 前台任务进行中可从面板「停止」或 `/rb cancel`；后台任务同样。
- 执行目录 = 当前会话的工作目录，所以要在你的 Roblox 仓库里开会话。
- 任务按 label 精确匹配；`dependsOn`、`problemMatcher`、`options.cwd` 不参与执行（cwd 固定为会话工作目录）。
- 子进程由 Plugins 生命周期托管，插件卸载或 DSH 退出后不会留在后台。
- 面板不做权限判断：能打开这个 DSH 页面的人就能操作你的仓库。

## 安装

本机开发：**Plugins → Add plugin → 本地目录**，选 `packages/roblox-dev`，然后重启 DSH。
远程：用 `git+https://github.com/<你>/ciba-dsh-plugins.git#<commit>&path:/packages/roblox-dev` 安装。
