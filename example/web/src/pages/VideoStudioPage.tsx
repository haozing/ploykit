import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '../deps'
import { Link } from '@ploykit/ui/router'
import {
  PageHeader, PageLoading, PageError, PageEmpty, Button, Textarea, Label,
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Slider,
  DataTable, StatusBadge, Badge, Progress, ProgressValue,
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
  Popover, PopoverContent, PopoverTrigger,
  Spinner, toast, apiErrorMessage, cn, formatDateTime, shortID, STATUS_TONE_CLASS, type StatusTone, type Column,
} from '@ploykit/ui'
import {
  ArrowLeft, Clapperboard, Download, Pause, Play, RefreshCw, Sparkles, Upload, Wand2, Copy,
} from 'lucide-react'
import { useWorkspace, useWsStatus, useWsScope, useWsFrame, bridgeWsToQuery } from '@ploykit/hooks'
import { videoApi, E_VIDEO_VERSION_CONFLICT, isApiError, VIDEO_ASSET_MAX_BYTES } from '../api/video'
import type {
  VideoIR, VideoRender, VideoRenderParams, VideoRenderStatus, VideoWord,
  VideoTemplate, VideoTheme,
} from '../api/video'
import { TemplateThumbnail, ThemeDot } from './VideoStudioListPage'
import { hasPerm, radioNavProps } from '../lib/radio-nav'
import { resolveDurationFrames } from '../lib/video-frames'
import { wsClient } from '../ws'

/**
 * /studio/:id 工作室页（§5.2 布局）：
 *
 *   ┌ PageHeader: 项目名 · version · Agent 在线指示 ─────────────────────┐
 *   ├ 左栏(320px)         │ 中央 9:16 预览          │ 右栏(360px)        │
 *   │ 脚本编辑 + 保存      │ iframe preview.html    │ 效果列表(click→seek)│
 *   │ 词条时间轴(chips)    │ 9:16 等比缩放           │ 渲染参数面板        │
 *   ├ scrub 条 + 播放/暂停 + 帧号 ──────────────────────────────────────┤
 *   ├ 渲染历史 DataTable（status / 进度 / 下载 + 首帧缩略图）───────────┤
 *
 * WS：mount 时 connect（若未连），useWsScope('video', projectId) 订阅；
 * `video.ir.updated` → refetch 项目；`video.render.updated` → 更新渲染历史行
 * （bridgeWsToQuery 兜底失效 ['video','renders',wsId,projectId]）。
 *
 * 轮询兜底（不只看 socket 是否 open）：存在活跃渲染时，若连接未开、订阅被
 * 服务端拒绝（rejected:subscribe）、或超过 RENDER_WS_STALE_MS 没收到任何
 * 渲染帧，就按 1s 拉一次渲染列表；没有活跃渲染则完全不轮询。
 *
 * 权限（role_perms，来自 useWorkspace().current）：
 * - video:write  → 保存脚本 / 上传素材 / 重新组合
 * - video:render → 提交渲染（member 没有；按钮保留并禁用 + 说明，而不是藏起来）
 *
 * 浏览器原生 GET（iframe / <a download> / <img>）带不了 X-Workspace-Id，
 * previewUrl / fileUrl 统一追加 ?workspace_id=。
 */

// ---------------------------------------------------------------------------
// WS 帧载荷（§4.8）
// ---------------------------------------------------------------------------

interface IrUpdatedPayload {
  project_id: string
  version: number
  updated_by: string
  origin: 'mcp' | 'ui'
}

interface RenderUpdatedPayload {
  render_id: string
  project_id: string
  status: VideoRenderStatus
  frames_done: number
  frames_total: number
  error?: string
}

// iframe postMessage 协议（§4.4.3，逐字）：
//   页面 → iframe：{type:"player", cmd:"seek"|"play"|"pause"|"getState", frame?}
//   iframe → 页面：{type:"player:state", frame, t, durationFrames, ready}
interface PlayerCommand {
  type: 'player'
  cmd: 'seek' | 'play' | 'pause' | 'getState'
  frame?: number
}

interface PlayerState {
  type: 'player:state'
  frame: number
  t: number
  durationFrames: number
  ready: boolean
}

function isPlayerState(data: unknown): data is PlayerState {
  return (
    typeof data === 'object' && data !== null &&
    (data as { type?: unknown }).type === 'player:state' &&
    typeof (data as { frame?: unknown }).frame === 'number'
  )
}

// ---------------------------------------------------------------------------
// 渲染状态 → 徽标语气（沿用框架 statusTone 语义 + video 域补充词）
// ---------------------------------------------------------------------------

const RENDER_STATUS_TONE: Record<VideoRenderStatus, StatusTone> = {
  queued: 'neutral',
  running: 'brand',
  succeeded: 'positive',
  failed: 'critical',
  interrupted: 'warning',
}

const RENDER_STATUS_LABEL: Record<VideoRenderStatus, string> = {
  queued: '排队中',
  running: '渲染中',
  succeeded: '已完成',
  failed: '失败',
  interrupted: '已中断',
}

const TERMINAL_RENDER_STATUS: readonly VideoRenderStatus[] = ['succeeded', 'failed', 'interrupted']

/** 活跃渲染时，WS 静默超过这个时长就启用轮询兜底（后端每 15 帧推一次进度）。 */
const RENDER_WS_STALE_MS = 10_000

