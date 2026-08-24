#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { Writable } from 'node:stream'
import { createInterface, type Interface } from 'node:readline/promises'
import process from 'node:process'
import {
  findInstalledProfiles,
  installedPluginSpec,
  LEGACY_MANAGED_ENV_KEYS,
  migrateLegacyHarnessEnv,
  PROFILE_NAME,
  readHarnessEnv,
  readLocalState,
  resolveDshHome,
  validateWorkspace,
  writeHarnessEnv,
  writeLocalState,
} from './setup/config.ts'
import { askRequired } from './setup/prompt.ts'

interface Options {
  command: 'setup' | 'doctor' | 'start' | 'help' | 'version'
  yes: boolean
  noStart: boolean
  nonInteractive: boolean
  packageSpec?: string
  dshHome?: string
  appId?: string
  allowedOpenIds?: string
  workspace?: string
}

const PACKAGE_NAME = 'dsh-feishu-control'
const ENV = {
  appId: 'FEISHU_CONTROL_APP_ID',
  appSecret: 'FEISHU_CONTROL_APP_SECRET',
  allowedOpenIds: 'FEISHU_CONTROL_ALLOWED_OPEN_IDS',
  workspace: 'FEISHU_CONTROL_WORKSPACE',
  permissionMode: 'FEISHU_CONTROL_PERMISSION_MODE',
} as const
const LEGACY_ENV = {
  appId: 'DSH_FEISHU_APP_ID',
  appSecret: 'DSH_FEISHU_APP_SECRET',
  allowedOpenIds: 'DSH_FEISHU_ALLOWED_OPEN_IDS',
  workspace: 'DSH_FEISHU_WORKSPACE',
  permissionMode: 'DSH_PERMISSION_MODE',
} as const

function configuredValue(values: Record<string, string>, key: string, legacyKey: string): string | undefined {
  return process.env[key] || process.env[legacyKey] || values[key] || values[legacyKey]
}

interface InstallationTarget {
  profile: string
  mode: 'desktop' | 'standalone'
  alreadyInstalled: boolean
  installedSpec?: string
}

async function resolveInstallationTarget(dshHome: string): Promise<InstallationTarget> {
  const profiles = await findInstalledProfiles(dshHome)
  const state = await readLocalState(dshHome)
  const savedProfile = state !== undefined && profiles.includes(state.profile) ? state.profile : undefined
  const profile = savedProfile || profiles[0]
  if (profile !== undefined) {
    const installedSpec = await installedPluginSpec(dshHome, profile)
    return {
      profile,
      mode: state?.profile === profile ? state.mode : profile === PROFILE_NAME ? 'standalone' : 'desktop',
      alreadyInstalled: true,
      ...(installedSpec === undefined ? {} : { installedSpec }),
    }
  }
  return { profile: PROFILE_NAME, mode: 'standalone', alreadyInstalled: false }
}

function isSourceInstall(spec: string): boolean {
  if (spec.startsWith('file:') && spec.endsWith('.tgz')) return false
  return /^(?:link:|file:|git(?:hub)?:|https?:|ssh:)/.test(spec)
}

function shouldInstallCurrentVersion(installation: InstallationTarget, version: string, explicitSpec?: string): boolean {
  if (!installation.alreadyInstalled || explicitSpec !== undefined) return true
  const spec = installation.installedSpec
  if (spec === undefined || isSourceInstall(spec)) return false
  return spec !== version && spec !== `=${version}`
}

function parseArgs(argv: string[]): Options {
  const first = argv[0]
  const command = first === undefined || first.startsWith('-') ? 'setup' : first
  if (!['setup', 'doctor', 'start', 'help', 'version'].includes(command)) {
    throw new Error(`未知命令：${command}。运行 feishu-control --help 查看帮助。`)
  }
  const args = first === command ? argv.slice(1) : argv
  const result: Options = {
    command: command as Options['command'],
    yes: false,
    noStart: false,
    nonInteractive: false,
  }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!
    const take = (): string => {
      const value = args[index + 1]
      if (value === undefined) throw new Error(`${arg} 缺少参数值。`)
      index += 1
      return value
    }
    if (arg === '--yes' || arg === '-y') result.yes = true
    else if (arg === '--no-start') result.noStart = true
    else if (arg === '--non-interactive') result.nonInteractive = true
    else if (arg === '--package-spec') result.packageSpec = take()
    else if (arg === '--dsh-home') result.dshHome = take()
    else if (arg === '--app-id') result.appId = take()
    else if (arg === '--allowed-open-ids') result.allowedOpenIds = take()
    else if (arg === '--workspace') result.workspace = take()
    else if (arg === '--help' || arg === '-h') result.command = 'help'
    else if (arg === '--version' || arg === '-v') result.command = 'version'
    else throw new Error(`未知参数：${arg}`)
  }
  return result
}

