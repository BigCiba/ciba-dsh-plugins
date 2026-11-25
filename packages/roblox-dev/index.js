/**
 * Host half of the roblox-dev bundle.
 *
 * The Web half can only reach Host work through a registered command, so this
 * module owns one `/rb` command that runs npm scripts, git operations and the
 * Rojo dev server against the Session's working directory. It also writes a
 * small state file under `.dsh/roblox-dev/` that the panel polls through the
 * workspace-file Remote, which is why the panel can show live-ish status
 * without a private RPC channel.
 */
import { spawn, execFile } from 'node:child_process'
import { mkdir, readFile, writeFile, rename, copyFile, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import os from 'node:os'

/** Relative directory (inside the Session workspace) that owns panel state. */
const STATE_DIR = path.join('.dsh', 'roblox-dev')
const STATE_FILE = 'state.json'
const CONFIG_FILE = 'roblox-dev.json'
const TASKS_FILE = path.join('.vscode', 'tasks.json')
/** Longest single command output kept in the panel state. */
const MAX_OUTPUT = 200_000
const DEFAULT_TASK_TIMEOUT_MS = 15 * 60 * 1000
const MIN_TASK_TIMEOUT_MS = 30_000
const MAX_TASK_TIMEOUT_MS = 60 * 60 * 1000
const DEFAULT_PORT = 34872

const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g

/** Every child this plugin spawned and has not reaped; unload kills them. */
const liveChildren = new Set()

export const inject = ['commands']

/**
 * Register the bundle's only command and the Rojo lifetime.
 * @param {object} ctx - Cordis plugin context.
 */
export function apply(ctx) {
  /** The one Rojo child this plugin owns; unload stops it. */
  const rojo = { child: undefined, port: DEFAULT_PORT, cwd: undefined, startedAt: 0, tail: '' }
  /** Last task per project directory, so one project never shows another's run. */
  const tasks = new Map()
  /** Last git snapshot per project directory. */
  const gits = new Map()
  /** The npm/git child a `/rb cancel` would stop, if any. */
  let activeTask
  let activeCwd
  /** Long-running VSCode tasks (watch/dev) started in the background, per project. */
  const background = new Map()

  const stateFor = cwd => {
    const task = tasks.get(cwd)
    return {
      updatedAt: Date.now(),
      cwd,
      rojo: {
        running: rojo.child !== undefined && rojo.cwd === cwd,
        pid: rojo.child !== undefined && rojo.cwd === cwd ? rojo.child.pid : undefined,
        port: rojo.port,
        startedAt: rojo.startedAt,
        tail: rojo.cwd === cwd ? rojo.tail : '',
      },
      git: gits.get(cwd),
      lastTask: task,
    }
  }

  const stopRojo = () => {
    if (rojo.child === undefined) return false
    const pid = rojo.child.pid
    const cwd = rojo.cwd
    rojo.child = undefined
    rojo.cwd = undefined
    rojo.tail = ''
    killTree(pid)
    if (cwd !== undefined) void writeState(cwd)
    return true
  }

  ctx.effect(() => () => {
    stopRojo()
    if (activeTask !== undefined) killTree(activeTask.pid)
    for (const entry of background.values()) killTree(entry.child.pid)
    for (const child of liveChildren) killTree(child.pid)
  }, 'roblox-dev: stop children when the plugin unloads')

  ctx.effect(() => ctx.commands.register({
    name: 'rb',
    description: 'Roblox 开发：运行 npm 脚本、git 操作、Rojo 服务、安装 Studio 插件',
    input: { hint: '<list|run|task|git|serve|stop|cancel|status|install> ...' },
    handler: invocation => handle(
      invocation.agent,
      invocation.rawInput === undefined ? '' : String(invocation.rawInput),
    ),
  }), 'roblox-dev: /rb command')

  /**
   * Resolve the Session directory the command should operate on.
   * @param {object} agent - receiving agent.
   * @returns {Promise<string>} absolute working directory.
   */
  async function cwdOf(agent) {
    const workingDirectory = typeof ctx.get === 'function' ? ctx.get('workingDirectory') : undefined
    try {
      if (workingDirectory !== undefined && agent !== undefined && agent.session !== undefined) {
        if (typeof workingDirectory.ensure === 'function') return await workingDirectory.ensure(agent)
        return workingDirectory.get(agent.session)
      }
    } catch (error) {
      console.warn('[roblox-dev] working directory unavailable', error)
    }
    throw new Error('读不到当前会话的工作目录；请在一个工作区会话里使用 /rb')
  }

  /**
   * Dispatch one `/rb` line and normalize failures into command results.
   * @param {object} agent - receiving agent.
   * @param {string} rawInput - everything after `/rb`.
   * @returns {Promise<{ kind: 'success' | 'error', text: string }>}
   */
  async function handle(agent, rawInput) {
    try {
      const cwd = await cwdOf(agent)
      const config = await readConfig(cwd)
      const [verb, ...rest] = rawInput.trim().split(/\s+/).filter(part => part !== '')
      switch (verb === undefined ? 'status' : verb) {
        case 'list': return { kind: 'success', text: await listScripts(cwd) }
        case 'run': return await runScript(cwd, rest.join(' '), config)
        case 'task': return await runTask(cwd, rest.join(' '), config)
        case 'git': return await git(cwd, rest)
        case 'serve': return await serve(cwd, rest[0], config)
        case 'stop': return await stop(cwd)
        case 'cancel': return await cancel(cwd)
        case 'status': return await status(cwd)
        case 'install': return await install(cwd, config, rest.join(' '))
        default:
          return { kind: 'error', text: `未知子命令 ${verb}，可用：list run task git serve stop cancel status install` }
      }
    } catch (error) {
      console.error('[roblox-dev] command failed', error)
      return { kind: 'error', text: `执行失败：${describe(error)}` }
    }
  }

  /** Refresh state and render a short status card. */
  async function status(cwd) {
    gits.set(cwd, await gitSummary(cwd))
    await writeState(cwd)
    const scripts = await scriptNames(cwd)
    const git = gits.get(cwd)
    const task = tasks.get(cwd)
    const running = rojo.child !== undefined && rojo.cwd === cwd
    const lines = [
      `目录：${cwd}`,
      `Rojo：${running ? `运行中（端口 ${rojo.port}，pid ${rojo.child.pid}）` : '未启动'}`,
      git === undefined ? 'Git：不是 git 仓库' : `Git：${git.branch} · 改动 ${git.dirty} · 领先 ${git.ahead} · 落后 ${git.behind}`,
      `可运行脚本：${scripts.length === 0 ? '（package.json 里没有 scripts）' : scripts.slice(0, 20).join('、')}`,
    ]
    if (task !== undefined) lines.push(`最近任务：${task.label} · ${task.status}`)
    return { kind: 'success', text: lines.join('\n') }
  }

  /** List the project's VSCode tasks and npm scripts. */
  async function listScripts(cwd) {
    const file = await readTasksFile(cwd)
    const lines = []
    if (file !== undefined && file.tasks.length > 0) {
      lines.push('VSCode 任务（.vscode/tasks.json）：')
      for (const task of file.tasks) lines.push(`  /rb task ${task.label}`)
    }
    const scripts = await scriptNames(cwd)
    if (scripts.length > 0) {
      lines.push('npm 脚本：')
      for (const name of scripts) lines.push(`  /rb run ${name}`)
    }
    if (lines.length === 0) {
      return `${path.join(cwd, 'package.json')} 里没有 scripts，也没有 .vscode/tasks.json。`
    }
    return lines.join('\n')
  }

  /**
   * Run one task from `.vscode/tasks.json`.
   *
   * The line is `<label>` or `<label> § <input value>`; the value answers the
   * task's single `${input:…}` placeholder, which is what the VSCode extension
   * surfaced as a dropdown or a text prompt.
   * @param {string} cwd - project directory.
   * @param {string} line - label plus optional input value.
   * @param {object} config - parsed roblox-dev.json.
   */
  async function runTask(cwd, line, config) {
    const separator = line.indexOf(' § ')
    const label = (separator === -1 ? line : line.slice(0, separator)).trim()
    const value = separator === -1 ? undefined : line.slice(separator + 3).trim()
    if (label === '') return { kind: 'error', text: '用法：/rb task <tasks.json 里的 label>' }
    const file = await readTasksFile(cwd)
    if (file === undefined) {
      return { kind: 'error', text: `没找到 ${path.join(cwd, TASKS_FILE)}。` }
    }
    const definition = file.tasks.find(task => task.label === label)
    if (definition === undefined) {
      return {
        kind: 'error',
        text: `没有 label 为「${label}」的任务。可用的：\n${file.tasks.map(task => `  ${task.label}`).join('\n')}`,
      }
    }
    let resolved
    try {
      resolved = resolveTask(definition, file.inputs, value, cwd)
    } catch (error) {
      return { kind: 'error', text: describe(error) }
    }
    if (isBackgroundTask(definition, resolved, config)) {
      return startBackground(cwd, label, resolved)
    }
    const startedAt = Date.now()
    tasks.set(cwd, { label, command: resolved.display, status: 'running', startedAt, tail: '' })
    await writeState(cwd)
    const result = await runProcess(resolved.command, resolved.args, cwd, {
      shell: true,
      timeout: timeoutOf(config),
      onSpawn: child => { activeTask = child; activeCwd = cwd },
    })
    activeTask = undefined
    tasks.set(cwd, {
      label,
      command: resolved.display,
      status: result.code === 0 ? 'success' : 'failed',
      startedAt,
      endedAt: Date.now(),
      exitCode: result.code,
      tail: tail(result.output, 120),
      timedOut: result.timedOut === true,
    })
    gits.set(cwd, await gitSummary(cwd))
    await writeState(cwd)
    return { kind: result.code === 0 ? 'success' : 'error', text: resultText(resolved.display, result, Date.now() - startedAt) }
  }

  /**
   * Run one npm script and publish its tail to the panel state.
   * @param {string} cwd - project directory.
   * @param {string} script - npm script name.
   * @param {object} config - parsed roblox-dev.json.
   */
  async function runScript(cwd, script, config) {
    if (script === '') return { kind: 'error', text: '用法：/rb run <package.json 里的脚本名>' }
    const startedAt = Date.now()
    tasks.set(cwd, { label: script, command: `npm run ${script}`, status: 'running', startedAt, tail: '' })
    await writeState(cwd)
    // npm is a .cmd shim on Windows, so it needs a shell; quote the script name
    // because npm permits spaces and non-ASCII characters in script names.
    const windows = process.platform === 'win32'
    const timeout = timeoutOf(config)
    const result = await runProcess(
      'npm',
      ['run', windows ? `"${script}"` : script],
      cwd,
      { shell: windows, timeout, onSpawn: child => { activeTask = child; activeCwd = cwd } },
    )
    activeTask = undefined
    const endedAt = Date.now()
    const status = result.timedOut ? 'failed' : result.code === 0 ? 'success' : 'failed'
    tasks.set(cwd, {
      label: script,
      command: `npm run ${script}`,
      status,
      startedAt,
      endedAt,
      exitCode: result.code,
      tail: tail(result.output, 120),
      timedOut: result.timedOut === true,
    })
    gits.set(cwd, await gitSummary(cwd))
    await writeState(cwd)
    return { kind: status === 'success' ? 'success' : 'error', text: resultText(`npm run ${script}`, result, endedAt - startedAt) }
  }

  /**
   * Run one allowlisted git subcommand.
   * @param {string} cwd - repository directory.
   * @param {string[]} args - subcommand and arguments.
   */
  async function git(cwd, args) {
    const sub = args[0]
    const allowed = ['status', 'pull', 'push', 'fetch', 'log', 'diff', 'add', 'commit', 'branch', 'rev-parse']
    if (sub === undefined || !allowed.includes(sub)) {
      return { kind: 'error', text: `用法：/rb git <${allowed.join('|')}> ...\n提交示例：/rb git commit -m 说明` }
    }
    if (sub === 'status') {
      gits.set(cwd, await gitSummary(cwd))
      await writeState(cwd)
      const detail = await runProcess('git', ['status', '--short', '--branch'], cwd, { timeout: 20_000 })
      return { kind: 'success', text: detail.output.trim() === '' ? '工作区干净。' : truncate(detail.output.trim(), 8000) }
    }
    if (sub === 'commit') {
      let message = args.slice(1).join(' ').replace(/^-m\s*/, '').trim()
      if (message.length >= 2) {
        const first = message[0]
        const last = message[message.length - 1]
        if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
          message = message.slice(1, -1)
        }
      }
      if (message === '') return { kind: 'error', text: '提交需要说明：/rb git commit -m 说明文字' }
      args = ['commit', '-am', message]
    }
    const startedAt = Date.now()
    tasks.set(cwd, { label: `git ${sub}`, command: `git ${args.join(' ')}`, status: 'running', startedAt, tail: '' })
    await writeState(cwd)
    const result = await runProcess('git', args, cwd, {
      timeout: sub === 'log' || sub === 'diff' ? 60_000 : 120_000,
      onSpawn: child => { activeTask = child; activeCwd = cwd },
    })
    activeTask = undefined
    tasks.set(cwd, {
      label: `git ${sub}`,
      command: `git ${args.join(' ')}`,
      status: result.code === 0 ? 'success' : 'failed',
      startedAt,
      endedAt: Date.now(),
      exitCode: result.code,
      tail: tail(result.output, 120),
      timedOut: result.timedOut === true,
    })
    gits.set(cwd, await gitSummary(cwd))
    await writeState(cwd)
    return { kind: result.code === 0 ? 'success' : 'error', text: resultText(`git ${args.join(' ')}`, result, Date.now() - startedAt) }
  }

  /**
   * Start the Rojo dev server for this workspace when it is not running.
   * @param {string} cwd - project directory.
   * @param {string | undefined} argument - optional explicit port.
   * @param {object} config - parsed roblox-dev.json.
   */
  async function serve(cwd, argument, config) {
    const candidate = argument === undefined || argument === '' ? config.port : argument
    const port = candidate === undefined ? DEFAULT_PORT : portOf(candidate)
    if (port === undefined) return { kind: 'error', text: '端口无效，应在 1–65535 之间：/rb serve [端口]' }
    if (rojo.child !== undefined) {
      if (rojo.cwd !== cwd) {
        return { kind: 'error', text: `另一个项目的 Rojo 正在运行（${rojo.cwd}，端口 ${rojo.port}）。先在那里执行 /rb stop。` }
      }
      return { kind: 'success', text: `Rojo 已在运行：http://localhost:${rojo.port}（pid ${rojo.child.pid}）` }
    }
    if (await probePort(port)) {
      return { kind: 'error', text: `端口 ${port} 已被其他进程占用。换一个端口：/rb serve ${port + 1}` }
    }
    const child = spawn('rojo', ['serve', '--port', String(port)], {
      cwd,
      shell: true,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    liveChildren.add(child)
    rojo.child = child
    rojo.cwd = cwd
    rojo.port = port
    rojo.startedAt = Date.now()
    rojo.tail = ''
    const append = (chunk) => {
      rojo.tail = truncate(`${rojo.tail}${chunk.toString()}`.replace(ANSI, ''), 8000)
    }
    child.stdout.on('data', append)
    child.stderr.on('data', append)
    child.on('exit', (code) => {
      liveChildren.delete(child)
      if (rojo.child === child) {
        const exitCwd = rojo.cwd
        rojo.child = undefined
        console.log('[roblox-dev] rojo exited with code', code)
        if (exitCwd !== undefined) void writeState(exitCwd)
      }
    })
    child.on('error', (error) => {
      rojo.tail = truncate(`${rojo.tail}\n${describe(error)}`, 8000)
      liveChildren.delete(child)
    })
    const listening = await waitForPort(port, 4000)
    const alive = rojo.child === child
    await writeState(cwd)
    if (listening && alive) {
      return {
        kind: 'success',
        text: `Rojo 已启动：http://localhost:${port}\n在 Studio 里用 Rojo 插件连接这个端口；停掉用 /rb stop。`,
      }
    }
    return {
      kind: 'error',
      text: `Rojo 没有在 ${port} 上监听。\n${truncate(rojo.tail.trim(), 2000)}`,
    }
  }

  /**
   * Stop the Rojo child started for this project.
   * @param {string} cwd - project directory.
   */
  async function stop(cwd) {
    if (rojo.child === undefined || rojo.cwd !== cwd) {
      return { kind: 'error', text: 'Rojo 当前没有在这个项目里运行。' }
    }
    stopRojo()
    await writeState(cwd)
    return { kind: 'success', text: 'Rojo 已停止。' }
  }

  /**
   * Start one watch/dev task in the background and return at once.
   * @param {string} cwd - project directory.
   * @param {string} label - task label.
   * @param {{ command: string, args: string[], display: string }} resolved - resolved invocation.
   */
  async function startBackground(cwd, label, resolved) {
    const existing = background.get(cwd)
    if (existing !== undefined) {
      return { kind: 'error', text: `「${existing.label}」已经在后台运行；先 /rb cancel 停掉它。` }
    }
    const startedAt = Date.now()
    let output = ''
    let timer
    const child = spawn(resolved.command, resolved.args, {
      cwd,
      shell: true,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    liveChildren.add(child)
    const entry = { child, label, startedAt }
    background.set(cwd, entry)
    const flush = () => {
      if (timer !== undefined) return
      timer = setTimeout(() => {
        timer = undefined
        if (background.get(cwd) !== entry) return
        const current = tasks.get(cwd)
        if (current === undefined) return
        tasks.set(cwd, { ...current, tail: truncate(output, 8000) })
        void writeState(cwd)
      }, 1500)
    }
    const append = (chunk) => {
      output = truncate(`${output}${chunk.toString()}`.replace(ANSI, ''), 8000)
      flush()
    }
    child.stdout.on('data', append)
    child.stderr.on('data', append)
    child.on('error', (error) => {
      liveChildren.delete(child)
      output = truncate(`${output}\n${describe(error)}`, 8000)
      flush()
    })
    child.on('exit', (code) => {
      liveChildren.delete(child)
      if (timer !== undefined) clearTimeout(timer)
      if (background.get(cwd) === entry) background.delete(cwd)
      tasks.set(cwd, {
        label,
        command: resolved.display,
        status: code === 0 ? 'success' : 'failed',
        startedAt,
        endedAt: Date.now(),
        exitCode: code,
        tail: truncate(output, 8000),
        timedOut: false,
      })
      void writeState(cwd)
    })
    tasks.set(cwd, { label, command: resolved.display, status: 'running', startedAt, tail: '' })
    await writeState(cwd)
    return {
      kind: 'success',
      text: `已在后台启动：${label}\n${resolved.display}\n面板会显示运行状态和日志尾部；停止用面板「停止」或 /rb cancel。`,
    }
  }

  /**
   * Stop the foreground task or background watcher for this project.
   * @param {string} cwd - project directory.
   */
  async function cancel(cwd) {
    const stopped = []
    if (activeTask !== undefined && activeCwd === cwd) {
      killTree(activeTask.pid)
      stopped.push('前台任务')
    }
    const running = background.get(cwd)
    if (running !== undefined) {
      background.delete(cwd)
      killTree(running.child.pid)
      stopped.push(running.label)
    }
    if (stopped.length === 0) return { kind: 'error', text: '当前没有正在运行的任务。' }
    const current = tasks.get(cwd)
    if (current !== undefined) {
      tasks.set(cwd, { ...current, status: 'failed', endedAt: Date.now(), tail: `${current.tail === undefined ? '' : `${current.tail}\n`}已取消。` })
    }
    await writeState(cwd)
    return { kind: 'success', text: `已取消：${stopped.join('、')}。` }
  }

  /**
   * Copy one Studio plugin file into the local Plugins directory.
   * @param {string} cwd - project directory.
   * @param {object} config - parsed roblox-dev.json.
   * @param {string} argument - explicit file path, may be empty.
   */
  async function install(cwd, config, argument) {
    const target = localPluginsDir()
    await mkdir(target, { recursive: true })
    const candidates = []
    if (argument !== '') candidates.push(argument)
    if (typeof config.studioPlugin === 'string') candidates.push(config.studioPlugin)
    candidates.push('studio-plugins')
    for (const candidate of candidates) {
      const resolved = path.resolve(cwd, candidate)
      if (!existsSync(resolved)) continue
      const files = await rbxmFiles(resolved)
      if (files.length === 0) continue
      const copied = []
      for (const file of files.slice(0, 8)) {
        await copyFile(file, path.join(target, path.basename(file)))
        copied.push(path.basename(file))
      }
      return {
        kind: 'success',
        text: `已安装到 ${target}\n${copied.map(name => `  ${name}`).join('\n')}\n重启 Studio 后生效。`,
      }
    }
    return {
      kind: 'error',
      text: `没找到可安装的 .rbxm。\n用法：/rb install <文件或目录>\n或在 roblox-dev.json 里写 "studioPlugin": "路径/xxx.rbxm"。`,
    }
  }

  /** Persist the panel-visible state next to the project, atomically. */
  async function writeState(cwd) {
    try {
      const dir = path.join(cwd, STATE_DIR)
      await mkdir(dir, { recursive: true })
      // Keep the panel's own state out of the project's git status.
      await writeFile(path.join(dir, '.gitignore'), '*\n', 'utf8')
      const target = path.join(dir, STATE_FILE)
      const temporary = `${target}.tmp`
      await writeFile(temporary, JSON.stringify(stateFor(cwd), null, 2), 'utf8')
      await rename(temporary, target)
    } catch (error) {
      console.warn('[roblox-dev] could not write state', error)
    }
  }
}

/** Read `.vscode/tasks.json`, tolerating absence and comments. */
async function readTasksFile(cwd) {
  try {
    const text = await readFile(path.join(cwd, TASKS_FILE), 'utf8')
    const parsed = JSON.parse(stripJsonComments(text))
    const tasks = Array.isArray(parsed.tasks)
      ? parsed.tasks.filter(task => task !== null && typeof task === 'object' && typeof task.label === 'string')
      : []
    const inputs = Array.isArray(parsed.inputs) ? parsed.inputs : []
    return { tasks, inputs }
  } catch (_missing) {
    return undefined
  }
}

/** Remove // and /* *\/ comments outside strings so VSCode's JSONC parses. */
function stripJsonComments(text) {
  let result = ''
  let inString = false
  let inLine = false
  let inBlock = false
  for (let index = 0; index < text.length; index++) {
    const char = text[index]
    const next = text[index + 1]
    if (inLine) {
      if (char === '\n') { inLine = false; result += char }
      continue
    }
    if (inBlock) {
      if (char === '*' && next === '/') { inBlock = false; index++ }
      continue
    }
    if (inString) {
      result += char
      if (char === '\\') { result += next === undefined ? '' : next; index++ } else if (char === '"') inString = false
      continue
    }
    if (char === '"') { inString = true; result += char; continue }
    if (char === '/' && next === '/') { inLine = true; index++; continue }
    if (char === '/' && next === '*') { inBlock = true; index++; continue }
    result += char
  }
  return result
}

/**
 * Expand one tasks.json definition into a runnable command.
 * @param {object} task - one entry of `tasks`.
 * @param {object[]} inputs - the file's `inputs` array.
 * @param {string | undefined} value - answer for the task's input placeholder.
 * @param {string} cwd - workspace folder.
 * @returns {{ command: string, args: string[], display: string }}
 */
function resolveTask(task, inputs, value, cwd) {
  if (typeof task.command !== 'string' || task.command === '') {
    throw new Error(`任务「${task.label}」没有 command。`)
  }
  const args = Array.isArray(task.args) ? task.args.map(item => String(item)) : []
  const text = [task.command, ...args].join(' ')
  const ids = [...new Set([...text.matchAll(/\$\{input:([^}]+)\}/g)].map(match => match[1]))]
  if (ids.length > 1) throw new Error(`任务「${task.label}」需要多个输入，暂不支持。`)
  let supplied = value
  if (ids.length === 1) {
    const id = ids[0]
    const input = inputs.find(entry => entry !== null && typeof entry === 'object' && entry.id === id)
    if (input === undefined) throw new Error(`任务「${task.label}」引用的 input 「${id}」没有定义。`)
    if (input.type === 'pickString') {
      const options = Array.isArray(input.options) ? input.options : []
      const normalized = options.map(option => typeof option === 'string' ? option : option.value)
      if (supplied === undefined || supplied === '') {
        if (normalized.length === 1) supplied = normalized[0]
        else throw new Error(`请选择一个值：\n${options.map((option, index) => `  ${index + 1}. ${typeof option === 'string' ? option : option.label}`).join('\n')}\n用法：/rb task ${task.label} § <值>`)
      }
      const match = options.find(option => typeof option === 'object' && (option.value === supplied || option.label === supplied))
      if (!normalized.includes(supplied) && match === undefined) {
        throw new Error(`「${supplied}」不是可选值。可选：${normalized.join('、')}`)
      }
      if (match !== undefined) supplied = match.value
    } else if (input.type === 'promptString') {
      if ((supplied === undefined || supplied === '') && typeof input.default === 'string') supplied = input.default
      if (supplied === undefined || supplied === '') {
        throw new Error(`请提供「${input.description === undefined ? id : input.description}」的值。\n用法：/rb task ${task.label} § <值>`)
      }
    } else {
      throw new Error(`不支持 input 类型「${input.type}」。`)
    }
  }
  const expand = (raw) => raw
    .replace(/\$\{workspaceFolder\}/g, cwd)
    .replace(/\$\{input:([^}]+)\}/g, () => supplied === undefined ? '' : supplied)
    .replace(/\$\{env:([^}]+)\}/g, (_all, name) => process.env[name] === undefined ? '' : process.env[name])
  const command = expand(task.command)
  const expanded = args.map(expand)
  const leftover = /\$\{[^}]+\}/.exec([command, ...expanded].join(' '))
  if (leftover !== null) throw new Error(`任务里有暂不支持的占位符：${leftover[0]}`)
  const quoted = expanded.map(arg => /\s/.test(arg) && !/^".*"$/.test(arg) ? `"${arg}"` : arg)
  return {
    command,
    args: quoted,
    display: [command, ...expanded].join(' '),
  }
}

