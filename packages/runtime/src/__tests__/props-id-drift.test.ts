// @vitest-environment node

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { PROPS_SCRIPT_ID } from '../hydrate'

describe('__PLOYKIT_PROPS__ 跨语言漂移守卫', () => {
  it('renderx Go 模板写入的 script id 与 PROPS_SCRIPT_ID 逐字一致', () => {
    const go = readFileSync(
      fileURLToPath(new URL('../../../../platform/renderx/template.go', import.meta.url)),
      'utf-8',
    )
    expect(go).toContain(`id="${PROPS_SCRIPT_ID}"`)
  })

  it('data-page-id 属性名两端一致（Go 写 / TS 读）', () => {
    const go = readFileSync(
      fileURLToPath(new URL('../../../../platform/renderx/template.go', import.meta.url)),
      'utf-8',
    )
    expect(go).toContain('data-page-id')
  })
})