class Prompter {
  private muted = false
  private readonly output = new Writable({
    write: (chunk, _encoding, callback) => {
      if (!this.muted) process.stdout.write(chunk)
      callback()
    },
  })
  private readonly rl: Interface = createInterface({ input: process.stdin, output: this.output, terminal: true })

  async text(label: string, defaultValue?: string): Promise<string> {
    const suffix = defaultValue === undefined ? '' : ` [${defaultValue}]`
    const answer = (await this.rl.question(`${label}${suffix}：`)).trim()
    return answer || defaultValue || ''
  }

  async secret(label: string): Promise<string> {
    process.stdout.write(`${label}（输入内容不会显示）：`)
    this.muted = true
    try {
      return (await this.rl.question('')).trim()
    } finally {
      this.muted = false
      process.stdout.write('\n')
    }
  }

  async confirm(label: string, defaultYes = false): Promise<boolean> {
    const hint = defaultYes ? 'Y/n' : 'y/N'
    const answer = (await this.rl.question(`${label} [${hint}]：`)).trim().toLowerCase()
    if (answer === '') return defaultYes
    return answer === 'y' || answer === 'yes' || answer === '是'
  }

  close(): void {
    this.rl.close()
  }
}

function run(command: string, args: string[], options: { cwd?: string, quiet?: boolean, dshHome?: string } = {}): boolean {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.dshHome === undefined ? process.env : { ...process.env, DSH_HOME: options.dshHome },
    encoding: 'utf8',
    stdio: options.quiet ? 'pipe' : 'inherit',
  })
  return result.status === 0
}

function requireCommand(command: string, versionArgs: string[], dshHome?: string): boolean {
  return run(command, versionArgs, dshHome === undefined ? { quiet: true } : { quiet: true, dshHome })
}

async function packageVersion(): Promise<string> {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
  return manifest.version
}

function printHelp(): void {
  process.stdout.write(`dsh-feishu-control 新手向导

用法：
  feishu-control setup     检测插件广场安装并完成配置（默认命令）
  feishu-control doctor    检查当前安装和配置
  feishu-control start     在已保存的工作目录中启动
  feishu-control --help    显示帮助

首次使用（无需克隆仓库）：
  dsh plugin add --save-exact dsh-feishu-control
  pnpm dlx dsh-feishu-control setup

重要：本插件不是 DeepSeek Harness 本体。使用前必须先安装 dsh，
完成 DeepSeek 模型/API 配置，并至少成功启动过一次 DeepSeek Harness。
`)
}

async function askWorkspace(prompter: Prompter, initial: string, dshHome: string): Promise<string> {
  let candidate = initial
  while (true) {
    try {
      return await validateWorkspace(candidate, dshHome)
    } catch (error) {
      process.stdout.write(`无法使用该目录：${(error as Error).message}\n`)
      candidate = await prompter.text('请输入 Agent 可以操作的项目文件夹绝对路径')
    }
  }
}

