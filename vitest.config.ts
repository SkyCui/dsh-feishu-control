import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const source = (path: string): string => fileURLToPath(new URL(path, import.meta.url))

export default defineConfig({
  resolve: {
    alias: [
      { find: 'dsh-feishu-control/feishu-agent', replacement: source('./src/feishu-agent/index.ts') },
      { find: 'dsh-feishu-control/feishu-local', replacement: source('./src/feishu-local/index.ts') },
      { find: 'dsh-feishu-control/feishu', replacement: source('./src/feishu/index.ts') },
      { find: 'dsh-feishu-control', replacement: source('./src/feishu/index.ts') },
    ],
  },
  test: {
    include: ['src/**/tests/*.spec.ts'],
  },
})