/** 词条来源 → 人类可读（IR 的 source 值是开发术语，不进界面文案）。 */
const WORD_SOURCE_LABEL: Record<VideoWord['source'], string> = {
  tts: '配音识别',
  aligner: '语音对齐',
  manual: '手工标注',
  estimated: '按字数估算',
}

/** 词 chip 在 words 时间轴上的宽度权重：时长 + 保底（可点击区不塌成点）。 */
function wordSpan(w: VideoWord): number {
  return Math.max(0.4, w.end - w.start)
}

function newIdempotencyKey(): string {
  const c = globalThis.crypto as Crypto | undefined
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  return `render-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
}

// ---------------------------------------------------------------------------
// 重新组合（POST /compose）：新文案/换模板/换主题 → 一键重排 IR。
// - 必带 expected_version（页面当前 version）乐观锁；409 提示刷新，不静默覆盖。
// - 模板目录（顶层 themes + snake_case 模板字段）随目录请求一起回来。
// - script 默认预填当前 IR script（用户/Agent 改文案后一键重排的主路径）。
// ---------------------------------------------------------------------------

function RecomposeDialog({
  projectId,
  wsId,
  currentVersion,
  currentScript,
  open,
  onOpenChange,
  canWrite,
}: {
  projectId: string
  wsId: string | undefined
  currentVersion: number
  currentScript: string
  open: boolean
  onOpenChange: (v: boolean) => void
  canWrite: boolean
}) {
  const qc = useQueryClient()

  const templatesQ = useQuery({
    queryKey: ['video', 'templates'],
    queryFn: () => videoApi.listTemplates(),
    enabled: open && !!wsId,
    staleTime: 5 * 60_000,
  })
  const templates = templatesQ.data?.templates ?? []
  const themes: VideoTheme[] = templatesQ.data?.themes ?? []
  const defaultThemeKey = themes[0]?.key ?? ''

  const [templateKey, setTemplateKey] = useState('')
  const [themeKey, setThemeKey] = useState('')
  const [script, setScript] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const scriptValue = script ?? currentScript

  // 弹层每次打开复位选择（模板目录带 staleTime，不重复请求）。
  useEffect(() => {
    if (open) {
      setTemplateKey('')
      setThemeKey('')
      setScript(null)
    }
  }, [open])

  const selected = templates.find((t) => t.key === templateKey) ?? null

  const pickTemplate = (t: VideoTemplate) => {
    setTemplateKey(t.key)
    // 主题目录在顶层（模板不带 themes）：默认首项。
    setThemeKey(defaultThemeKey)
  }

  const close = (v: boolean) => onOpenChange(v)

  const submitRecompose = async () => {
    if (!selected) return
    if (!scriptValue.trim()) {
      toast.error('请输入剧本文案')
      return
    }
    setSubmitting(true)
    try {
      await videoApi.compose(projectId, {
        script: scriptValue.trim(),
        template: selected.key,
        theme: themeKey || defaultThemeKey,
        expected_version: currentVersion,
      })
      toast.success('已重新组合')
      await qc.invalidateQueries({ queryKey: ['video', 'project', wsId, projectId] })
      close(false)
    } catch (err: unknown) {
      if (isApiError(err, E_VIDEO_VERSION_CONFLICT)) {
        // 乐观锁冲突：Agent 同期改了项目，不静默覆盖，让用户先看最新版。
        toast.error('项目刚被其他人更新，已为你加载最新版本，请确认后重试')
        await qc.invalidateQueries({ queryKey: ['video', 'project', wsId, projectId] })
      } else {
        toast.error(apiErrorMessage(err, '重新组合失败'))
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>重新组合</DialogTitle>
          <DialogDescription>
            改文案、换模板或主题即可整条时间线重排；若期间有其他人在编辑，会先提示你刷新。
          </DialogDescription>
        </DialogHeader>
        {templatesQ.isPending ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Spinner />
            加载模板…
          </div>
        ) : templatesQ.isError ? (
          <div className="space-y-3 py-6 text-center">
            <p className="text-sm text-muted-foreground">模板目录加载失败（{apiErrorMessage(templatesQ.error, '请稍后重试')}）</p>
            <Button variant="outline" size="sm" onClick={() => void templatesQ.refetch()}>
              重试
            </Button>
          </div>
        ) : templates.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">当前没有可用的模板。</p>
        ) : (
          <div className="space-y-4">
            <div role="radiogroup" aria-label="模板选择" className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {templates.map((t, i) => (
                <button
                  key={t.key}
                  type="button"
                  role="radio"
                  aria-checked={t.key === templateKey}
                  data-testid="recompose-template-card"
                  onClick={() => pickTemplate(t)}
                  {...radioNavProps({
                    index: i,
                    count: templates.length,
                    checkedIndex: Math.max(0, templates.findIndex((x) => x.key === templateKey)),
                    onSelect: (next) => {
                      const hit = templates[next]
                      if (hit) pickTemplate(hit)
                    },
                  })}
                  className={cn(
                    'flex h-full flex-col gap-2 rounded-lg border p-2.5 text-left transition-colors',
                    'hover:border-primary/40 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    t.key === templateKey ? 'border-primary bg-primary/5' : 'border-border bg-card',
                  )}
                >
                  <TemplateThumbnail template={t} theme={themes[0]} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{t.name}</p>
                    <p className="mt-1 font-mono text-[11px] text-muted-foreground/80">
                      {t.canvas_w}×{t.canvas_h} · {t.fps}fps
                    </p>
                  </div>
                </button>
              ))}
            </div>
            {selected && themes.length > 0 && (
              <div role="radiogroup" aria-label="主题选择" className="flex flex-wrap gap-2">
                {themes.map((th, i) => {
                  const active = th.key === themeKey
                  return (
                    <button
                      key={th.key}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      data-testid="recompose-theme-option"
                      onClick={() => setThemeKey(th.key)}
                      {...radioNavProps({
                        index: i,
                        count: themes.length,
                        checkedIndex: Math.max(0, themes.findIndex((x) => x.key === themeKey)),
                        onSelect: (next) => {
                          const hit = themes[next]
                          if (hit) setThemeKey(hit.key)
                        },
                      })}
                      className={cn(
                        'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        active ? 'border-primary bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:border-primary/40 hover:bg-muted/40',
                      )}
                    >
                      <ThemeDot theme={th} />
                      {th.name}
                    </button>
                  )
                })}
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="recompose-script">剧本文案</Label>
              <Textarea
                id="recompose-script"
                value={scriptValue}
                onChange={(e) => setScript(e.target.value)}
                rows={6}
                maxLength={5000}
                placeholder="输入口播脚本…（默认预填当前脚本）"
                className="min-h-32 font-mono text-sm"
              />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={submitting} onClick={() => close(false)}>
            取消
          </Button>
          <Button
            type="button"
            disabled={!canWrite || submitting || templatesQ.isPending || templatesQ.isError || !selected}
            onClick={() => void submitRecompose()}
          >
            {submitting ? (
              <>
                <Spinner />
                组合中…
              </>
            ) : (
              <>
                <Wand2 size={14} aria-hidden="true" />
                重新组合
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function VideoStudioPage({ projectId }: { projectId: string }) {
  const qc = useQueryClient()
  const { current: workspace } = useWorkspace()
  const wsId = workspace?.id
  const canWrite = hasPerm(workspace?.role_perms, 'video:write')
  const canRender = hasPerm(workspace?.role_perms, 'video:render')
  const wsStatus = useWsStatus(wsClient)

  // -------------------------------------------------------------------------
  // 数据（查询键带 wsId：切工作区不串缓存，未水合不发请求）
  // -------------------------------------------------------------------------

  const projectQ = useQuery({
    queryKey: ['video', 'project', wsId, projectId],
    enabled: !!wsId && !!projectId,
    queryFn: () => videoApi.getProject(projectId),
  })
  const project = projectQ.data?.project
  const ir = projectQ.data?.ir

  const rendersQ = useQuery({
    queryKey: ['video', 'renders', wsId, projectId],
    enabled: !!wsId && !!projectId,
    queryFn: () => videoApi.listRenders(projectId),
  })
  const renders = useMemo(
    () => [...(rendersQ.data?.items ?? [])].sort(
      (a, b) => (b.created_at > a.created_at ? 1 : -1),
    ),
    [rendersQ.data],
  )

  // 播放器状态（postMessage 回流）
  const [player, setPlayer] = useState<PlayerState | null>(null)
  const [playing, setPlaying] = useState(false)

  // scrub 帧号：优先播放器上报的 durationFrames；降级用后端同源公式
  // （max(ceil(meta*fps), ceil(voice*fps), ceil(lastWord.end*fps))）。
  const durationFrames = useMemo(
    () => resolveDurationFrames(ir, player?.durationFrames),
    [player, ir],
  )

  const [frame, setFrame] = useState(0)

  // iframe 引用与 postMessage 通道
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const sendCmd = useCallback((cmd: PlayerCommand['cmd'], frameArg?: number) => {
    const win = iframeRef.current?.contentWindow
    if (!win) return
    const msg: PlayerCommand = { type: 'player', cmd, ...(cmd === 'seek' ? { frame: frameArg } : {}) }
    win.postMessage(msg, window.location.origin)
  }, [])

  const seek = useCallback((f: number) => {
    const clamped = Math.max(0, Math.min(f, Math.max(0, durationFrames - 1)))
    setFrame(clamped)
    sendCmd('seek', clamped)
  }, [durationFrames, sendCmd])

  // 播放器状态回流（origin 校验：双方均须 window.location.origin，§4.4.3）
  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      if (ev.origin !== window.location.origin) return
      if (ev.source !== iframeRef.current?.contentWindow) return
      if (!isPlayerState(ev.data)) return
      setPlayer(ev.data)
      if (!ev.data.ready) setPlaying(false)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  // preview.html 换版（IR 版本变化）→ 重置播放器状态。iframe 的 key 就是
  // project.version：版本不变时 refetch 不会重挂文档（旧实现用 dataUpdatedAt
  // 当 key，同数据每次 refetch 都白掉一次播放器）。
  const previewKey = project?.version ?? 0
  useEffect(() => {
    setPlayer(null)
    setPlaying(false)
    setFrame(0)
  }, [previewKey])

  // 播放中本地帧号推进（播放器不逐帧推送；state 帧只在 seek/ready 等节点回）
  useEffect(() => {
    if (!playing) return
    const timer = setInterval(() => {
      setFrame((f) => {
        const next = f + 1
        if (durationFrames > 0 && next >= durationFrames) {
          setPlaying(false)
          return durationFrames - 1
        }
        return next
      })
    }, ir?.meta.fps ? 1000 / ir.meta.fps : 33)
    return () => clearInterval(timer)
  }, [playing, durationFrames, ir?.meta.fps])

  // 播放/暂停/点击词条/效果锚点
  const togglePlay = useCallback(() => {
    if (playing) {
      sendCmd('pause')
      setPlaying(false)
    } else {
      sendCmd('play')
      sendCmd('getState')
      setPlaying(true)
    }
  }, [playing, sendCmd])

  const seekToSec = useCallback((sec: number) => {
    const fps = ir?.meta.fps ?? 30
    seek(Math.round(sec * fps))
  }, [ir?.meta.fps, seek])

  // -------------------------------------------------------------------------
  // WS 接线（§5.4）：mount connect（若未连）+ scope 订阅 + 帧处理 + bridge 兜底
  // -------------------------------------------------------------------------

  useEffect(() => {
    wsClient.connect()
    return () => wsClient.close()
  }, [])

  useWsScope('video', projectId, wsClient)

  // 订阅被拒 / 确认：服务端拒绝（未授权、id 非法、限流）时 socket 仍是 open，
  // 只盯 open 会把「永远收不到帧」误判为健康——这就是单独记录拒绝的原因。
  const [wsSubRejected, setWsSubRejected] = useState(false)
  useEffect(() => { setWsSubRejected(false) }, [projectId])
  useWsFrame('rejected:subscribe', (frameMsg) => {
    const p = frameMsg.payload as { scope?: string } | undefined
    if (!p || p.scope === undefined || p.scope === 'video') setWsSubRejected(true)
  }, wsClient)
  useWsFrame('confirmed:subscribe', (frameMsg) => {
    const p = frameMsg.payload as { scope?: string } | undefined
    if (!p || p.scope === 'video') setWsSubRejected(false)
  }, wsClient)

  // Agent/其他端改了 IR → refetch（origin==='ui' 的自推也 refetch：幂等且对齐版本号）
  useWsFrame('video.ir.updated', (frameMsg) => {
    const p = frameMsg.payload as IrUpdatedPayload | undefined
    if (!p || p.project_id !== projectId) return
    qc.invalidateQueries({ queryKey: ['video', 'project', wsId, projectId] })
  }, wsClient)

  // 渲染进度帧 → 更新历史行（就地 merge，省一次列表 refetch；终态再失效一次拉全量）
  const lastRenderFrameAt = useRef(0)
  const mergeRenderFrame = useCallback((p: RenderUpdatedPayload) => {
    lastRenderFrameAt.current = Date.now()
    qc.setQueryData<{ items: VideoRender[] }>(['video', 'renders', wsId, projectId], (old) => {
      if (!old) return old
      const items = old.items.map((r) =>
        r.id === p.render_id
          ? { ...r, status: p.status, frames_done: p.frames_done, frames_total: p.frames_total, error: p.error }
          : r,
      )
      return { items }
    })
    if (TERMINAL_RENDER_STATUS.includes(p.status)) {
      qc.invalidateQueries({ queryKey: ['video', 'renders', wsId, projectId] })
    }
  }, [qc, wsId, projectId])

  useWsFrame('video.render.updated', (frameMsg) => {
    const p = frameMsg.payload as RenderUpdatedPayload | undefined
    if (!p || p.project_id !== projectId) return
    mergeRenderFrame(p)
  }, wsClient)

  // bridgeWsToQuery：WS 重连后的兜底失效（连接重建期间丢帧的补偿）
  useEffect(() => {
    return bridgeWsToQuery(wsClient, qc, [
      { match: 'video.ir.updated', invalidate: [['video', 'project', wsId, projectId]] },
      { match: 'video.render.updated', invalidate: [['video', 'renders', wsId, projectId]] },
    ])
  }, [qc, wsId, projectId])

  // 轮询兜底：有活跃渲染 +（连接未开 / 订阅被拒 / 超过 N 秒没收到渲染帧）。
  // 没有活跃渲染 → 不轮询（保留原语义）。
  const hasActiveRender = renders.some((r) => r.status === 'queued' || r.status === 'running')
  const [wsStale, setWsStale] = useState(false)
  useEffect(() => {
    if (!hasActiveRender) {
      setWsStale(false)
      return
    }
    // 进入活跃态先给一个宽限期（避免刚提交就因「还没收到帧」立刻轮询）。
    lastRenderFrameAt.current = Date.now()
    const timer = setInterval(() => {
      setWsStale(Date.now() - lastRenderFrameAt.current > RENDER_WS_STALE_MS)
    }, 1000)
    return () => clearInterval(timer)
  }, [hasActiveRender])

  const needsPolling = hasActiveRender && (wsStatus !== 'open' || wsSubRejected || wsStale)
  useEffect(() => {
    if (!needsPolling) return
    const timer = setInterval(() => {
      void qc.invalidateQueries({ queryKey: ['video', 'renders', wsId, projectId] })
    }, 1000)
    return () => clearInterval(timer)
  }, [needsPolling, qc, wsId, projectId])

  // -------------------------------------------------------------------------
  // 脚本编辑 + 保存（PUT ir，乐观锁）
  // -------------------------------------------------------------------------

  const [scriptDraft, setScriptDraft] = useState<string | null>(null)
  const scriptValue = scriptDraft ?? ir?.script ?? ''
  const scriptDirty = scriptDraft !== null && scriptDraft !== (ir?.script ?? '')

  // 草稿起点版本：第一次输入时记下当时的 version，保存时用它做 expected_version。
  // 这样即使期间别人改过项目（refetch 把 version 推进了），这次保存也会得到
  // 冲突提示而不是静默覆盖对方 —— 同时也意味着远端更新不会清掉用户正在输入的文字
  // （旧实现按 dataUpdatedAt 清草稿，保存期间继续输入的内容会被吞掉）。
  const draftBaseVersionRef = useRef<number | null>(null)

  const [saving, setSaving] = useState(false)
  const saveScript = async () => {
    if (!ir || !project) return
    const submitted = scriptValue
    const expectedVersion = draftBaseVersionRef.current ?? project.version
    setSaving(true)
    try {
      const nextIR: VideoIR = { ...ir, script: submitted }
      await videoApi.putIR(projectId, { ir: nextIR, expected_version: expectedVersion })
      // 只清掉「仍然是提交值」的草稿：保存期间用户继续输入的文字不能被吞。
      setScriptDraft((prev) => (prev === submitted ? null : prev))
      if (draftBaseVersionRef.current === expectedVersion) draftBaseVersionRef.current = null
      toast.success('已保存')
      await qc.invalidateQueries({ queryKey: ['video', 'project', wsId, projectId] })
    } catch (err: unknown) {
      if (isApiError(err, E_VIDEO_VERSION_CONFLICT)) {
        // 乐观锁冲突（他人同期写入了新版本）：提示刷新，以服务端为准。
        toast.error('项目刚被其他人更新，已为你加载最新版本，请确认后重试')
        draftBaseVersionRef.current = null
        await qc.invalidateQueries({ queryKey: ['video', 'project', wsId, projectId] })
        setScriptDraft((prev) => (prev === submitted ? null : prev))
      } else {
        toast.error(apiErrorMessage(err, '保存失败'))
      }
    } finally {
      setSaving(false)
    }
  }

  // -------------------------------------------------------------------------
  // 渲染参数面板 + 提交渲染
  // -------------------------------------------------------------------------

  const [fps, setFps] = useState('')
  const [resPreset, setResPreset] = useState('meta')
  const [subtitleMode, setSubtitleMode] = useState<'burn' | 'soft' | 'none'>('burn')
  const [bgmVolume, setBgmVolume] = useState('') // 空串 = 跟随项目默认

  const [rendering, setRendering] = useState(false)
  // 幂等键在「一次提交尝试」内保持稳定：网络超时后重试会把同一个 key 发出去，
  // 后端据此返回首单而不是再扣一次配额。成功 / 明确业务拒绝后重置。
  const idempotencyRef = useRef<string | null>(null)
  const submitRender = async () => {
    if (!project) return
    const params: VideoRenderParams = { subtitle_mode: subtitleMode, burn_subtitles: subtitleMode === 'burn' }
    if (fps !== '') params.fps = Number(fps)
    if (resPreset !== 'meta') {
      const [w, h] = resPreset.split('x').map((n) => Number(n))
      if (w > 0 && h > 0) {
        params.width = w
        params.height = h
      }
    }
    if (bgmVolume !== '') params.bgm_volume = Number(bgmVolume) / 100
    idempotencyRef.current ??= newIdempotencyKey()
    setRendering(true)
    try {
      const render = await videoApi.submitRender(projectId, params, idempotencyRef.current)
      // 已确认入队：本次尝试结束，下一次点击是新的提交。
      idempotencyRef.current = null
      lastRenderFrameAt.current = Date.now()
      toast.success(`已提交渲染${render?.frames_total ? `（共 ${render.frames_total} 帧）` : ''}`)
      await qc.invalidateQueries({ queryKey: ['video', 'renders', wsId, projectId] })
    } catch (err: unknown) {
      if (isApiError(err) && err.kind === 'business') {
        // 业务拒绝（400/402/403/409…）→ 服务端没有建渲染行，无需复用 key。
        idempotencyRef.current = null
      }
      toast.error(apiErrorMessage(err, '提交渲染失败'))
    } finally {
      setRendering(false)
    }
  }

  // 素材上传（POST /api/video/assets，multipart，后端上限 50MiB）
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [uploading, setUploading] = useState(false)
  const [lastUpload, setLastUpload] = useState<{ key: string; url: string; size: number } | null>(null)
  const onUploadAsset = async (file: File) => {
    if (file.size > VIDEO_ASSET_MAX_BYTES) {
      toast.error('素材上限 50MiB，请压缩后再上传')
      return
    }
    setUploading(true)
    try {
      // project_id 是后端必填的表单字段（归属登记），key 才会落到本项目名下。
      const res = await videoApi.uploadAsset(file, projectId)
      setLastUpload(res)
      toast.success('素材已上传')
    } catch (err: unknown) {
      toast.error(apiErrorMessage(err, '上传失败'))
    } finally {
      setUploading(false)
    }
  }

  const copyAssetKey = async () => {
    if (!lastUpload) return
    try {
      await navigator.clipboard.writeText(lastUpload.key)
      toast.success('已复制素材 key')
    } catch {
      toast.error('复制失败，请手动选中文本复制')
    }
  }

  // -------------------------------------------------------------------------
  // 渲染历史列
  // -------------------------------------------------------------------------

  const renderColumns: Column<VideoRender>[] = [
    {
      key: 'id',
      header: 'ID',
      render: (r) => <span className="font-mono text-xs text-muted-foreground">{shortID(r.id)}</span>,
    },
    {
      key: 'status',
      header: '状态',
      render: (r) => (
        <StatusBadge label={RENDER_STATUS_LABEL[r.status]} tone={RENDER_STATUS_TONE[r.status]} />
      ),
    },
    {
      key: 'progress',
      header: '进度',
      render: (r) => {
        const pct = r.frames_total > 0 ? Math.round((r.frames_done / r.frames_total) * 100) : 0
        return (
          <div className="flex min-w-40 items-center gap-2">
            {/* Progress 根组件自带 Track+Indicator（progress.tsx），调用方只补 Value。
                再手写一层 ProgressTrack/ProgressIndicator 会叠出两条轨道。 */}
            <Progress value={pct} className="flex-1" aria-label={`渲染进度 ${pct}%`}>
              <ProgressValue className="w-10 shrink-0 text-xs">{(v) => `${v}%`}</ProgressValue>
            </Progress>
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              {r.frames_done}/{r.frames_total || '—'} 帧
            </span>
          </div>
        )
      },
    },
    {
      key: 'created_at',
      header: '提交时间',
      render: (r) => <span className="text-muted-foreground">{formatDateTime(r.created_at)}</span>,
    },
    {
      key: 'output',
      header: '输出',
      render: (r) =>
        r.status === 'succeeded' && r.output_url ? (
          <div className="flex items-center gap-3">
            {r.thumb_url && (
              <img
                src={videoApi.fileUrl(r.thumb_url, wsId ?? '')}
                alt="首帧缩略图"
                loading="lazy"
                className="h-14 w-10 shrink-0 rounded border border-border bg-muted object-cover"
              />
            )}
            <a
              href={videoApi.fileUrl(r.output_url, wsId ?? '')}
              download
              className="inline-flex items-center gap-1 text-sm text-primary underline-offset-4 hover:underline"
            >
              <Download size={14} aria-hidden="true" />
              下载 mp4
            </a>
          </div>
        ) : r.status === 'failed' || r.status === 'interrupted' ? (
          <span className="text-xs text-destructive" title={r.error ?? ''}>
            {r.error ? r.error.slice(0, 60) : '—'}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
  ]

  // -------------------------------------------------------------------------
  // 重新组合入口弹层状态
  // -------------------------------------------------------------------------

  const [recomposeOpen, setRecomposeOpen] = useState(false)

  // -------------------------------------------------------------------------
  // 渲染
  // -------------------------------------------------------------------------

  if (!projectId) {
    return <PageError message="缺少项目 ID" />
  }
  if ((!wsId || projectQ.isPending) && !projectQ.isError) {
    return <PageLoading label="加载项目…" />
  }
  if (projectQ.isError) {
    return (
      <PageError
        message={apiErrorMessage(projectQ.error, '项目加载失败')}
        onRetry={() => void projectQ.refetch()}
      />
    )
  }
  if (!project || !ir) {
    return <PageError message="项目不存在或已被删除" />
  }

  const agentOnline = wsStatus === 'open'
  const writeHintId = 'video-write-hint'
  const renderHintId = 'video-render-hint'

  return (
    <div className="space-y-6">
      <PageHeader
        title={project.title}
        description={`v${project.version} · 更新于 ${formatDateTime(project.updated_at)}`}
        leading={
          <Link
            to="/studio"
            aria-label="返回项目列表"
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ArrowLeft size={16} aria-hidden="true" />
          </Link>
        }
        actions={
          <div className="flex items-center gap-2">
            <Badge className={cn('gap-1.5', agentOnline ? STATUS_TONE_CLASS.positive : STATUS_TONE_CLASS.neutral)}>
              <Sparkles size={13} aria-hidden="true" />
              Agent {agentOnline ? '在线' : '离线'}
            </Badge>
            <Popover>
              <PopoverTrigger
                render={
                  <Button size="sm" variant="outline" disabled={!canWrite} aria-label="更多项目操作" />
                }
              >
                <Wand2 size={14} aria-hidden="true" />
                重新组合
              </PopoverTrigger>
              <PopoverContent align="end" className="w-52 p-1">
                <button
                  type="button"
                  onClick={() => setRecomposeOpen(true)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Wand2 size={14} aria-hidden="true" />
                  重新组合…
                </button>
              </PopoverContent>
            </Popover>
          </div>
        }
      />

      {/* 三栏主体：窄屏纵向堆叠 */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[320px_minmax(0,1fr)_360px]">
        {/* 左栏：脚本 + 词条时间轴 */}
        <div className="space-y-4">
          <section className="space-y-2 rounded-lg border bg-card p-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground">脚本</h2>
              <Button
                size="xs"
                variant={scriptDirty ? 'default' : 'outline'}
                onClick={() => void saveScript()}
                disabled={!canWrite || saving || !scriptDirty}
              >
                {saving ? '保存中…' : scriptDirty ? '保存' : '已同步'}
              </Button>
            </div>
            <Textarea
              value={scriptValue}
              onChange={(e) => {
                // 第一次输入时锚定当前 version：保存用它做乐观锁基准，
                // 期间别人推进版本会得到冲突提示而不是静默覆盖。
                if (draftBaseVersionRef.current === null) draftBaseVersionRef.current = project.version
                setScriptDraft(e.target.value)
              }}
              rows={10}
              maxLength={5000}
              disabled={!canWrite}
              placeholder="输入口播脚本…（≤5000 字符；保存后服务端会重新切分词级时间并更新动效位置）"
              className="min-h-40 font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">
              {scriptValue.length}/5000 字符
              {!canWrite && ' · 当前角色只能查看，保存需要编辑权限'}
            </p>
          </section>

          <section className="space-y-2 rounded-lg border bg-card p-3">
            <h2 className="text-sm font-semibold text-foreground">词条时间轴</h2>
            {ir.words.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                暂无词条。保存脚本后（配音或对齐可用时）会自动生成词级时间。
              </p>
            ) : (
              <div className="flex flex-wrap gap-1">
                {ir.words.map((w) => (
                  <button
                    key={w.index}
                    type="button"
                    onClick={() => seekToSec(w.start)}
                    style={{ minWidth: `${wordSpan(w) * 3}rem` }}
                    title={`第 ${w.index + 1} 个词 · ${w.start.toFixed(2)}s–${w.end.toFixed(2)}s（${WORD_SOURCE_LABEL[w.source] ?? '未知来源'}）`}
                    className="rounded border border-border bg-muted/40 px-1.5 py-0.5 text-xs text-foreground hover:border-primary/50 hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {w.text}
                  </button>
                ))}
              </div>
            )}
            {ir.audio?.voice && (
              <p className="text-xs text-muted-foreground">
                配音时长：{ir.audio.voice.durationSec.toFixed(1)} 秒
                {ir.audio.bgm ? ` · 背景音乐音量 ${Math.round(ir.audio.bgm.volume * 100)}%` : ''}
              </p>
            )}
          </section>
        </div>

        {/* 中央：9:16 预览 + scrub 条 */}
        <div className="space-y-3">
          <section className="flex justify-center rounded-lg border bg-card p-4">
            {/* 9:16 等比缩放容器：aspect-[9/16] + max 高度约束，iframe 铺满容器 */}
            <div className="aspect-[9/16] max-h-[62svh] w-full max-w-[min(100%,calc(62svh*9/16))] overflow-hidden rounded-md border bg-black">
              <iframe
                key={previewKey}
                ref={iframeRef}
                src={videoApi.previewUrl(projectId, wsId ?? '')}
                title={`预览：${project.title}`}
                className="h-full w-full"
                // 不加 sandbox：§4.4.4 的隔离面是 preview.html 响应自身
                // （frame-ancestors 'self' + 常量脚本哈希 CSP）；sandbox+
                // allow-same-origin+allow-scripts 组合不提供额外隔离，反而会
                // 让 iframe 内的 origin 校验（event.origin === location.origin）
                // 变成 opaque origin，postMessage 协议直接失效。
              />
            </div>
          </section>

          <section className="flex items-center gap-3 rounded-lg border bg-card px-3 py-2">
            <Button size="icon" variant="outline" onClick={togglePlay} aria-label={playing ? '暂停' : '播放'} disabled={durationFrames === 0}>
              {playing ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
            </Button>
            <Slider
              min={0}
              max={Math.max(0, durationFrames - 1)}
              step={1}
              value={Math.min(frame, Math.max(0, durationFrames - 1))}
              onValueChange={(v) => seek(Array.isArray(v) ? v[0] : v)}
              disabled={durationFrames === 0}
              className="w-full flex-1"
              thumbAriaLabel="时间线位置（帧）"
            />
            <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
              {Math.min(frame, Math.max(0, durationFrames - 1))}/{durationFrames || '—'} 帧
            </span>
          </section>
        </div>

        {/* 右栏：效果列表 + 渲染参数 */}
        <div className="space-y-4">
          <section className="space-y-2 rounded-lg border bg-card p-3">
            <h2 className="text-sm font-semibold text-foreground">效果（{ir.effects.length}）</h2>
            {ir.effects.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                暂无动效。可以让 Agent 在文案的指定位置添加动效。
              </p>
            ) : (
              <ul className="space-y-1.5">
                {ir.effects.map((fx) => {
                  const word = fx.resolvedFrom ? ir.words[fx.resolvedFrom.wordIndex] : undefined
                  const unresolved = !word
                  return (
                    <li key={fx.id}>
                      <button
                        type="button"
                        disabled={!word}
                        onClick={() => word && seekToSec(word.start)}
                        className="flex w-full items-center justify-between gap-2 rounded border border-border px-2 py-1.5 text-left text-xs hover:border-primary/40 hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <Badge className={STATUS_TONE_CLASS.brand}>{fx.type}</Badge>
                        <span className="min-w-0 flex-1 truncate text-muted-foreground">
                          {word ? `在第 ${word.index + 1} 个词「${word.text}」（${word.start.toFixed(2)}s）` : '对应的词已不在文案中'}
                        </span>
                        {unresolved && (
                          <Badge className={STATUS_TONE_CLASS.warning}>待重新定位</Badge>
                        )}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>

          <section className="space-y-3 rounded-lg border bg-card p-3">
            <h2 className="text-sm font-semibold text-foreground">渲染参数</h2>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label htmlFor="video-fps">帧率</Label>
                <Select value={fps} onValueChange={(v) => setFps(v)}>
                  <SelectTrigger id="video-fps" className="w-full">
                    <SelectValue>{fps === '' ? `跟随项目（${ir.meta.fps}）` : fps}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">跟随项目</SelectItem>
                    <SelectItem value="24">24</SelectItem>
                    <SelectItem value="25">25</SelectItem>
                    <SelectItem value="30">30</SelectItem>
                    <SelectItem value="50">50</SelectItem>
                    <SelectItem value="60">60</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="video-res">分辨率</Label>
                <Select value={resPreset} onValueChange={(v) => setResPreset(v)}>
                  <SelectTrigger id="video-res" className="w-full">
                    <SelectValue>
                      {resPreset === 'meta' ? `跟随项目（${ir.meta.width}×${ir.meta.height}）` : resPreset}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="meta">跟随项目</SelectItem>
                    <SelectItem value="1080x1920">1080×1920（9:16）</SelectItem>
                    <SelectItem value="720x1280">720×1280（9:16）</SelectItem>
                    <SelectItem value="1920x1080">1920×1080（16:9）</SelectItem>
                    <SelectItem value="1080x1080">1080×1080（1:1）</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="video-subtitle">字幕</Label>
                <Select value={subtitleMode} onValueChange={(v) => setSubtitleMode(v === 'soft' ? 'soft' : v === 'none' ? 'none' : 'burn')}>
                  <SelectTrigger id="video-subtitle" className="w-full">
                    <SelectValue>
                      {subtitleMode === 'burn' ? '烧录' : subtitleMode === 'soft' ? '软字幕' : '无'}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="burn">烧录</SelectItem>
                    <SelectItem value="soft">软字幕</SelectItem>
                    <SelectItem value="none">无</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="video-bgm">BGM 音量</Label>
                <div className="flex items-center gap-2">
                  <Slider
                    min={0}
                    max={100}
                    step={5}
                    value={bgmVolume === '' ? Math.round((ir.audio?.bgm?.volume ?? 0.3) * 100) : Number(bgmVolume)}
                    onValueChange={(v) => setBgmVolume(String(Array.isArray(v) ? v[0] : v))}
                    thumbAriaLabel="背景音乐音量（%）"
                  />
                  <span className="w-10 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">
                    {bgmVolume === '' ? `${Math.round((ir.audio?.bgm?.volume ?? 0.3) * 100)}%` : `${bgmVolume}%`}
                  </span>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between gap-2">
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void onUploadAsset(f)
                  e.target.value = ''
                }}
              />
              <Button
                size="sm"
                variant="outline"
                disabled={!canWrite || uploading}
                aria-describedby={!canWrite ? writeHintId : undefined}
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload size={14} aria-hidden="true" />
                {uploading ? '上传中…' : '上传素材'}
              </Button>
              <Button
                size="sm"
                onClick={() => void submitRender()}
                disabled={!canRender || rendering}
                aria-describedby={!canRender ? renderHintId : undefined}
                title={!canRender ? '渲染需要管理员/所有者权限' : undefined}
              >
                {rendering ? (
                  <>
                    <RefreshCw size={14} className="animate-spin" aria-hidden="true" />
                    提交中…
                  </>
                ) : (
                  <>
                    <Clapperboard size={14} aria-hidden="true" />
                    渲染
                  </>
                )}
              </Button>
            </div>
            {!canRender && (
              <p id={renderHintId} className="text-xs text-muted-foreground">
                渲染需要管理员/所有者权限：当前角色可编辑项目，但提交渲染会消耗工作区配额。
              </p>
            )}
            {!canWrite && (
              <p id={writeHintId} className="text-xs text-muted-foreground">
                保存脚本与上传素材需要编辑权限。
              </p>
            )}
            {lastUpload && (
              <div className="space-y-1 rounded border border-border bg-muted/30 p-2">
                <p className="text-xs text-muted-foreground">素材 key（可复制，供动效编排或 Agent 引用）</p>
                <div className="flex items-start gap-2">
                  <code className="min-w-0 flex-1 break-all font-mono text-xs text-foreground select-all">
                    {lastUpload.key}
                  </code>
                  <Button size="xs" variant="outline" onClick={() => void copyAssetKey()}>
                    <Copy size={12} aria-hidden="true" />
                    复制
                  </Button>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>

      {/* 底部：渲染历史 */}
      <section className="space-y-3">
        <h2 className="text-base font-semibold text-foreground">渲染历史</h2>
        {rendersQ.isError ? (
          <PageError
            message={apiErrorMessage(rendersQ.error, '渲染历史加载失败')}
            onRetry={() => void rendersQ.refetch()}
          />
        ) : (
          <DataTable
            columns={renderColumns}
            rows={renders}
            rowKey={(r) => r.id}
            loading={rendersQ.isPending}
            empty={<PageEmpty label="暂无渲染记录" hint="点击右栏「渲染」提交第一次云端渲染" />}
          />
        )}
      </section>

      {/* 重新组合（compose） */}
      <RecomposeDialog
        projectId={projectId}
        wsId={wsId}
        currentVersion={project.version}
        currentScript={ir.script}
        open={recomposeOpen}
        onOpenChange={setRecomposeOpen}
        canWrite={canWrite}
      />
    </div>
  )
}