async function setup(options: Options): Promise<number> {
  const dshHome = resolveDshHome(options.dshHome === undefined ? process.env : { ...process.env, DSH_HOME: options.dshHome })
  process.stdout.write(`
欢迎使用 dsh-feishu-control 新手安装向导
========================================

请先确认：
1. 你已经安装 DeepSeek Harness（终端中可以运行 dsh）。
2. 你已经完成 DeepSeek 模型/API 配置，并至少成功启动过一次 Harness。
3. 本插件会让飞书白名单用户驱动本机 Agent；Agent 可能运行命令、读写文件并消耗 API 额度。

`)

  const migration = await migrateLegacyHarnessEnv(dshHome)
  if (migration.migrated) {
    process.stdout.write('✓ 已将旧版 DSH_FEISHU_* 配置安全迁移为 Harness 兼容名称；已保存的密钥不会显示。\n')
  }

  if (!requireCommand('dsh', ['--version'])) {
    process.stderr.write('未找到可用的 dsh。请先安装并成功运行 DeepSeek Harness，再重新执行本向导。\n')
    return 2
  }
  if (!requireCommand('pnpm', ['--version'])) {
    process.stderr.write('未找到 pnpm。DeepSeek Harness 安装插件需要 pnpm，请先安装后重试。\n')
    return 2
  }
  process.stdout.write('✓ 已检测到 dsh 和 pnpm。\n')

  if (options.nonInteractive) return setupNonInteractive(options, dshHome)
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write('新手向导需要在交互式终端中运行。\n')
    return 2
  }

  const prompter = new Prompter()
  try {
    if (!options.yes && !await prompter.confirm('你是否已经成功启动过 DeepSeek Harness？', true)) {
      process.stdout.write('\n请先运行 dsh，完成 DeepSeek 配置并确认它可以正常工作，然后再次运行本向导。\n')
      return 1
    }

    const installation = await resolveInstallationTarget(dshHome)
    if (installation.alreadyInstalled) {
      process.stdout.write(`✓ 已在 DSH profile “${installation.profile}” 中检测到 ${PACKAGE_NAME}${installation.installedSpec === undefined ? '' : `（${installation.installedSpec}）`}。\n`)
    } else {
      process.stdout.write(`未检测到插件广场安装，将使用独立终端模式创建 DSH profile “${PROFILE_NAME}”。\n`)
    }

    process.stdout.write(`
飞书应用需要完成以下准备：
- 企业自建应用已添加“机器人”能力；
- 使用长连接接收事件；
- 已订阅 im.message.receive_v1 和 card.action.trigger；
- 已开通消息权限、创建版本并发布应用。
详情：https://open.feishu.cn/

`)
    if (!options.yes && !await prompter.confirm('这些飞书设置是否已经完成？')) {
      process.stdout.write('请先在飞书开放平台完成设置，再重新运行本向导。\n')
      return 1
    }

    const current = await readHarnessEnv(dshHome)
    const appId = options.appId?.trim() || await askRequired(
      prompter,
      '请输入飞书 App ID',
      configuredValue(current.values, ENV.appId, LEGACY_ENV.appId),
    )
    let appSecret = configuredValue(current.values, ENV.appSecret, LEGACY_ENV.appSecret) || ''
    if (appSecret !== '' && !await prompter.confirm('检测到已保存的 App Secret，是否继续使用？', true)) appSecret = ''
    appSecret = await askRequired(prompter, '请输入飞书 App Secret', appSecret, true)

    process.stdout.write(`
白名单只允许指定飞书用户驱动 Agent。请输入自己的 open_id（通常以 ou_ 开头）。
如果暂时不知道，可输入 ou_placeholder。安装后启动机器人并私聊它，拒绝消息会显示你的 open_id；
复制该值后再次运行本向导即可更新，不需要编辑配置文件。
`)
    const allowedOpenIds = options.allowedOpenIds?.trim() || await askRequired(
      prompter,
      '请输入允许使用机器人的 open_id；多人用英文逗号分隔',
      configuredValue(current.values, ENV.allowedOpenIds, LEGACY_ENV.allowedOpenIds),
    )
    const workspace = await askWorkspace(prompter, options.workspace || process.cwd(), dshHome)

    const version = await packageVersion()
    const packageSpec = options.packageSpec || `${PACKAGE_NAME}@${version}`
    const installCurrentVersion = shouldInstallCurrentVersion(installation, version, options.packageSpec)

    process.stdout.write(`
即将执行：
${installCurrentVersion
    ? `- 将 ${packageSpec} 精确安装到 DSH profile “${installation.profile}”`
    : `- 保留 DSH profile “${installation.profile}” 中现有安装 ${installation.installedSpec || ''}`}
- 把飞书凭证保存到 ${current.path}（权限仅限当前系统用户）
- 将 Agent 工作目录限制为 ${workspace}

注意：这是 DeepSeek Harness 官方会加载的本机 .env 文件。同一系统账户下运行的程序和 Agent 工具仍可能读取它，
请使用专用低权限账户，不要把该文件提交到 Git。
`)
    if (!options.yes && !await prompter.confirm('确认继续？')) return 1

    if (installCurrentVersion) {
      process.stdout.write(`\n正在${installation.alreadyInstalled ? '更新' : '安装'} DSH Profile……\n`)
      if (!run('dsh', ['plugin', '--profile', installation.profile, 'add', '--save-exact', packageSpec], { dshHome })) {
        process.stderr.write('插件安装失败。上方是 dsh/pnpm 的原始错误；除已完成的旧变量迁移外，其他配置尚未改动。\n')
        return 2
      }
    }

    await writeHarnessEnv(dshHome, current.source, {
      [ENV.appId]: appId,
      [ENV.appSecret]: appSecret,
      [ENV.allowedOpenIds]: allowedOpenIds,
      [ENV.workspace]: workspace,
      [ENV.permissionMode]: 'workspace-write',
    }, LEGACY_MANAGED_ENV_KEYS)
    await writeLocalState(dshHome, { profile: installation.profile, workspace, mode: installation.mode })

    process.stdout.write('\n正在检查最终配置……\n')
    if (!run('dsh', ['--profile', installation.profile, '--dump-config'], { dshHome, quiet: true })) {
      run('dsh', ['--profile', installation.profile, '--dump-config'], { dshHome })
      process.stderr.write('插件已安装，但 DSH 配置检查失败。请运行 feishu-control doctor 查看。\n')
      return 2
    }

    process.stdout.write(`
✓ 安装和配置检查完成。
✓ 凭证已保存，但不会在这里打印。
✓ 启动目录：${workspace}
`)
    if (allowedOpenIds.split(',').some((value) => value.trim() === 'ou_placeholder')) {
      process.stdout.write('\n你目前使用的是临时 open_id。启动后请私聊机器人，复制回复中的真实 open_id，然后再次运行 setup 更新。\n')
    }

    if (installation.mode === 'desktop') {
      process.stdout.write('\n请完全退出并重新打开 DeepSeek Harness Desktop，使新配置生效。向导不会另外启动一个重复的 DSH 进程。\n')
      return 0
    }

    if (options.noStart || !await prompter.confirm('现在启动飞书控制服务？', true)) {
      process.stdout.write('\n稍后可运行：pnpm dlx dsh-feishu-control start\n')
      return 0
    }
    prompter.close()
    process.stdout.write('\n正在启动。保持这个终端窗口开启；按 Ctrl+C 停止。\n\n')
    return run('dsh', ['--profile', PROFILE_NAME], { cwd: workspace, dshHome }) ? 0 : 2
  } finally {
    prompter.close()
  }
}

