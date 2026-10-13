// Release-gate smoke: the built dist must load under Node's native ESM loader
// (the type: module contract). Run after build: node tools/esm-smoke.mjs <pkg-root>.
// Reads exports['.'].default from the package.json, imports that file, and
// fails with the offending specifier on the first broken relative import.
// Packages whose dist carries non-JS side-effect imports (css) cannot do a
// live load under Node — for those the gate falls back to a static scan
// asserting every relative specifier in dist/**/*.js is explicitly
// extensioned, which is the contract this smoke exists to enforce.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

const pkgDir = resolve(process.argv[2])
if (!pkgDir) {
  console.error('usage: node esm-smoke.mjs <package-root>')
  process.exit(1)
}
const pkg = JSON.parse(readFileSync(resolve(pkgDir, 'package.json'), 'utf-8'))
const entry = pkg.exports?.['.']?.default ?? pkg.main
if (!entry) {
  console.error(`esm-smoke: ${pkg.name}: no entry point found`)
  process.exit(1)
}

function bareRelativeImports(dir) {
  const bare = []
  ;(function walk(d) {
    for (const name of readdirSync(d)) {
      const p = resolve(d, name)
      if (statSync(p).isDirectory()) walk(p)
      else if (p.endsWith('.js')) {
        const src = readFileSync(p, 'utf-8')
        for (const m of src.matchAll(/(from\s+|import\s*\(\s*|import\s+)(["'])(\.\.?\/[^"']+?)\2/g)) {
          if (!/\.[a-z]+$/i.test(m[3])) bare.push(`${name}: ${m[3]}`)
        }
      }
    }
  })(dir)
  return bare
}

try {
  const m = await import(pathToFileURL(resolve(pkgDir, entry)).href)
  console.log(`esm-smoke: ${pkg.name} loads under native ESM (${Object.keys(m).length} exports)`)
} catch (e) {
  if (e.code === 'ERR_UNKNOWN_FILE_EXTENSION') {
    const bare = bareRelativeImports(resolve(pkgDir, 'dist'))
    if (bare.length > 0) {
      console.error(`esm-smoke FAIL: ${pkg.name}: extensionless relative imports (live load blocked by non-JS imports):`)
      for (const b of bare.slice(0, 10)) console.error(`  ${b}`)
      process.exit(1)
    }
    console.log(`esm-smoke: ${pkg.name} relative imports all explicit (live load N/A: css side-effect import)`)
    process.exit(0)
  }
  console.error(`esm-smoke FAIL: ${pkg.name}: ${e.code || ''} ${e.message.split('\n')[0]}`)
  process.exit(1)
}
