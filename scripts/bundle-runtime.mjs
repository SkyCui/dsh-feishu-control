import { build } from 'esbuild'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'

const entryPoints = {
  'cli': 'src/cli.ts',
  'feishu/index': 'src/feishu/index.ts',
  'feishu/invariant': 'src/feishu/invariant.ts',
  'feishu-local/index': 'src/feishu-local/index.ts',
  'feishu-local/invariant': 'src/feishu-local/invariant.ts',
  'feishu-agent/index': 'src/feishu-agent/index.ts',
  'feishu-agent/invariant': 'src/feishu-agent/invariant.ts',
}

const result = await build({
  entryPoints,
  outdir: 'lib',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  minify: true,
  keepNames: true,
  legalComments: 'external',
  metafile: true,
  external: ['@deepseek-ai/*'],
  banner: {
    js: "import { createRequire } from 'node:module'; import { fileURLToPath } from 'node:url'; const require = createRequire(import.meta.url); const __filename = fileURLToPath(import.meta.url); const __dirname = fileURLToPath(new URL('.', import.meta.url));",
  },
})

// The bundled Lark SDK reads ../package.json to build its User-Agent string.
await writeFile(
  'lib/package.json',
  '{"name":"@larksuiteoapi/node-sdk","type":"module","version":"1.73.0"}\n',
)

const bundledPackages = new Map()
for (const input of Object.keys(result.metafile.inputs)) {
  const marker = `${sep}node_modules${sep}`
  const absoluteInput = resolve(input)
  const markerIndex = absoluteInput.lastIndexOf(marker)
  if (markerIndex < 0) continue

  const relative = absoluteInput.slice(markerIndex + marker.length)
  const parts = relative.split(sep)
  const packageName = parts[0].startsWith('@')
    ? `${parts[0]}/${parts[1]}`
    : parts[0]
  const rootParts = packageName.startsWith('@') ? 2 : 1
  bundledPackages.set(
    packageName,
    resolve(absoluteInput, ...Array(parts.length - rootParts).fill('..')),
  )
}

const notices = [
  'THIRD-PARTY SOFTWARE LICENSES',
  '',
  'This distribution bundles the following third-party packages.',
  'Their license texts are reproduced below.',
  '',
]

for (const [packageName, packageRoot] of [...bundledPackages].sort(([a], [b]) => a.localeCompare(b))) {
  const metadata = JSON.parse(await readFile(resolve(packageRoot, 'package.json'), 'utf8'))
  const licenseFiles = (await readdir(packageRoot))
    .filter((name) => /^(licen[cs]e|copying|notice)(\..*)?$/i.test(name))
    .sort()

  notices.push('='.repeat(80))
  notices.push(`${packageName}@${metadata.version ?? 'unknown'}`)
  notices.push(`Declared license: ${metadata.license ?? 'not declared'}`)
  notices.push('='.repeat(80), '')

  if (licenseFiles.length === 0) {
    notices.push('No license file was included in the installed package.', '')
    continue
  }

  for (const licenseFile of licenseFiles) {
    notices.push(`--- ${licenseFile} ---`, '')
    notices.push((await readFile(resolve(packageRoot, licenseFile), 'utf8')).trim(), '')
  }
}

await writeFile('lib/THIRD_PARTY_LICENSES.txt', `${notices.join('\n')}\n`)