async function setupNonInteractive(options: Options, dshHome: string): Promise<number> {
  const current = await readHarnessEnv(dshHome)
  const appId = options.appId || configuredValue(current.values, ENV.appId, LEGACY_ENV.appId)
  const appSecret = configuredValue(current.values, ENV.appSecret, LEGACY_ENV.appSecret)
  const allowedOpenIds = options.allowedOpenIds || configuredValue(current.values, ENV.allowedOpenIds, LEGACY_ENV.allowedOpenIds)
  const workspaceInput = options.workspace
  if (!options.yes || !appId || !appSecret || !allowedOpenIds || !workspaceInput) {
    process.stderr.write('非交互模式需要 --yes、--app-id、--allowed-open-ids、--workspace，并通过环境变量提供 App Secret。\n')
    return 2
  }
  const workspace = await validateWorkspace(workspaceInput, dshHome)
  const installation = await resolveInstallationTarget(dshHome)
  const version = await packageVersion()
  if (shouldInstallCurrentVersion(installation, version, options.packageSpec)) {
    const packageSpec = options.packageSpec || `${PACKAGE_NAME}@${version}`
    if (!run('dsh', ['plugin', '--profile', installation.profile, 'add', '--save-exact', packageSpec], { dshHome })) return 2
  }
  await writeHarnessEnv(dshHome, current.source, {
    [ENV.appId]: appId,
    [ENV.appSecret]: appSecret,
    [ENV.allowedOpenIds]: allowedOpenIds,
    [ENV.workspace]: workspace,
    [ENV.permissionMode]: 'workspace-write',
  }, LEGACY_MANAGED_ENV_KEYS)
  await writeLocalState(dshHome, { profile: installation.profile, workspace, mode: installation.mode })
  const valid = run('dsh', ['--profile', installation.profile, '--dump-config'], { dshHome, quiet: true })
  if (!valid) run('dsh', ['--profile', installation.profile, '--dump-config'], { dshHome })
  return valid ? 0 : 2
}

