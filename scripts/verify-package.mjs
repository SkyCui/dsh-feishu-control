import { readFileSync, statSync } from 'node:fs'

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
if (manifest.bin?.['feishu-control'] !== 'lib/cli.js') throw new Error('missing feishu-control executable')
if (!readFileSync(new URL('../lib/cli.js', import.meta.url), 'utf8').startsWith('#!/usr/bin/env node')) {
  throw new Error('lib/cli.js is missing its node shebang')
}
if (!statSync(new URL('../lib/cli.js', import.meta.url)).isFile()) throw new Error('missing built CLI')
const requiredExports = [
  '.',
  './feishu',
  './feishu/invariant',
  './feishu-local',
  './feishu-local/invariant',
  './feishu-agent',
  './feishu-agent/invariant',
  './cordis.patch.yml',
]

for (const key of requiredExports) {
  if (manifest.exports?.[key] === undefined) throw new Error(`missing package export: ${key}`)
}

for (const specifier of [
  'dsh-feishu-control',
  'dsh-feishu-control/feishu',
  'dsh-feishu-control/feishu/invariant',
  'dsh-feishu-control/feishu-local',
  'dsh-feishu-control/feishu-local/invariant',
  'dsh-feishu-control/feishu-agent',
  'dsh-feishu-control/feishu-agent/invariant',
]) {
  await import(specifier)
}

process.stdout.write('package exports and built entry points verified\n')