/** Decide whether one task should run in the background instead of blocking. */
function isBackgroundTask(definition, resolved, config) {
  const forced = Array.isArray(config.background) ? config.background : []
  const foreground = Array.isArray(config.foreground) ? config.foreground : []
  if (foreground.includes(definition.label)) return false
  if (forced.includes(definition.label)) return true
  if (definition.isBackground === true) return true
  const text = `${definition.label} ${resolved.display}`
  return /监听|\bwatch\b|--watch/i.test(text)
}

/** Read `roblox-dev.json` from the project, tolerating absence. */
async function readConfig(cwd) {
  try {
    const parsed = JSON.parse(await readFile(path.join(cwd, CONFIG_FILE), 'utf8'))
    return parsed !== null && typeof parsed === 'object' ? parsed : {}
  } catch (_missing) {
    return {}
  }
}

/** Read the package.json script names, tolerating absence. */
async function scriptNames(cwd) {
  try {
    const scripts = JSON.parse(await readFile(path.join(cwd, 'package.json'), 'utf8')).scripts
    if (scripts === null || typeof scripts !== 'object') return []
    return Object.keys(scripts)
  } catch (_missing) {
    return []
  }
}

/** Local Studio plugin directory, honouring LOCALAPPDATA on Windows. */
function localPluginsDir() {
  const local = process.env.LOCALAPPDATA
  if (typeof local === 'string' && local !== '') return path.join(local, 'Roblox', 'Plugins')
  return path.join(os.homedir(), 'AppData', 'Local', 'Roblox', 'Plugins')
}