async function doctor(options: Options): Promise<number> {
  const dshHome = resolveDshHome(options.dshHome === undefined ? process.env : { ...process.env, DSH_HOME: options.dshHome })
  const checks: Array<[string, boolean, string]> = []
  checks.push(['DeepSeek Harness dsh 可执行', requireCommand('dsh', ['--version']), '请先安装并运行 DeepSeek Harness'])
  checks.push(['pnpm 可执行', requireCommand('pnpm', ['--version']), '请先安装 pnpm'])
  const installedProfiles = await findInstalledProfiles(dshHome)
  const state = await readLocalState(dshHome)
  const profile = state !== undefined && installedProfiles.includes(state.profile) ? state.profile : installedProfiles[0]
  const installed = profile !== undefined
  checks.push([`插件已安装${installed ? `（profile: ${installedProfiles.join(', ')}）` : ''}`, installed, '先从插件广场安装，或运行 feishu-control setup'])
  const env = await readHarnessEnv(dshHome)
  for (const [key, legacyKey] of [
    [ENV.appId, LEGACY_ENV.appId],
    [ENV.appSecret, LEGACY_ENV.appSecret],
    [ENV.allowedOpenIds, LEGACY_ENV.allowedOpenIds],
  ] as const) {
    checks.push([`${key} 已配置`, Boolean(configuredValue(env.values, key, legacyKey)), '运行 feishu-control setup'])
  }
  let workspaceValid = false
  const configuredWorkspace = state?.workspace || configuredValue(env.values, ENV.workspace, LEGACY_ENV.workspace)
  if (configuredWorkspace !== undefined) {
    try { await validateWorkspace(configuredWorkspace, dshHome); workspaceValid = true } catch { /* reported below */ }
  }
  checks.push(['Agent 工作目录有效', workspaceValid, '运行 feishu-control setup 重新选择'])
  const configValid = profile !== undefined && requireCommand('dsh', ['--profile', profile, '--dump-config'], dshHome)
  checks.push(['DSH profile 配置可解析', configValid, profile === undefined ? '未找到安装 Profile' : `查看 dsh --profile ${profile} --dump-config 的错误`])

  process.stdout.write('\nfeishu-control 检查结果\n=======================\n')
  for (const [name, ok, help] of checks) process.stdout.write(`${ok ? '✓' : '✗'} ${name}${ok ? '' : ` — ${help}`}\n`)
  process.stdout.write('\n安全说明：检查只判断凭证是否存在，不会打印凭证内容。\n')
  return checks.every(([, ok]) => ok) ? 0 : 1
}

async function start(options: Options): Promise<number> {
  const dshHome = resolveDshHome(options.dshHome === undefined ? process.env : { ...process.env, DSH_HOME: options.dshHome })
  const state = await readLocalState(dshHome)
  if (state === undefined) {
    process.stderr.write('还没有保存的安装配置，请先运行 feishu-control setup。\n')
    return 2
  }
  if (state.mode === 'desktop') {
    process.stderr.write('当前插件由 DeepSeek Harness Desktop Profile 管理。请完全退出并重新打开 Desktop，不要另外运行 start。\n')
    return 1
  }
  const workspace = await validateWorkspace(state.workspace, dshHome)
  process.stdout.write(`将在 ${workspace} 启动 DeepSeek Harness。保持终端开启；按 Ctrl+C 停止。\n`)
  return run('dsh', ['--profile', state.profile], { cwd: workspace, dshHome }) ? 0 : 2
}

async function main(): Promise<void> {
  try {
    const options = parseArgs(process.argv.slice(2))
    if (options.command === 'help') { printHelp(); return }
    if (options.command === 'version') { process.stdout.write(`${await packageVersion()}\n`); return }
    const code = options.command === 'setup' ? await setup(options)
      : options.command === 'doctor' ? await doctor(options)
        : await start(options)
    process.exitCode = code
  } catch (error) {
    process.stderr.write(`错误：${(error as Error).message}\n`)
    process.exitCode = 2
  }
}

await main()
