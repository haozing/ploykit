import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

// 语义令牌合同：@ploykit/ui 全部源码只允许使用语义令牌类（bg-background /
// text-muted-foreground / text-(--success) 等），禁止经典调色板类
// （bg-gray-50、text-blue-600…）。经典类依赖消费方 CSS 保留 Tailwind 默认
// 色板——那不在令牌合同内，按 example 主题接入的产品会拿到裸页面
// （aiblog 实录问题 10）。状态色使用 CSS 变量直引语法 text-(--success)，
// 与 lib/utils 的 STATUS_TONE_CLASS 同一词汇表。
const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const CLASSIC = /(?:bg|text|border|ring|from|to|via|fill|stroke|outline|decoration|divide|accent|caret)-(?:gray|zinc|slate|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d/

function collect(dir: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) { if (e.name !== '__tests__') out.push(...collect(p)) }
    else if (/\.tsx?$/.test(e.name) && !/\.test\./.test(e.name)) out.push(p)
  }
  return out
}

describe('语义令牌合同：ui 包禁用经典调色板类', () => {
  const files = collect(srcRoot)

  it('扫描范围覆盖全部源码文件', () => {
    expect(files.length).toBeGreaterThan(80)
  })

  for (const f of files) {
    const rel = relative(srcRoot, f).replaceAll('\\', '/')
    it(`${rel} 无经典调色板类`, () => {
      const lines = readFileSync(f, 'utf8').split('\n')
      lines.forEach((line, i) => {
        expect(CLASSIC.test(line), `${rel}:${i + 1} 使用了经典调色板类（改用语义令牌或 (--var) 直引）: ${line.trim().slice(0, 80)}`).toBe(false)
      })
    })
  }
})
