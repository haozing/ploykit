import type { VideoIR } from '../api/video'

/**
 * 时间线帧数（前端镜像后端单源公式）。
 *
 * 后端 example/internal/video/app/service.go DurationFrames 与
 * timeline-builder.js 的 durationFrames 是同一条公式：
 *   frames = max(1, ceil(max(meta.durationSec, voice.durationSec) * fps))
 * 而「词尾」也可能超出这两者（例如手工改词表后），页面上的 scrub 需要覆盖
 * 全部可 seek 的位置，所以这里再取一次 lastWord.end：
 *   max(ceil(meta.durationSec*fps), ceil(voice.durationSec*fps), ceil(lastWord.end*fps))
 *
 * 注意必须 ceil，不能用 round —— 8.04s @ 30fps = 241.2 → 242（round 会少一帧，
 * 交付审计 P8 的历史 bug）。
 */
export function durationFramesOf(ir: VideoIR | undefined): number {
  if (!ir) return 0
  const fps = ir.meta.fps > 0 ? ir.meta.fps : 30
  const metaFrames = Math.ceil((ir.meta.durationSec ?? 0) * fps)
  const voiceFrames = Math.ceil((ir.audio?.voice?.durationSec ?? 0) * fps)
  const lastWordEnd = ir.words.length > 0 ? ir.words[ir.words.length - 1]!.end : 0
  const wordFrames = Math.ceil(lastWordEnd * fps)
  return Math.max(metaFrames, voiceFrames, wordFrames)
}

/** 播放器上报有值时以它为准（渲染口径一致）；否则用 IR 公式。 */
export function resolveDurationFrames(ir: VideoIR | undefined, playerFrames?: number): number {
  if (playerFrames !== undefined && playerFrames > 0) return Math.ceil(playerFrames)
  return durationFramesOf(ir)
}
