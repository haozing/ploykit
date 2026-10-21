#!/usr/bin/env node
/**
 * Generate brotli sidecars for the built frontend.
 *
 * Why a build step and not runtime compression: Go's standard library has a
 * brotli *decoder* but no encoder, so runtime brotli means a third-party
 * dependency plus per-request CPU. At build time the bytes are already final
 * and `-q 11` is affordable — measured 171KB → 144KB on the example's entry
 * chunk versus gzip -9.
 *
 * Only text-like assets are compressed: brotli on an already-compressed format
 * (woff2, png, jpg) spends build time to produce a larger file.
 *
 * Usage: node tools/precompress.mjs <dir>
 * Idempotent: skips a sidecar whose mtime is newer than its source.
 */
import { readdir, stat, writeFile, rm } from 'node:fs/promises'
import { join, extname } from 'node:path'
import { brotliCompressSync, constants } from 'node:zlib'

const COMPRESSIBLE = new Set([
  '.js', '.mjs', '.css', '.html', '.json', '.svg', '.txt', '.xml', '.map',
])

const root = process.argv[2]
if (!root) {
  console.error('usage: node tools/precompress.mjs <dir>')
  process.exit(2)
}

let written = 0
let skipped = 0
let savedBytes = 0
let originalBytes = 0

async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      await walk(full)
      continue
    }
    if (!entry.isFile()) continue
    if (entry.name.endsWith('.br')) continue
    if (!COMPRESSIBLE.has(extname(entry.name).toLowerCase())) continue

    const sidecar = full + '.br'
    const src = await stat(full)
    let sidecarStat
    try {
      sidecarStat = await stat(sidecar)
    } catch {
      sidecarStat = null
    }
    if (sidecarStat && sidecarStat.mtimeMs >= src.mtimeMs) {
      skipped++
      continue
    }

    const data = await import('node:fs/promises').then((m) => m.readFile(full))
    const out = brotliCompressSync(data, {
      params: {
        [constants.BROTLI_PARAM_QUALITY]: 11,
        [constants.BROTLI_PARAM_SIZE_HINT]: data.length,
      },
    })
    // A sidecar larger than the source would be served to br clients for no
    // gain; drop it so the identity file is used. `rm` is not optional: an
    // older sidecar can still be sitting there (a repeated run without a
    // rebuild, or a file that used to compress), and leaving it in place means
    // the server keeps serving stale brotli bytes for the current URL.
    if (out.length >= data.length) {
      if (sidecarStat) await rm(sidecar, { force: true })
      skipped++
      continue
    }
    await writeFile(sidecar, out)
    written++
    originalBytes += data.length
    savedBytes += data.length - out.length
  }
}

await walk(root)
console.log(
  `precompress: wrote ${written} sidecar(s), skipped ${skipped}; ` +
    `${(originalBytes / 1024).toFixed(0)}KB -> ${((originalBytes - savedBytes) / 1024).toFixed(0)}KB ` +
    `(${originalBytes ? ((savedBytes / originalBytes) * 100).toFixed(0) : 0}% smaller)`,
)
