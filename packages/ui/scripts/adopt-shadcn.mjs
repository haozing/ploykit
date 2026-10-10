#!/usr/bin/env node
// adopt-shadcn —— shadcn CLI 生成产物的"自有化"改写器（clean-copy 政策的唯一允许改动）。
//
// 用法：在 packages/ui 下先 `npx shadcn@latest add <component> -y -o`，
// 然后运行 `node scripts/adopt-shadcn.mjs [<file>...]`（无参则扫描全部 src/components/ui）。
// 改写规则（仅路径，不改行为）：
//   from "cn" | "@/lib/utils"        -> 相对路径到本包 lib/utils（自有 cn，clsx+tailwind-merge 同实现）
//   from "@/components/ui/X"          -> ./X
//   from "@/hooks/X"                  -> ../../hooks/X（use-mobile 留守本包）
//   from "@/components/X"             -> ../X
//   from "@/lib/X"                    -> ../../lib/X
// 改写后由 tsc 与 vitest 兜底（clean-copy 政策：绝不反向修改生成代码的行为）。
import { readFileSync, writeFileSync } from 'node:fs'
import { relative, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const files = process.argv.slice(2).length
  ? process.argv.slice(2).map((f) => join(pkgRoot, f))
  : execSync('git diff --name-only --diff-filter=ACM -- src/components/ui', { cwd: pkgRoot })
      .toString()
      .trim()
      .split('\n')
      .filter((f) => f.endsWith('.tsx') || f.endsWith('.ts'))
      .map((f) => join(pkgRoot, f))

const toRel = (fromFile, target) => {
  let r = relative(dirname(fromFile), join(pkgRoot, target)).replaceAll('\\', '/')
  if (!r.startsWith('.')) r = `./${r}`
  return r
}

let touched = 0
for (const f of files) {
  const src = readFileSync(f, 'utf8')
  const out = src.replace(/from (["'])(@\/[^"']+|cn)\1/g, (m, q, spec) => {
    if (spec === 'cn' || spec === '@/lib/utils') return `from ${q}${toRel(f, 'src/lib/utils')}${q}`
    const rest = spec.slice(2)
    if (rest.startsWith('components/ui/')) return `from ${q}${toRel(f, `src/${rest}`)}${q}`
    return `from ${q}${toRel(f, `src/${rest}`)}${q}`
  })
  if (out !== src) {
    writeFileSync(f, out)
    console.log(`adopted: ${relative(pkgRoot, f)}`)
    touched++
  }
}
console.log(`${touched}/${files.length} files rewritten`)
