// Release-gate smoke, tarball lane: "what consumers install is what we tested".
// tools/esm-smoke.mjs proves the LOCAL dist loads; local dist can still drift
// from what npm publishes (stale-build class), and it never proves the tarball
// installs standalone. The escape this lane guards: a product installs the
// published tarball into its own repo and something the monorepo took for
// granted is missing — files field gaps (src/ dropped so Tailwind
// `@source "./src"` scans nothing and standalone consumers silently compile
// zero framework classes — the field case that motivated this lane), exports
// targets that don't exist on disk, dependency ranges that don't resolve.
//
// Per package: npm pack → npm install <tgz> into a fresh scratch consumer
// project → tarball-integrity assertions → live-load under the native ESM
// loader where the dist allows it (entry plus every .js subpath export target:
// the root entry graph alone can be peer-free while subpath consumers like
// ./hydrate statically import react).
//
// Peer dependencies (react etc.) are NOT installed into the consumer under all
// npm configs (--legacy-peer-deps skips them; npm >= 7 usually auto-installs).
// On ERR_MODULE_NOT_FOUND for a *declared peer* we copy it from the monorepo
// root's node_modules into the scratch consumer (copy, not symlink: Windows)
// and retry. Registry dependencies are NEVER satisfied that way — if one is
// missing after a standalone install, the tarball's ranges/publish are broken,
// which is exactly what this lane must report.
//
// Usage: node tools/tarball-smoke.mjs [client|runtime|hooks|ui|@ploykit/<name>]...
//        (default: all four). --keep preserves the scratch dir for debugging.
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ALL = ['client', 'runtime', 'hooks', 'ui']

if (Number(process.versions.node.split('.')[0]) < 20) {
  console.error(`tarball-smoke: node >= 20 required, running ${process.versions.node}`)
  process.exit(2)
}