/** List .rbxm files at one file or directory, bounded. */
async function rbxmFiles(target) {
  if (target.toLowerCase().endsWith('.rbxm')) return [target]
  try {
    const entries = await readdir(target, { withFileTypes: true })
    return entries
      .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.rbxm'))
      .map(entry => path.join(target, entry.name))
  } catch (_missing) {
    return []
  }
}

/**
 * Spawn one process, collect bounded merged output, and enforce a timeout.
 * @returns {Promise<{ code: number | null, output: string, timedOut: boolean }>}
 */
function runProcess(command, args, cwd, options = {}) {
  const timeoutMs = options.timeout === undefined ? DEFAULT_TASK_TIMEOUT_MS : options.timeout
  return new Promise((resolve) => {
    let output = ''
    let timedOut = false
    let child
    try {
      child = spawn(command, args, { cwd, shell: options.shell === true, windowsHide: true })
    } catch (error) {
      resolve({ code: null, output: describe(error), timedOut: false })
      return
    }
    liveChildren.add(child)
    if (typeof options.onSpawn === 'function') options.onSpawn(child)
    const timer = setTimeout(() => {
      timedOut = true
      killTree(child.pid)
    }, timeoutMs)
    const append = (chunk) => {
      output += chunk.toString()
      if (output.length > MAX_OUTPUT) output = output.slice(output.length - MAX_OUTPUT)
    }
    child.stdout.on('data', append)
    child.stderr.on('data', append)
    child.on('error', (error) => {
      liveChildren.delete(child)
      clearTimeout(timer)
      resolve({ code: null, output: `${output}\n${describe(error)}`, timedOut })
    })
    child.on('exit', (code) => {
      liveChildren.delete(child)
      clearTimeout(timer)
      resolve({ code, output, timedOut })
    })
  })
}

