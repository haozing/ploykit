// Rewrite extensionless relative imports in built ESM output to explicit
// .js — tsc with moduleResolution "bundler" does not add extensions, but a
// package.json "type": "module" requires them for Node's native ESM loader
// (orkome upgrade report, Issue 2). Idempotent; skips bare specifiers,
// URLs, and already-suffixed paths.
import { existsSync, readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = process.argv[2]
if (!root) {
  console.error('usage: node fix-esm-extensions.mjs <dist-dir>')
  process.exit(1)
}

const files = []
;(function walk(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p)
    else if (p.endsWith('.js')) files.push(p)
  }
})(root)

let rewritten = 0
for (const f of files) {
  const src = readFileSync(f, 'utf-8')
  const out = src.replace(
    /(from\s+|import\s*\(\s*)(["'])(\.\.?\/[^"']+?)\2/g,
    (whole, head, q, spec) => {
      if (/\.(js|mjs|cjs|json|css)$/.test(spec)) return whole
      // Directory-index modules (src/router/index.tsx -> dist/router/index.js):
      // tsc emits "../router" for them, so the suffix must go to
      // "../router/index.js", not the nonexistent "../router.js" (ui 2.0
      // router-adapter build break, 2026-10-19). Anything that does not exist
      // on disk (CSS imports stripped by tsc, etc.) keeps plain ".js".
      const abs = join(f, '..', spec)
      const dirIndex = existsSync(abs) && statSync(abs).isDirectory()
      rewritten++
      return `${head}${q}${spec}${dirIndex ? '/index' : ''}.js${q}`
    },
  )
  if (out !== src) writeFileSync(f, out)
}
console.log(`fix-esm-extensions: rewrote ${rewritten} relative imports in ${files.length} files`)