// Spawn npm through the npm-cli.js shipped next to the running node — no
// shell, no .cmd EINVAL, no path quoting issues on any platform.
function npmCliPath() {
  const exec = process.execPath
  const candidates =
    process.platform === 'win32'
      ? [join(dirname(exec), 'node_modules', 'npm', 'bin', 'npm-cli.js')]
      : [join(dirname(dirname(exec)), 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')]
  for (const c of candidates) if (existsSync(c)) return c
  return null
}

const npmCli = npmCliPath()

class Fail extends Error {}
function fail(pkg, msg) {
  throw new Fail(`tarball-smoke FAIL: @ploykit/${pkg}: ${msg}`)
}

function npm(args, cwd, what) {
  const r = npmCli
    ? spawnSync(process.execPath, [npmCli, ...args], { cwd, encoding: 'utf-8' })
    : spawnSync('npm', args, { cwd, encoding: 'utf-8', shell: true })
  if (r.status !== 0 || r.error) {
    const tail = String(r.stderr || r.stdout || r.error || '').trim().split('\n').slice(-8).join('\n')
    throw new Fail(`${what} failed (exit ${r.status}):\n${tail}`)
  }
  return String(r.stdout)
}

const argv = process.argv.slice(2)
const keep = argv.includes('--keep')
const named = argv.filter((a) => a !== '--keep')
const pkgs = (named.length ? named : ALL).map((a) => {
  const n = a.replace(/^@ploykit\//, '')
  if (!ALL.includes(n)) {
    console.error(`tarball-smoke: unknown package '${a}' (expected one of: ${ALL.join(', ')})`)
    process.exit(2)
  }
  return n
})

function targetOf(v) {
  if (typeof v === 'string') return v
  if (v && typeof v === 'object' && typeof v.default === 'string') return v.default
  return null
}

// Every non-pattern export key must resolve to a real file in the installed
// tarball (superset of the "spot-check one deep export" requirement — checking
// all of them is free), plus the development condition target (src/) when the
// package advertises monorepo direct-source consumption.
function checkExportTarget(pkg, installed, key, v, iPkg) {
  let t = targetOf(v)
  if (key === '.' && !t) t = iPkg.main
  if (!t) fail(pkg, `exports["${key}"] has no resolvable default target`)
  if (!existsSync(resolve(installed, t))) {
    fail(pkg, `exports["${key}"] -> ${t} missing from the installed tarball (files-field gap)`)
  }
  const dev = v && typeof v === 'object' && typeof v.development === 'string' ? v.development : null
  if (dev && !existsSync(resolve(installed, dev))) {
    fail(pkg, `exports["${key}"].development -> ${dev} missing from the installed tarball (files field must ship src/)`)
  }
}

// Pattern exports ("./components/ui/*"): the target dir must exist and (for
// the plain dir/*.ext shape) match at least one real file.
function checkPatternExport(pkg, installed, key, v) {
  const t = targetOf(v)
  if (!t || !t.includes('*')) fail(pkg, `exports["${key}"] pattern has no resolvable default target`)
  const star = t.indexOf('*')
  const baseDir = resolve(installed, t.slice(0, star))
  if (!existsSync(baseDir)) {
    fail(pkg, `exports["${key}"] -> ${t}: base dir ${t.slice(0, star)} missing from the installed tarball`)
  }
  const suffix = t.slice(star + 1)
  if (!suffix.includes('/') && !readdirSync(baseDir).some((f) => f.endsWith(suffix))) {
    fail(pkg, `exports["${key}"] -> ${t} matches no file in the installed tarball (deep export spot-check)`)
  }
}

// ui-specific tailwind contract: the stylesheet registers this package's src/
// for content detection because Tailwind v4 skips node_modules in automatic
// detection — if src/ or the @source line is missing, standalone consumers
// compile zero framework classes and only find out in production.
function checkUiTailwindContract(pkg, installed, iPkg) {
  const srcDir = join(installed, 'src')
  if (!existsSync(srcDir) || readdirSync(srcDir).length === 0) {
    fail(pkg, 'installed tarball ships no src/ — Tailwind @source "./src" has nothing to scan; standalone consumers compile zero framework classes (files field must ship src)')
  }
  if (!iPkg.exports || !iPkg.exports['./tailwind.css']) {
    fail(pkg, 'exports lacks "./tailwind.css" — standalone consumers cannot register the stylesheet')
  }
  const css = join(installed, 'tailwind.css')
  if (!existsSync(css)) fail(pkg, 'tailwind.css missing from the installed tarball (files field must ship it)')
  if (!readFileSync(css, 'utf-8').includes('@source "./src"')) {
    fail(pkg, 'installed tailwind.css does not contain @source "./src" — standalone Tailwind content detection finds nothing')
  }
}

// Same contract esm-smoke enforces on local dist, re-checked against what the
// tarball actually shipped.
function bareRelativeImports(dir) {
  const bare = []
  ;(function walk(d) {
    for (const name of readdirSync(d)) {
      const p = resolve(d, name)
      if (statSync(p).isDirectory()) walk(p)
      else if (p.endsWith('.js')) {
        const src = readFileSync(p, 'utf-8')
        for (const m of src.matchAll(/(from\s+|import\s*\(\s*|import\s+)(["'])(\.\.?\/[^"']+?)\2/g)) {
          if (!/\.[a-z]+$/i.test(m[3])) bare.push(`${relative(dir, p)}: ${m[3]}`)
        }
      }
    }
  })(dir)
  return bare
}

// Copy a peer from the monorepo root install into the scratch consumer —
// together with the peer's own runtime dependency tree (deps only, never
// peerDependencies): under configs that skip peers, npm installs nothing, so
// react-router arrives without `cookie` etc. The monorepo root node_modules
// is the version source of truth for the whole copied tree.
function copyPeerTree(pkg, consumer, rootSpec) {
  const queue = [rootSpec]
  const seen = new Set()
  while (queue.length > 0) {
    const spec = queue.shift()
    if (seen.has(spec)) continue
    seen.add(spec)
    const from = resolve(repoRoot, 'node_modules', spec)
    if (!existsSync(from)) {
      fail(pkg, `peer '${rootSpec}' tree: '${spec}' not found in the monorepo root node_modules to copy`)
    }
    cpSync(from, join(consumer, 'node_modules', spec), {
      recursive: true,
      dereference: true,
      filter: (s) => !relative(from, s).split(/[\\/]/).includes('node_modules'),
    })
    console.error(`tarball-smoke: ${pkg}: peer tree: copied '${spec}' from monorepo root node_modules`)
    const pj = join(from, 'package.json')
    if (existsSync(pj)) {
      const deps = Object.keys(JSON.parse(readFileSync(pj, 'utf-8')).dependencies ?? {})
      for (const d of deps) {
        if (!existsSync(join(consumer, 'node_modules', d))) queue.push(d)
      }
    }
  }
}

// Live-load one tarball-installed target. Missing declared peers are copied
// from the monorepo root node_modules (see header) and the import retried.
// The retry carries a cache-busting query: node's ESM loader negative-caches
// a failed module job for the same URL, so re-importing the identical path
// replays the stale resolution failure even after the specifier now resolves.
async function liveLoad(pkg, targetAbs, consumer, srcPkg, label) {
  const peers = Object.keys(srcPkg.peerDependencies ?? {})
  const nameOf = (spec) => (spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0])
  const tried = new Set()
  for (let attempt = 0; ; attempt++) {
    try {
      const href = pathToFileURL(targetAbs).href + (attempt > 0 ? `?retry=${attempt}` : '')
      return { mod: await import(href) }
    } catch (err) {
      if (err.code === 'ERR_UNKNOWN_FILE_EXTENSION') return { staticFallback: true }
      if (err.code === 'ERR_MODULE_NOT_FOUND') {
        const m = /Cannot find (?:package|module) '([^']+)'/.exec(String(err.message))
        if (m) {
          const spec = nameOf(m[1])
          if (!spec.startsWith('.') && peers.includes(spec) && !tried.has(spec)) {
            tried.add(spec)
            copyPeerTree(pkg, consumer, spec)
            if (attempt > 30) fail(pkg, 'peer copy loop did not converge')
            continue
          }
          fail(pkg, `${label}: standalone install cannot resolve '${m[1]}' (not a declared peer of this package) — registry dependency missing (unpublished range or broken dependency declaration)`)
        }
      }
      fail(pkg, `${label}: ${err.code || 'import failed'} ${String(err.message).split('\n')[0]}`)
    }
  }
}

async function smoke(name, scratch, packedByName) {
  const note = (m) => console.error(`tarball-smoke: ${name}: ${m}`)
  const srcDir = resolve(repoRoot, 'packages', name)
  const srcPkg = JSON.parse(readFileSync(join(srcDir, 'package.json'), 'utf-8'))

  const tgz = packedByName.get(name)
  if (!tgz) fail(name, 'no packed tarball for this package (pack phase skipped it)')

  note('npm install tarball into scratch consumer (standalone, no workspace, no saved manifest)')
  const consumer = join(scratch, `consumer-${name}`)
  mkdirSync(consumer, { recursive: true })
  writeFileSync(
    join(consumer, 'package.json'),
    JSON.stringify({ name: 'tarball-consumer', type: 'module', private: true }, null, 2) + '\n',
  )
  // Install every sibling tarball together: cross-package @ploykit/* ranges
  // (hooks -> runtime ^0.8.0, ui -> client/hooks) must resolve against the
  // LOCAL tarballs during a release window — the new versions are not on the
  // registry yet, and resolving them there is exactly the pre-publish ETARGET
  // this lane hit (2026-10-19). Registry dependencies (react-router, tanstack)
  // still resolve normally and are never masked.
  const installArgs = ['install', ...[...packedByName.values()], '--no-save', '--ignore-scripts', '--loglevel=error', '--no-package-lock', '--no-audit', '--no-fund']
  note(`installing ${packedByName.size} sibling tarballs (cross-package @ploykit ranges resolve locally)`)
  npm(installArgs, consumer, `npm install @ploykit sibling tarballs`)
  const installed = join(consumer, 'node_modules', '@ploykit', name)
  if (!existsSync(installed)) fail(name, 'tarball installed but node_modules/@ploykit/<pkg> not found on disk')

  // --- tarball integrity: version parity + every exports target on disk ---
  const iPkg = JSON.parse(readFileSync(join(installed, 'package.json'), 'utf-8'))
  if (iPkg.version !== srcPkg.version) {
    fail(name, `installed version ${iPkg.version} != source version ${srcPkg.version} (stale publish or pack drift)`)
  }
  if (!iPkg.exports || !iPkg.exports['.']) {
    fail(name, 'installed package.json has no exports["."] — entry unresolvable for consumers')
  }
  checkExportTarget(name, installed, '.', iPkg.exports['.'], iPkg)
  for (const [k, v] of Object.entries(iPkg.exports)) {
    if (k === '.' || k === './package.json') continue
    if (k.includes('*')) checkPatternExport(name, installed, k, v)
    else checkExportTarget(name, installed, k, v, iPkg)
  }

  // --- loadability ---
  if (name === 'ui') {
    checkUiTailwindContract(name, installed, iPkg)
    const bare = bareRelativeImports(join(installed, 'dist'))
    if (bare.length > 0) {
      fail(name, `extensionless relative imports in installed dist:\n  ${bare.slice(0, 10).join('\n  ')}`)
    }
    console.log(`tarball-smoke: @ploykit/ui@${iPkg.version} installs standalone + relative imports all explicit (src/ + tailwind.css @source verified)`)
    return
  }

  // Live-load the entry AND every .js subpath export target — the root entry
  // graph alone can be peer-free (runtime's index.js re-exports only the
  // isomorphic browser.js) while subpath consumers like ./hydrate statically
  // import react; loading every JS target is what proves peers resolve from
  // the tarball's own exports map.
  //
  // Pre-flight: copy any declared peer the consumer is missing BEFORE the
  // first import. Reactive copy-and-retry alone is not enough because node's
  // ESM loader negative-caches resolution failures for parent modules reached
  // via bare specifiers (no query propagation there), so a later retry can
  // replay a stale failure for a specifier that now resolves. Under default
  // npm config peers are auto-installed and this copies nothing.
  for (const p of Object.keys(srcPkg.peerDependencies ?? {})) {
    if (!existsSync(join(consumer, 'node_modules', p))) copyPeerTree(name, consumer, p)
  }
  const liveTargets = [['.', targetOf(iPkg.exports['.']) ?? iPkg.main]]
  for (const [k, v] of Object.entries(iPkg.exports)) {
    if (k === '.' || k === './package.json') continue
    if (k.includes('*')) continue
    const t = targetOf(v)
    if (t && t.endsWith('.js')) liveTargets.push([k, t])
  }
  let entryExports = 0
  for (const [key, target] of liveTargets) {
    const r = await liveLoad(name, resolve(installed, target), consumer, srcPkg, key === '.' ? 'entry' : key)
    if (r.staticFallback) {
      const bare = bareRelativeImports(join(installed, 'dist'))
      if (bare.length > 0) {
        fail(name, `extensionless relative imports in installed dist (live load blocked by non-JS imports):\n  ${bare.slice(0, 10).join('\n  ')}`)
      }
      console.log(`tarball-smoke: @ploykit/${name}@${iPkg.version} installs standalone + relative imports all explicit (live load N/A: css side-effect import)`)
      return
    }
    if (key === '.') entryExports = Object.keys(r.mod).length
  }
  console.log(`tarball-smoke: @ploykit/${name}@${iPkg.version} installs standalone + loads (${entryExports} exports)`)
}

const scratch = mkdtempSync(join(tmpdir(), 'tarball-smoke-'))
let exitCode = 0
try {
  // Pack every requested package BEFORE any install: the installs then see the
  // complete local tarball set (release-window requirement, see smoke()).
  const packDir = join(scratch, 'pack')
  mkdirSync(packDir, { recursive: true })
  const packedByName = new Map()
  for (const name of pkgs) {
    const packed = npm(['pack', '--json', `./packages/${name}`, '--pack-destination', packDir], repoRoot, `npm pack @ploykit/${name}`)
    const tgz = join(packDir, JSON.parse(packed)[0].filename)
    if (!existsSync(tgz)) {
      console.error(`tarball-smoke: @ploykit/${name}: npm pack reported success but ${tgz} does not exist`)
      exitCode = 1
      throw new Fail(`pack @ploykit/${name}`)
    }
    packedByName.set(name, tgz)
    console.error(`tarball-smoke: ${name}: npm pack -> ${JSON.parse(packed)[0].filename}`)
  }
  for (const name of pkgs) {
    try {
      await smoke(name, scratch, packedByName)
    } catch (e) {
      if (!(e instanceof Fail)) throw e
      console.error(e.message)
      exitCode = 1
      break // first failure exits the lane
    }
  }
} finally {
  if (!keep) rmSync(scratch, { recursive: true, force: true })
}
process.exitCode = exitCode
