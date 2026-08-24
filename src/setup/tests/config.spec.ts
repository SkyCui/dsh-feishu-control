import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  findInstalledProfiles,
  LEGACY_MANAGED_ENV_KEYS,
  MANAGED_ENV_KEYS,
  migrateLegacyHarnessEnv,
  readDotenvValues,
  updateDotenv,
  validateWorkspace,
  writeHarnessEnv,
} from '../config.ts'

describe('setup configuration', () => {
  it('migrates legacy DSH-prefixed values and preserves unrelated dotenv content', () => {
    const source = '# keep me\nOTHER=value\nDSH_FEISHU_APP_ID=old\nDSH_FEISHU_APP_SECRET=old secret\n'
    const updated = updateDotenv(source, {
      FEISHU_CONTROL_APP_ID: 'cli_new',
      FEISHU_CONTROL_APP_SECRET: 'secret with spaces',
    }, LEGACY_MANAGED_ENV_KEYS)
    expect(updated).toBe('# keep me\nOTHER=value\n\nFEISHU_CONTROL_APP_ID=cli_new\nFEISHU_CONTROL_APP_SECRET="secret with spaces"\n')
    expect(readDotenvValues(updated)).toMatchObject({
      OTHER: 'value',
      FEISHU_CONTROL_APP_ID: 'cli_new',
      FEISHU_CONTROL_APP_SECRET: 'secret with spaces',
    })
    expect(updated).not.toContain('DSH_FEISHU_')
  })

  it('uses no DSH-prefixed managed keys because Harness rejects them in dotenv files', () => {
    expect(MANAGED_ENV_KEYS.every((key) => !key.startsWith('DSH_'))).toBe(true)
  })

  it('writes the Harness env file with owner-only permissions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'feishu-control-'))
    const path = await writeHarnessEnv(root, 'EXISTING=1\n', {
      FEISHU_CONTROL_APP_ID: 'cli_test',
      FEISHU_CONTROL_APP_SECRET: 'secret',
    })
    expect(await readFile(path, 'utf8')).toContain('EXISTING=1')
    const { mode } = await import('node:fs/promises').then(({ stat }) => stat(path))
    expect(mode & 0o777).toBe(0o600)
  })

  it('migrates an existing Harness env before any dsh subprocess starts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'feishu-control-migration-'))
    await writeFile(join(root, '.env'), [
      'DEEPSEEK_API_KEY=keep-me',
      'DSH_FEISHU_APP_ID=cli_legacy',
      'DSH_FEISHU_APP_SECRET=legacy-secret',
      'DSH_FEISHU_ALLOWED_OPEN_IDS=ou_legacy',
      'DSH_FEISHU_WORKSPACE=/tmp/project',
      'DSH_PERMISSION_MODE=workspace-write',
      '',
    ].join('\n'))

    const migrated = await migrateLegacyHarnessEnv(root)
    expect(migrated.migrated).toBe(true)
    expect(migrated.values).toMatchObject({
      DEEPSEEK_API_KEY: 'keep-me',
      FEISHU_CONTROL_APP_ID: 'cli_legacy',
      FEISHU_CONTROL_APP_SECRET: 'legacy-secret',
      FEISHU_CONTROL_ALLOWED_OPEN_IDS: 'ou_legacy',
      FEISHU_CONTROL_WORKSPACE: '/tmp/project',
      FEISHU_CONTROL_PERMISSION_MODE: 'workspace-write',
    })
    expect(migrated.source).not.toMatch(/^DSH_/m)
  })

  it('rejects dangerous workspaces and accepts a project directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'feishu-workspace-'))
    const dshHome = join(root, '.dsh')
    const project = join(root, 'project')
    await mkdir(dshHome)
    await mkdir(project)
    await writeFile(join(project, 'README.md'), 'test')
    await expect(validateWorkspace(dshHome, dshHome)).rejects.toThrow('配置目录')
    await expect(validateWorkspace(project, dshHome)).resolves.toBe(project)
  })

  it('finds marketplace and standalone installations across all profiles', async () => {
    const dshHome = await mkdtemp(join(tmpdir(), 'feishu-profiles-'))
    for (const profile of ['custom', 'feishu-control', 'desktop']) {
      const directory = join(dshHome, 'profiles', profile)
      await mkdir(directory, { recursive: true })
      await writeFile(join(directory, 'package.json'), JSON.stringify({
        dependencies: profile === 'custom' ? { unrelated: '1.0.0' } : { 'dsh-feishu-control': '0.1.0' },
      }))
    }
    expect(await findInstalledProfiles(dshHome)).toEqual(['desktop', 'feishu-control'])
  })
})