/** Kill a process and its children without throwing. */
function killTree(pid) {
  if (pid === undefined) return
  try {
    if (process.platform === 'win32') {
      execFile('taskkill', ['/pid', String(pid), '/T', '/F'], () => undefined)
    } else {
      process.kill(pid, 'SIGTERM')
    }
  } catch (_error) {
    // The process may already be gone; nothing to do.
  }
}

/** One git summary for the panel, or undefined outside a repository. */
async function gitSummary(cwd) {
  const result = await runProcess('git', ['status', '--porcelain=v1', '--branch'], cwd, { timeout: 20_000 })
  if (result.code !== 0) return undefined
  const lines = result.output.split('\n').filter(line => line.trim() !== '')
  const head = lines[0] === undefined ? '' : lines[0]
  const raw = head.replace(/^##\s*/, '')
  let branch = 'HEAD'
  let tracking = ''
  const noCommits = /^No commits yet on (.+)$/.exec(raw)
  if (noCommits !== null) {
    branch = noCommits[1].trim()
  } else {
    const separator = raw.indexOf('...')
    branch = (separator === -1 ? raw : raw.slice(0, separator)).trim()
    tracking = separator === -1 ? '' : raw.slice(separator + 3)
  }
  if (branch === '') branch = 'HEAD'
  const ahead = /ahead (\d+)/.exec(tracking)
  const behind = /behind (\d+)/.exec(tracking)
  return {
    branch,
    dirty: Math.max(0, lines.length - 1),
    ahead: ahead === null ? 0 : Number(ahead[1]),
    behind: behind === null ? 0 : Number(behind[1]),
  }
}

/** Resolve true when something accepts a TCP connection on the port. */
function waitForPort(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  return new Promise((resolve) => {
    const attempt = () => {
      probePort(port).then((open) => {
        if (open) return resolve(true)
        if (Date.now() >= deadline) return resolve(false)
        setTimeout(attempt, 150)
      }, () => resolve(false))
    }
    attempt()
  })
}

/** One short TCP probe that never throws. */
function probePort(port) {
  return new Promise((resolve) => {
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      resolve(false)
      return
    }
    let socket
    try {
      socket = net.connect({ host: '127.0.0.1', port })
    } catch (_failure) {
      resolve(false)
      return
    }
    let settled = false
    const done = (open) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(open)
    }
    socket.setTimeout(400)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
  })
}

