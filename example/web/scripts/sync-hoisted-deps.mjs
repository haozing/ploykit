











import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const rootModules = path.resolve(webDir, '..', '..', 'node_modules')
const targets = [
  'react',
  'react-dom',
  'react-router',
  'react-router-dom',
  '@tanstack/react-query',
]

for (const name of targets) {
  const src = path.join(rootModules, name)
  const dst = path.join(webDir, 'node_modules', name)
  if (!fs.existsSync(src)) {
    console.warn(`[sync-hoisted-deps] 根提升副本不存在，跳过: ${name}`)
    continue
  }
  fs.rmSync(dst, { recursive: true, force: true, maxRetries: 3 })
  fs.mkdirSync(path.dirname(dst), { recursive: true })
  fs.cpSync(src, dst, { recursive: true, verbatimSymlinks: false, dereference: true })
  console.log(`[sync-hoisted-deps] ${name}: ${src} -> ${dst}`)
}
