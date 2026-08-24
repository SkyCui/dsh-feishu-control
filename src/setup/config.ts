import { chmod, mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, parse, resolve } from 'node:path'

export const PROFILE_NAME = 'feishu-control'
export const MANAGED_ENV_KEYS = [
  'DSH_FEISHU_APP_ID',
  'DSH_FEISHU_APP_SECRET',
  'DSH_FEISHU_ALLOWED_OPEN_IDS',
  'DSH_FEISHU_WORKSPACE',
  'DSH_PERMISSION_MODE',
] as const

export interface LocalState {
  profile: string
  workspace: string
  mode: 'desktop' | 'standalone'
}

export function resolveDshHome(env: NodeJS.ProcessEnv = process.env): string {
  return resolve(env.DSH_HOME || `${homedir()}/.dsh`)
}

function unquote(value: string): string {
  const trimmed = value.trim()
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1)
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\')
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1)
  return trimmed
}

export function readDotenvValues(source: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (match?.[1] !== undefined && match[2] !== undefined) result[match[1]] = unquote(match[2])
  }
  return result
}

function dotenvValue(value: string): string {
  if (/^[A-Za-z0-9_.,:/@+-]*$/.test(value)) return value
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r')}"`
}

export function updateDotenv(source: string, values: Record<string, string | undefined>): string {
  const pending = new Map(Object.entries(values).filter((entry): entry is [string, string] => entry[1] !== undefined))
  const lines = source === '' ? [] : source.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n')
  const output: string[] = []

  for (const line of lines) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/)
    const key = match?.[1]
    if (key !== undefined && pending.has(key)) {
      output.push(`${key}=${dotenvValue(pending.get(key)!)}`)
      pending.delete(key)
    } else {
      output.push(line)
    }
  }

  if (pending.size > 0 && output.length > 0 && output.at(-1) !== '') output.push('')
  for (const [key, value] of pending) output.push(`${key}=${dotenvValue(value)}`)
  return output.length === 0 ? '' : `${output.join('\n')}\n`
}

export async function readHarnessEnv(dshHome: string): Promise<{ path: string, source: string, values: Record<string, string> }> {
  const path = resolve(dshHome, '.env')
  try {
    const source = await readFile(path, 'utf8')
    return { path, source, values: readDotenvValues(source) }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return { path, source: '', values: {} }
  }
}

export async function writeHarnessEnv(
  dshHome: string,
  source: string,
  values: Record<string, string>,
): Promise<string> {
  await mkdir(dshHome, { recursive: true, mode: 0o700 })
  const path = resolve(dshHome, '.env')
  const temporary = resolve(dshHome, `.env.feishu-control-${process.pid}.tmp`)
  await writeFile(temporary, updateDotenv(source, values), { encoding: 'utf8', mode: 0o600 })
  await chmod(temporary, 0o600)
  await rename(temporary, path)
  await chmod(path, 0o600)
  return path
}

export async function validateWorkspace(input: string, dshHome: string): Promise<string> {
  const workspace = resolve(input)
  const root = parse(workspace).root
  if (workspace === root) throw new Error('不能把文件系统根目录作为 Agent 工作目录。')
  if (workspace === resolve(homedir())) throw new Error('不能把整个用户主目录作为 Agent 工作目录。请选择一个具体项目文件夹。')
  if (workspace === resolve(dshHome) || workspace.startsWith(`${resolve(dshHome)}/`)) {
    throw new Error('不能把 DeepSeek Harness 配置目录作为 Agent 工作目录。')
  }
  let metadata
  try {
    metadata = await stat(workspace)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('该文件夹不存在，请先创建它。')
    throw error
  }
  if (!metadata.isDirectory()) throw new Error('工作目录必须是文件夹。')
  return workspace
}

export async function writeLocalState(dshHome: string, state: LocalState): Promise<string> {
  await mkdir(dshHome, { recursive: true, mode: 0o700 })
  const path = resolve(dshHome, 'feishu-control.json')
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  await chmod(path, 0o600)
  return path
}

export async function readLocalState(dshHome: string): Promise<LocalState | undefined> {
  try {
    const value = JSON.parse(await readFile(resolve(dshHome, 'feishu-control.json'), 'utf8')) as Partial<LocalState>
    if (typeof value.profile === 'string' && value.profile !== '' && typeof value.workspace === 'string') {
      return {
        profile: value.profile,
        workspace: value.workspace,
        mode: value.mode === 'desktop' ? 'desktop' : 'standalone',
      }
    }
    return undefined
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

export function profilePackageJsonPath(dshHome: string, profile = PROFILE_NAME): string {
  return resolve(dshHome, 'profiles', profile, 'package.json')
}

export async function isPluginInstalled(dshHome: string, profile = PROFILE_NAME): Promise<boolean> {
  try {
    const manifest = JSON.parse(await readFile(profilePackageJsonPath(dshHome, profile), 'utf8')) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    return manifest.dependencies?.['dsh-feishu-control'] !== undefined
      || manifest.devDependencies?.['dsh-feishu-control'] !== undefined
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

export async function findInstalledProfiles(dshHome: string): Promise<string[]> {
  const profilesRoot = resolve(dshHome, 'profiles')
  let entries
  try {
    entries = await readdir(profilesRoot, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const profiles: string[] = []
  for (const entry of entries) {
    if (entry.isDirectory() && await isPluginInstalled(dshHome, entry.name)) profiles.push(entry.name)
  }
  return profiles.sort((left, right) => {
    if (left === 'desktop') return -1
    if (right === 'desktop') return 1
    if (left === PROFILE_NAME) return -1
    if (right === PROFILE_NAME) return 1
    return left.localeCompare(right)
  })
}

export function configDirectory(path: string): string {
  return dirname(path)
}
