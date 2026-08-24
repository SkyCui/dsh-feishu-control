import { readFile } from 'node:fs/promises'

const tag = process.argv[2]
const manifest = JSON.parse(
  await readFile(new URL('../package.json', import.meta.url), 'utf8'),
)
const expected = `v${manifest.version}`

if (tag !== expected) {
  throw new Error(`release tag ${JSON.stringify(tag)} must equal ${JSON.stringify(expected)}`)
}

process.stdout.write(`release tag matches package version: ${expected}\n`)
