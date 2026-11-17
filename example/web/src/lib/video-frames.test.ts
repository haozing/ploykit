import { describe, expect, it } from 'vitest'
import { durationFramesOf, resolveDurationFrames } from './video-frames'
import type { VideoIR } from '../api/video'

/** 帧数公式与后端单源对齐（Go DurationFrames / timeline-builder.js）。 */

function ir(partial: Omit<Partial<VideoIR>, 'meta'> & { meta?: Partial<VideoIR['meta']> }): VideoIR {
  const { meta, ...rest } = partial
  return {
    meta: { fps: 30, width: 1080, height: 1920, durationSec: 0, ...meta },
    script: '',
    words: [],
    effects: [],
    elements: [],
    ...rest,
  }
}

describe('durationFramesOf', () => {
  it('ceil 而非 round：8.04s @ 30fps = 242（round 会给 241）', () => {
    expect(durationFramesOf(ir({ meta: { durationSec: 8.04 } }))).toBe(242)
  })

  it('配音更长时以配音为准（10s meta / 12.4s voice @30 = 372）', () => {
    const withVoice = ir({
      meta: { durationSec: 10 },
      audio: { voice: { key: 'k', durationSec: 12.4 } },
    })
    expect(durationFramesOf(withVoice)).toBe(372)
  })

  it('词尾超出 meta/voice 时覆盖到词尾（1.5s @30 = 45）', () => {
    const withWords = ir({
      meta: { durationSec: 0.5 },
      words: [{ index: 0, text: 'x', start: 1.1, end: 1.5, source: 'estimated' }],
    })
    expect(durationFramesOf(withWords)).toBe(45)
  })

  it('空 IR → 0；播放器上报有值时以播放器为准', () => {
    expect(durationFramesOf(undefined)).toBe(0)
    expect(durationFramesOf(ir({ meta: { durationSec: 5 } }))).toBe(150)
    expect(resolveDurationFrames(ir({ meta: { durationSec: 5 } }), 999)).toBe(999)
    expect(resolveDurationFrames(ir({ meta: { durationSec: 5 } }), 0)).toBe(150)
  })
})
