import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { findInstalledProfiles, readDotenvValues, updateDotenv, validateWorkspace, writeHarnessEnv } from '../config.ts'

describe('setup configuration', () => {
  it('updates only managed values and preserves unrelated dotenv content', () => {
    const source = '# keep me\nOTHER=value\nDSH_FEISHU_APP_ID=old\n'
    const updated = updateDotenv(source, {
      DSH_FEISHU_APP_ID: 'cli_new',
      DSH_FEISHU_APP_SECRET: 'secret with spaces',
    })
    expect(updated).toBe('# keep me\nOTHER=value\nDSH_FEISHU_APP_ID=cli_new\n\nDSH_FEISHU_APP_SECRET="secret with spaces"\n')
    expect(readDotenvValues(updated)).toMatchObject({
      OTHER: 'value',
      DSH_FEISHU_APP_ID: 'cli_new',
      DSH_FEISHU_APP_SECRET: 'secret with spaces',
    })
  })

  it('writes the Harness env file with owner-only permissions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'feishu-control-'))
    const path = await writeHarnessEnv(root, 'EXISTING=1\n', {
      DSH_FEISHU_APP_ID: 'cli_test',
      DSH_FEISHU_APP_SECRET: 'secret',
    })
    expect(await readFile(path, 'utf8')).toContain('EXISTING=1')
    const { mode } = await import('node:fs/promises').then(({ stat }) => stat(path))
    expect(mode & 0o777).toBe(0o600)
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
