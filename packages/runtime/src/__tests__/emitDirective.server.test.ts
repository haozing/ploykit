// @vitest-environment node

import { afterEach, describe, expect, it } from 'vitest'
import { emitDirective } from '../browser'
import type { PloykitHost } from '../types'

const calls: Array<{ kind: string; payload: unknown }> = []
const host: PloykitHost = {
  directive(kind, json) {
    calls.push({ kind, payload: JSON.parse(json) })
  },
}

afterEach(() => {
  calls.length = 0
  delete globalThis.__ploykit_host__
})

describe('emitDirective（服务端分支）', () => {
  it('环境自证：无 window（判定依据 typeof window === undefined）', () => {
    expect(typeof window).toBe('undefined')
  })

  it('转发宿主：kind + payload JSON 序列化逐条调用', () => {
    globalThis.__ploykit_host__ = host
    emitDirective('head', [
      { tag: 'title', children: 'T' },
      { tag: 'meta', attrs: { name: 'description', content: 'D' } },
    ])
    expect(calls).toEqual([
      {
        kind: 'head',
        payload: [
          { tag: 'title', children: 'T' },
          { tag: 'meta', attrs: { name: 'description', content: 'D' } },
        ],
      },
    ])
  })

  it('status 指令同样转发宿主（v1 服务端仅记录）', () => {
    globalThis.__ploykit_host__ = host
    emitDirective('status', { code: 404 })
    expect(calls).toEqual([{ kind: 'status', payload: { code: 404 } }])
  })

  it('宿主缺失时抛错（不静默丢指令）', () => {
    expect(() => emitDirective('head', [{ tag: 'title', children: 'T' }])).toThrow(/__ploykit_host__/)
  })
})