/** Format a finished command as a command-card body. */
function resultText(command, result, durationMs) {
  const seconds = (Math.max(0, durationMs) / 1000).toFixed(1)
  const mark = result.timedOut === true ? '超时' : result.code === 0 ? '完成' : `失败（退出码 ${result.code === null ? '?' : result.code}）`
  const body = result.output.replace(ANSI, '').replace(/\r/g, '').trim()
  const tailText = tail(body, 80)
  return `${command} · ${mark} · ${seconds}s${tailText === '' ? '' : `\n\n${tailText}`}`
}

/** Last `count` lines of a text, bounded in size. */
function tail(text, count) {
  const lines = text.split('\n')
  return truncate(lines.slice(Math.max(0, lines.length - count)).join('\n'), 8000)
}

/** Bound a string to `limit` characters, keeping the end. */
function truncate(text, limit) {
  return text.length <= limit ? text : `…${text.slice(text.length - limit)}`
}

/** Resolve one port argument or config value. */
function portOf(value) {
  const parsed = typeof value === 'string' ? Number(value) : value
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535 ? parsed : undefined
}

/** Resolve the task timeout from config, clamped to a sane range. */
function timeoutOf(config) {
  const value = config.taskTimeoutMs
  if (!Number.isInteger(value)) return DEFAULT_TASK_TIMEOUT_MS
  return Math.min(MAX_TASK_TIMEOUT_MS, Math.max(MIN_TASK_TIMEOUT_MS, value))
}

/** Stable one-line description of an unknown error. */
function describe(error) {
  if (error instanceof Error) return error.message
  return String(error)
}
