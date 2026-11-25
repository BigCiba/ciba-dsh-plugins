/**
 * Client half of the roblox-dev bundle.
 *
 * Adds one Roblox action to the conversation header that opens a right-sidebar
 * page tab. The tab is a plain page (no resource), so it reads what it needs
 * through the public workspace-file Remote: `package.json` scripts,
 * `roblox-dev.json` groups, and the state file the Host half writes after every
 * `/rb` run. Buttons dispatch `/rb ...` through the public command Remote, so
 * every result also lands in the conversation as a command card.
 */
window.__ModuleLoader__.load({
  id: '@local/roblox-dev',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'robloxDev'
    const TAB_ID = '@local/roblox-dev'
    const KIND = 'roblox-dev'
    const STATE_PATH = '.dsh/roblox-dev/state.json'
    const CONFIG_PATH = 'roblox-dev.json'
    const TASKS_PATH = '.vscode/tasks.json'
    const POLL_MS = 2000

    const en = {
      'meta.label': 'Roblox',
      'meta.hint': 'Run Roblox project tasks, git operations and the Rojo server.',
      'tab.title': 'Roblox dev',
      'section.tasks': 'Tasks',
      'section.git': 'Git',
      'section.rojo': 'Rojo',
      'section.log': 'Last run',
      'status.running': 'Running',
      'status.idle': 'Stopped',
      'status.loading': 'Reading project…',
      'status.noProject': 'No package.json in this workspace yet.',
      'git.branch': 'Branch',
      'git.dirty': 'Changed',
      'git.ahead': 'Ahead',
      'git.behind': 'Behind',
      'git.pull': 'Pull',
      'git.push': 'Push',
      'git.commit': 'Commit',
      'git.commitHint': 'Commit message',
      'git.refresh': 'Refresh status',
      'git.noRepo': 'Not a git repository.',
      'git.unknown': 'Run any task once to read git state.',
      'rojo.start': 'Start server',
      'rojo.stop': 'Stop server',
      'rojo.port': 'Port {port}',
      'task.running': '{label} is running…',
      'task.stop': 'Stop',
      'task.value': 'Value',
      'task.run': 'Run',
      'log.empty': 'Nothing has run from this panel yet.',
      'log.running': 'Running',
      'log.failed': 'Failed',
      'log.done': 'Finished',
      'log.timeout': 'Timed out',
      'error.command': 'Command failed: {reason}',
      'error.read': 'Could not read {path}',
      'hint.flow': 'Results are posted to the conversation as command cards.',
    }
    const zh = {
      'meta.label': 'Roblox',
      'meta.hint': '运行 Roblox 项目的任务、git 操作和 Rojo 服务。',
      'tab.title': 'Roblox 开发',
      'section.tasks': '任务',
      'section.git': 'Git',
      'section.rojo': 'Rojo',
      'section.log': '最近一次运行',
      'status.running': '运行中',
      'status.idle': '未启动',
      'status.loading': '正在读取项目…',
      'status.noProject': '这个工作区里还没有 package.json。',
      'git.branch': '分支',
      'git.dirty': '改动',
      'git.ahead': '领先',
      'git.behind': '落后',
      'git.pull': '拉取',
      'git.push': '推送',
      'git.commit': '提交',
      'git.commitHint': '提交说明',
      'git.refresh': '刷新状态',
      'git.noRepo': '不是 git 仓库。',
      'git.unknown': '运行任意任务一次后显示 git 状态。',
      'rojo.start': '启动服务',
      'rojo.stop': '停止服务',
      'rojo.port': '端口 {port}',
      'task.running': '{label} 运行中…',
      'task.stop': '停止',
      'task.value': '输入值',
      'task.run': '运行',
      'log.empty': '面板还没有运行过任何任务。',
      'log.running': '运行中',
      'log.failed': '失败',
      'log.done': '完成',
      'log.timeout': '超时',
      'error.command': '命令失败：{reason}',
      'error.read': '读取失败：{path}',
      'hint.flow': '结果会作为命令卡片出现在对话里。',
    }

    const CSS = `
      .dsh-rb-button {
        display: inline-flex;
        flex: none;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        padding: 0;
        border: 0;
        border-radius: 28px;
        background: transparent;
        color: var(--dsw-alias-label-secondary);
        cursor: pointer;
        box-sizing: border-box;
      }
      @media (hover: hover) {
        .dsh-rb-button:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
      }
      .dsh-rb-button:focus-visible {
        outline: 2px solid var(--dsw-alias-brand-primary);
        outline-offset: 1px;
      }
      .dsh-rb-panel {
        display: flex;
        flex-direction: column;
        gap: 14px;
        min-height: 100%;
        padding: 14px 14px 22px;
        box-sizing: border-box;
        color: var(--dsw-alias-label-primary);
        font-size: 13px;
        line-height: 18px;
      }
      .dsh-rb-top { display: flex; align-items: center; gap: 8px; }
      .dsh-rb-title { flex: 1 1 auto; min-width: 0; font-weight: 600; font-size: 13px; }
      .dsh-rb-pill {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 2px 8px;
        border-radius: 999px;
        background: var(--dsw-alias-bg-layer-2);
        color: var(--dsw-alias-label-secondary);
        font-size: 11px;
        white-space: nowrap;
      }
      .dsh-rb-pill::before {
        content: '';
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: var(--dsw-alias-state-idle-primary);
      }
      .dsh-rb-pill[data-on='true'] { color: var(--dsw-alias-label-primary); }
      .dsh-rb-pill[data-on='true']::before { background: var(--dsw-alias-state-success-primary); }
      .dsh-rb-section { display: flex; flex-direction: column; gap: 8px; }
      .dsh-rb-head {
        display: flex;
        align-items: center;
        gap: 8px;
        color: var(--dsw-alias-label-secondary);
        font-size: 11px;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }
      .dsh-rb-chips { display: flex; flex-wrap: wrap; gap: 6px; }
      .dsh-rb-chip {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        max-width: 100%;
        padding: 5px 10px;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 8px;
        background: var(--dsw-alias-bg-layer-1);
        color: var(--dsw-alias-label-primary);
        font: inherit;
        font-size: 12px;
        line-height: 16px;
        cursor: pointer;
        text-align: left;
        box-sizing: border-box;
      }
      @media (hover: hover) {
        .dsh-rb-chip:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2); }
      }
      .dsh-rb-chip:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
      .dsh-rb-chip:disabled { opacity: 0.55; cursor: default; }
      .dsh-rb-chip[data-primary='true'] { border-color: var(--dsw-alias-brand-primary); }
      .dsh-rb-chip[data-group='true'] { font-weight: 500; }
      .dsh-rb-group { display: flex; flex-direction: column; gap: 6px; }
      .dsh-rb-input {
        flex: 1 1 auto;
        min-width: 0;
        height: 28px;
        padding: 0 8px;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 8px;
        background: var(--dsw-alias-bg-base);
        color: var(--dsw-alias-label-primary);
        font: inherit;
        font-size: 12px;
        box-sizing: border-box;
      }
      .dsh-rb-input:focus { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
      .dsh-rb-tasklabel {
        flex: 0 1 auto;
        min-width: 0;
        max-width: 46%;
        overflow: hidden;
        color: var(--dsw-alias-label-secondary);
        font-size: 12px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .dsh-rb-row { display: flex; align-items: center; gap: 6px; }
      .dsh-rb-meta { color: var(--dsw-alias-label-secondary); font-size: 12px; }
      .dsh-rb-grid { display: flex; flex-wrap: wrap; gap: 10px 16px; }
      .dsh-rb-stat { display: flex; flex-direction: column; gap: 1px; min-width: 48px; }
      .dsh-rb-stat b { font-weight: 600; font-variant-numeric: tabular-nums; }
      .dsh-rb-stat span { color: var(--dsw-alias-label-secondary); font-size: 11px; }
      .dsh-rb-note { color: var(--dsw-alias-label-secondary); font-size: 11px; }
      .dsh-rb-error {
        padding: 6px 8px;
        border-radius: 8px;
        background: var(--dsw-alias-bg-layer-2);
        color: var(--dsw-alias-state-error-primary);
        font-size: 12px;
        white-space: pre-wrap;
        word-break: break-word;
      }
      .dsh-rb-log {
        max-height: 230px;
        margin: 0;
        padding: 8px 10px;
        border-radius: 8px;
        background: var(--dsw-alias-bg-layer-2);
        color: var(--dsw-alias-label-secondary);
        font-family: var(--dsw-font-family-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
        font-size: 11px;
        line-height: 16px;
        white-space: pre-wrap;
        word-break: break-word;
        overflow: auto;
      }
      .dsh-rb-empty { color: var(--dsw-alias-label-secondary); font-size: 12px; }
    `

    /** A compact glyph for the header action. */
    function RobloxIcon() {
      return h('svg', { viewBox: '0 0 16 16', width: 16, height: 16, 'aria-hidden': 'true', focusable: 'false' },
        h('rect', {
          x: 2.2, y: 2.2, width: 11.6, height: 11.6, rx: 3,
          fill: 'none', stroke: 'currentColor', strokeWidth: 1.3,
        }),
        h('path', { d: 'M6.1 5.3 9.2 7 6.1 8.7Z', fill: 'currentColor' }),
        h('path', {
          d: 'M9.6 10.2h2.2', fill: 'none', stroke: 'currentColor',
          strokeWidth: 1.3, strokeLinecap: 'round',
        }),
      )
    }

    /** Header action that reveals the panel tab for the current Session. */
    function RobloxButton({ t, open }) {
      return h('button', {
        type: 'button',
        className: 'dsh-rb-button',
        'data-roblox-dev': 'action',
        title: t('meta.hint'),
        'aria-label': t('meta.label'),
        onClick: () => { open() },
      }, h(RobloxIcon))
    }

    /** A group of tasks that expands in place, so no popover geometry is needed. */
    function TaskGroup({ label, items, busy, onRun }) {
      const [open, setOpen] = React.useState(false)
      return h('div', { className: 'dsh-rb-group' },
        h('button', {
          type: 'button',
          className: 'dsh-rb-chip',
          'data-group': 'true',
          'aria-expanded': open ? 'true' : 'false',
          onClick: () => { setOpen(value => !value) },
        }, `${label} ${open ? '▾' : '▸'}`),
        open
          ? h('div', { className: 'dsh-rb-chips' }, items.map(item => h('button', {
            key: item.label,
            type: 'button',
            className: 'dsh-rb-chip',
            disabled: busy !== null,
            onClick: () => { onRun(item.value) },
          }, item.label)))
          : null,
      )
    }

    /** A promptString task: one value, then run. */
    function PromptTask({ t, label, initial, busy, onRun }) {
      const [value, setValue] = React.useState(initial === undefined ? '' : initial)
      const submit = () => {
        if (busy !== null || value.trim() === '') return
        onRun(value.trim())
      }
      return h('div', { className: 'dsh-rb-row' },
        h('span', { className: 'dsh-rb-tasklabel', title: label }, label),
        h('input', {
          className: 'dsh-rb-input',
          type: 'text',
          value,
          placeholder: t('task.value'),
          'aria-label': label,
          onChange: (event) => { setValue(event.target.value) },
          onKeyDown: (event) => { if (event.key === 'Enter') submit() },
        }),
        h('button', {
          type: 'button', className: 'dsh-rb-chip', 'data-primary': 'true',
          disabled: busy !== null || value.trim() === '',
          onClick: submit,
        }, t('task.run')),
      )
    }

    /** Turn VSCode's JSONC tasks file into panel descriptors. */
    function describeVscodeTasks(text) {
      let parsed
      try {
        parsed = JSON.parse(text.replace(/^\s*\/\/.*$/gm, ''))
      } catch (_invalid) {
        return undefined
      }
      const tasks = Array.isArray(parsed.tasks) ? parsed.tasks : []
      const inputs = Array.isArray(parsed.inputs) ? parsed.inputs : []
      const described = []
      for (const task of tasks) {
        if (task === null || typeof task !== 'object' || typeof task.label !== 'string') continue
        const all = [task.command === undefined ? '' : String(task.command), ...(Array.isArray(task.args) ? task.args.map(String) : [])].join(' ')
        const id = /\$\{input:([^}]+)\}/.exec(all)
        if (id === null) {
          described.push({ label: task.label })
          continue
        }
        const input = inputs.find(entry => entry !== null && typeof entry === 'object' && entry.id === id[1])
        if (input === undefined) {
          described.push({ label: task.label })
        } else if (input.type === 'pickString') {
          const options = (Array.isArray(input.options) ? input.options : []).map(option => typeof option === 'string'
            ? { label: option, value: option }
            : { label: option.label === undefined ? String(option.value) : option.label, value: option.value })
          described.push({ label: task.label, pick: options })
        } else if (input.type === 'promptString') {
          described.push({ label: task.label, text: typeof input.default === 'string' ? input.default : '' })
        } else {
          described.push({ label: task.label })
        }
      }
      return described
    }

    /** One page tab body: tasks, git, Rojo and the last run's tail. */
    function RobloxPanel({ t, sessionId, commands, files }) {
      // The translator identity may change with the locale; keep the polling
      // effect keyed only by the Session so a render cannot restart it.
      const tRef = React.useRef(t)
      tRef.current = t

      const [status, setStatus] = React.useState(null)
      const [scripts, setScripts] = React.useState([])
      const [vscodeTasks, setVscodeTasks] = React.useState(undefined)
      const [config, setConfig] = React.useState(null)
      const [error, setError] = React.useState(null)
      const [busy, setBusy] = React.useState(null)
      const [message, setMessage] = React.useState('')
      const alive = React.useRef(true)
      const lifetime = React.useRef(new AbortController())

      /** Read one UTF-8 workspace file, returning undefined when it is absent. */
      const readText = React.useCallback(async (relative) => {
        const remote = files()
        if (remote === undefined) return undefined
        try {
          const result = await remote.read(sessionId, relative, {}, lifetime.current.signal)
          return result.ok ? result.value.text : undefined
        } catch (_failure) {
          return undefined
        }
      }, [files, sessionId])

      const refreshStatus = React.useCallback(async () => {
        const text = await readText(STATE_PATH)
        if (!alive.current) return
        if (text === undefined) {
          setStatus(null)
          return
        }
        try {
          setStatus(JSON.parse(text))
        } catch (_invalid) {
          // A half-written or hand-edited file must not flip the panel to idle.
        }
      }, [readText])

      const loadProject = React.useCallback(async () => {
        const [packageText, configText, tasksText] = await Promise.all([
          readText('package.json'),
          readText(CONFIG_PATH),
          readText(TASKS_PATH),
        ])
        if (!alive.current) return
        let names = []
        if (packageText !== undefined) {
          try {
            const parsed = JSON.parse(packageText)
            if (parsed.scripts !== null && typeof parsed.scripts === 'object') names = Object.keys(parsed.scripts)
          } catch (_invalid) {
            setError(tRef.current('error.read', { path: 'package.json' }))
          }
        }
        setScripts(names)
        setVscodeTasks(tasksText === undefined ? undefined : describeVscodeTasks(tasksText))
        if (configText === undefined) {
          setConfig(null)
          return
        }
        try {
          const parsed = JSON.parse(configText)
          setConfig(parsed !== null && typeof parsed === 'object' ? parsed : null)
        } catch (_invalid) {
          setConfig(null)
          setError(tRef.current('error.read', { path: CONFIG_PATH }))
        }
      }, [readText])

      React.useEffect(() => {
        alive.current = true
        const controller = new AbortController()
        lifetime.current = controller
        void loadProject()
        void refreshStatus()
        const timer = window.setInterval(() => { void refreshStatus() }, POLL_MS)
        return () => {
          alive.current = false
          controller.abort()
          window.clearInterval(timer)
        }
      }, [loadProject, refreshStatus])

      /** Re-read project files and panel state without posting a command card. */
      const refreshAll = React.useCallback(async () => {
        await Promise.all([loadProject(), refreshStatus()])
      }, [loadProject, refreshStatus])

      /** Dispatch one `/rb` line and refresh the state file when it settles. */
      const run = React.useCallback(async (line, label) => {
        if (busy !== null) return
        setBusy(label)
        setError(null)
        try {
          const remote = commands()
          if (remote === undefined) throw new Error('command channel unavailable')
          const result = await remote.execute(sessionId, line, [])
          if (!result.ok) {
            setError(tRef.current('error.command', { reason: `${result.error.code}: ${result.error.message}` }))
          }
        } catch (failure) {
          setError(tRef.current('error.command', { reason: failure instanceof Error ? failure.message : String(failure) }))
        } finally {
          if (alive.current) setBusy(null)
          void loadProject()
          void refreshStatus()
        }
      }, [busy, commands, loadProject, refreshStatus, sessionId])

      /** Ask the Host half to kill the task this panel started. */
      const stopTask = async () => {
        const remote = commands()
        if (remote === undefined) return
        try {
          await remote.execute(sessionId, '/rb cancel', [])
        } catch (_failure) {
          // The task can settle between the click and the cancel.
        }
        void refreshStatus()
      }

      const submitCommit = () => {
        const text = message.trim()
        if (text === '' || busy !== null) return
        void run(`/rb git commit -m ${text}`, t('git.commit'))
      }

      const menus = config !== null && Array.isArray(config.menus) ? config.menus : []
      const flat = config !== null && Array.isArray(config.tasks) ? config.tasks : []
      const fallback = scripts.map(name => ({ label: name, script: name }))
      const tasks = flat.length > 0 || menus.length > 0 ? flat : fallback
      const git = status === null || status.git == null ? undefined : status.git
      const rojo = status === null || status.rojo == null
        ? { running: false, port: config === null || config.port === undefined ? 34872 : config.port }
        : status.rojo
      const last = status === null || status.lastTask == null ? undefined : status.lastTask
      const running = busy !== null || (last !== undefined && last.status === 'running')

      /**
       * Task entries come from `.vscode/tasks.json` first (the same file the
       * VSCode extension surfaced), then `roblox-dev.json`, then every
       * package.json script. Consecutive plain tasks share one chip row.
       */
      const vscodeEntries = Array.isArray(vscodeTasks) ? vscodeTasks : []
      const taskNodes = []
      if (vscodeEntries.length > 0) {
        let batch = []
        const flush = () => {
          if (batch.length === 0) return
          taskNodes.push(h('div', { key: `batch-${taskNodes.length}`, className: 'dsh-rb-chips' }, batch))
          batch = []
        }
        for (const entry of vscodeEntries) {
          const runWith = value => { void run(`/rb task ${entry.label} § ${value}`, entry.label) }
          if (Array.isArray(entry.pick)) {
            flush()
            taskNodes.push(h(TaskGroup, {
              key: entry.label,
              label: entry.label,
              items: entry.pick,
              busy,
              onRun: runWith,
            }))
          } else if (entry.text !== undefined) {
            flush()
            taskNodes.push(h(PromptTask, {
              key: entry.label,
              t,
              label: entry.label,
              initial: entry.text,
              busy,
              onRun: runWith,
            }))
          } else {
            batch.push(h('button', {
              key: entry.label,
              type: 'button',
              className: 'dsh-rb-chip',
              disabled: busy !== null,
              onClick: () => { void run(`/rb task ${entry.label}`, entry.label) },
            }, entry.label))
          }
        }
        flush()
      } else {
        for (const menu of menus) {
          taskNodes.push(h(TaskGroup, {
            key: menu.label,
            label: menu.label,
            items: (Array.isArray(menu.items) ? menu.items : []).map(item => ({ label: item.label, value: item.script })),
            busy,
            onRun: script => { void run(`/rb run ${script}`, script) },
          }))
        }
        if (tasks.length > 0) {
          taskNodes.push(h('div', { key: 'scripts', className: 'dsh-rb-chips' }, tasks.map(task => h('button', {
            key: `${task.label}-${task.script}`,
            type: 'button',
            className: 'dsh-rb-chip',
            disabled: busy !== null,
            onClick: () => { void run(`/rb run ${task.script}`, task.label) },
          }, task.label))))
        }
      }

      return h('div', { className: 'dsh-rb-panel', 'data-roblox-dev': 'panel' },
        h('style', null, CSS),

        h('div', { className: 'dsh-rb-top' },
          h('span', { className: 'dsh-rb-title' }, t('tab.title')),
          h('span', { className: 'dsh-rb-pill', 'data-on': rojo.running ? 'true' : 'false' },
            rojo.running ? t('status.running') : t('status.idle')),
        ),

        error === null ? null : h('div', { className: 'dsh-rb-error', role: 'alert' }, error),

        h('div', { className: 'dsh-rb-section' },
          h('div', { className: 'dsh-rb-head' }, t('section.tasks')),
          taskNodes.length === 0 && scripts.length === 0
            ? h('div', { className: 'dsh-rb-empty' }, t('status.noProject'))
            : taskNodes,
          running
            ? h('div', { className: 'dsh-rb-row' },
              h('span', { className: 'dsh-rb-note' }, t('task.running', { label: busy === null && last !== undefined ? last.label : busy })),
              h('button', {
                type: 'button', className: 'dsh-rb-chip', 'data-primary': 'true',
                onClick: () => { void stopTask() },
              }, t('task.stop')),
            )
            : h('div', { className: 'dsh-rb-note' }, t('hint.flow')),
        ),

        h('div', { className: 'dsh-rb-section' },
          h('div', { className: 'dsh-rb-head' }, t('section.git')),
          git === undefined
            ? h('div', { className: 'dsh-rb-note' }, status === null ? t('git.unknown') : t('git.noRepo'))
            : h('div', { className: 'dsh-rb-grid' },
              h('span', { className: 'dsh-rb-stat' }, h('b', null, git.branch), h('span', null, t('git.branch'))),
              h('span', { className: 'dsh-rb-stat' }, h('b', null, String(git.dirty)), h('span', null, t('git.dirty'))),
              h('span', { className: 'dsh-rb-stat' }, h('b', null, String(git.ahead)), h('span', null, t('git.ahead'))),
              h('span', { className: 'dsh-rb-stat' }, h('b', null, String(git.behind)), h('span', null, t('git.behind'))),
            ),
          h('div', { className: 'dsh-rb-chips' },
            h('button', {
              type: 'button', className: 'dsh-rb-chip', disabled: busy !== null,
              onClick: () => { void run('/rb git pull', t('git.pull')) },
            }, t('git.pull')),
            h('button', {
              type: 'button', className: 'dsh-rb-chip', disabled: busy !== null,
              onClick: () => { void run('/rb git push', t('git.push')) },
            }, t('git.push')),
            h('button', {
              type: 'button', className: 'dsh-rb-chip',
              onClick: () => { void refreshAll() },
            }, t('git.refresh')),
          ),
          h('div', { className: 'dsh-rb-row' },
            h('input', {
              className: 'dsh-rb-input',
              type: 'text',
              value: message,
              placeholder: t('git.commitHint'),
              'aria-label': t('git.commitHint'),
              onChange: (event) => { setMessage(event.target.value) },
              onKeyDown: (event) => { if (event.key === 'Enter') submitCommit() },
            }),
            h('button', {
              type: 'button', className: 'dsh-rb-chip', 'data-primary': 'true',
              disabled: busy !== null || message.trim() === '',
              onClick: submitCommit,
            }, t('git.commit')),
          ),
        ),

        h('div', { className: 'dsh-rb-section' },
          h('div', { className: 'dsh-rb-head' }, t('section.rojo')),
          h('div', { className: 'dsh-rb-chips' },
            h('button', {
              type: 'button', className: 'dsh-rb-chip', disabled: busy !== null || rojo.running,
              onClick: () => { void run('/rb serve', t('rojo.start')) },
            }, t('rojo.start')),
            h('button', {
              type: 'button', className: 'dsh-rb-chip', disabled: !rojo.running,
              onClick: () => { void run('/rb stop', t('rojo.stop')) },
            }, t('rojo.stop')),
            h('span', { className: 'dsh-rb-note' }, t('rojo.port', { port: rojo.port })),
          ),
        ),

        h('div', { className: 'dsh-rb-section' },
          h('div', { className: 'dsh-rb-head' }, t('section.log')),
          last === undefined
            ? h('div', { className: 'dsh-rb-empty' }, t('log.empty'))
            : h(React.Fragment, null,
              h('div', { className: 'dsh-rb-meta' },
                `${last.label} · ${
                  last.status === 'running'
                    ? t('log.running')
                    : last.timedOut === true
                      ? t('log.timeout')
                      : last.status === 'failed'
                        ? `${t('log.failed')}${last.exitCode === undefined ? '' : ` (${last.exitCode})`}`
                        : t('log.done')
                }`),
              h('pre', { className: 'dsh-rb-log' }, last.tail === '' ? '—' : last.tail),
            ),
        ),
      )
    }

    /** Module entry: register the tab type, its body, and the header action. */
    return {
      inject: ['slots', 'locale', 'remote', 'sidebarRight', 'sidebarRightTabs'],
      apply(ctx) {
        const t = ctx.locale.bind(NS)
        ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'roblox-dev: dictionaries')

        ctx.effect(() => ctx.sidebarRightTabs.register({
          id: TAB_ID,
          kind: KIND,
          priority: 'extension',
          title: () => t('tab.title'),
        }), 'roblox-dev: tab type')

        /** Bind the Host Remote namespaces once; the panel only calls through them. */
        const commands = () => ctx.remote.commands
        const files = () => ctx.remote.workspaceFiles
        const Panel = props => h(RobloxPanel, { ...props, commands, files })

        ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
          name: 'sidebar.right.pane.tab',
          key: TAB_ID,
          locale: NS,
        }, Panel)), 'roblox-dev: panel body')

        ctx.effect(() => ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
          name: 'conversation.session.header.utilities',
          id: 'roblox-dev',
          order: 4,
          locale: NS,
          inject: () => ({ open: () => { ctx.sidebarRight.openTab(KIND) } }),
        }, RobloxButton)), 'roblox-dev: header action')
      },
    }
  },
})
