import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '../deps'
import { Link } from '@ploykit/ui/router'
import {
  PageHeader, PageLoading, PageError, PageEmpty, Button, Textarea, Input, Label,
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Slider,
  DataTable, StatusBadge, Badge, Progress, ProgressTrack, ProgressIndicator, ProgressValue,
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
  Popover, PopoverContent, PopoverTrigger,
  Spinner, toast, apiErrorMessage, cn, formatDateTime, shortID, STATUS_TONE_CLASS, type StatusTone, type Column,
} from '@ploykit/ui'
import {
  ArrowLeft, Clapperboard, Download, Pause, Play, RefreshCw, Sparkles, Upload, Wand2,
} from 'lucide-react'
import { useWorkspace, useWsStatus, useWsScope, useWsFrame, bridgeWsToQuery } from '@ploykit/hooks'
import type { WsStatus } from '@ploykit/client'
import { videoApi, E_VIDEO_VERSION_CONFLICT, isApiError } from '../api/video'
import type {
  VideoIR, VideoRender, VideoRenderParams, VideoRenderStatus, VideoWord,
  VideoTemplate, VideoTheme,
} from '../api/video'
import { TemplateThumbnail, ThemeDot } from './VideoStudioListPage'
import { wsClient } from '../ws'

/**
 * /studio/:id 工作室页（§5.2 布局）：
 *
 *   ┌ PageHeader: 项目名 · version · Agent 在线指示 ─────────────────────┐
 *   ├ 左栏(320px)         │ 中央 9:16 预览          │ 右栏(360px)        │
 *   │ 脚本编辑 + 保存      │ iframe preview.html    │ 效果列表(click→seek)│
 *   │ 词条时间轴(chips)    │ 9:16 等比缩放           │ 渲染参数面板        │
 *   ├ scrub 条 + 播放/暂停 + 帧号 ──────────────────────────────────────┤
 *   ├ 渲染历史 DataTable（status / 进度 / 下载）────────────────────────┤
 *
 * WS：mount 时 connect（若未连），useWsScope('video', projectId) 订阅；
 * `video.ir.updated` → refetch 项目；`video.render.updated` → 更新渲染历史行
 * （bridgeWsToQuery 兜底失效 ['video','renders',id]，active 渲染另有 1s 轮询兜底）。
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

/** 词 chip 在 words 时间轴上的宽度权重：时长 + 保底（可点击区不塌成点）。 */
function wordSpan(w: VideoWord): number {
  return Math.max(0.4, w.end - w.start)
}

// ---------------------------------------------------------------------------
// 重新组合（POST /compose，批B）：新文案/换模板/换主题 → 一键重排 IR。
// - 必带 expected_version（页面当前 version）乐观锁；409 提示刷新，不静默覆盖。
// - 模板目录打不开（批B 未部署）时入口禁用 + title 提示。
// - script 默认预填当前 IR script（用户/Agent 改文案后一键重排的主路径）。
// ---------------------------------------------------------------------------

function RecomposeDialog({
  projectId,
  currentVersion,
  currentScript,
  open,
  onOpenChange,
}: {
  projectId: string
  currentVersion: number
  currentScript: string
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const qc = useQueryClient()

  const templatesQ = useQuery({
    queryKey: ['video', 'templates'],
    queryFn: () => videoApi.listTemplates(),
    enabled: open,
    staleTime: 5 * 60_000,
  })
  const templates = templatesQ.data?.templates ?? []

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
    setThemeKey(t.themes[0]?.key ?? '')
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
        theme: themeKey || selected.themes[0]?.key || '',
        expected_version: currentVersion,
      })
      toast.success('已重新组合')
      // 复用页面既有 IR 刷新路径：invalidate 后 WS/previewKey 效应重置播放器。
      await qc.invalidateQueries({ queryKey: ['video', 'project', projectId] })
      close(false)
    } catch (err: unknown) {
      if (isApiError(err, E_VIDEO_VERSION_CONFLICT)) {
        // 乐观锁冲突：Agent 同期改了项目，不静默覆盖，让用户先看最新版。
        toast.error('项目已更新，请刷新后重试')
        await qc.invalidateQueries({ queryKey: ['video', 'project', projectId] })
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
            改文案、换模板或主题，按 v{currentVersion} 乐观锁一键重排整条时间线。
          </DialogDescription>
        </DialogHeader>
        {templatesQ.isPending ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Spinner />
            加载模板…
          </div>
        ) : templatesQ.isError ? (
          <div className="space-y-3 py-6 text-center">
            <p className="text-sm text-muted-foreground">模板服务暂不可用（{apiErrorMessage(templatesQ.error, '加载失败')}）</p>
            <Button variant="outline" size="sm" onClick={() => void templatesQ.refetch()}>
              重试
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div role="radiogroup" aria-label="模板选择" className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {templates.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  role="radio"
                  aria-checked={t.key === templateKey}
                  data-testid="recompose-template-card"
                  onClick={() => pickTemplate(t)}
                  className={cn(
                    'flex h-full flex-col gap-2 rounded-lg border p-2.5 text-left transition-colors',
                    'hover:border-primary/40 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    t.key === templateKey ? 'border-primary bg-primary/5' : 'border-border bg-card',
                  )}
                >
                  <TemplateThumbnail template={t} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{t.name}</p>
                    <p className="mt-1 font-mono text-[11px] text-muted-foreground/80">
                      {t.canvasW}×{t.canvasH} · {t.fps}fps
                    </p>
                  </div>
                </button>
              ))}
            </div>
            {selected && selected.themes.length > 0 && (
              <div role="radiogroup" aria-label="主题选择" className="flex flex-wrap gap-2">
                {selected.themes.map((th: VideoTheme) => {
                  const active = th.key === themeKey
                  return (
                    <button
                      key={th.key}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      data-testid="recompose-theme-option"
                      onClick={() => setThemeKey(th.key)}
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
            disabled={submitting || templatesQ.isPending || templatesQ.isError || !selected}
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
  const wsStatus = useWsStatus(wsClient)

  // -------------------------------------------------------------------------
  // 数据
  // -------------------------------------------------------------------------

  const projectQ = useQuery({
    queryKey: ['video', 'project', projectId],
    enabled: !!projectId,
    queryFn: () => videoApi.getProject(projectId),
  })
  const project = projectQ.data?.project
  const ir = projectQ.data?.ir

  const rendersQ = useQuery({
    queryKey: ['video', 'renders', projectId],
    enabled: !!projectId,
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

  // scrub 帧号：优先播放器上报的 durationFrames；降级用 ir.meta 与 words 推算
  const durationFrames = useMemo(() => {
    if (player && player.durationFrames > 0) return Math.ceil(player.durationFrames)
    if (!ir) return 0
    const metaFrames = Math.ceil((ir.meta.durationSec ?? 0) * ir.meta.fps)
    const lastWordEnd = ir.words.length > 0 ? ir.words[ir.words.length - 1]!.end : 0
    const wordFrames = Math.ceil(lastWordEnd * ir.meta.fps)
    return Math.max(metaFrames, wordFrames, 0)
  }, [player, ir])

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

  // preview.html 换版（refetch 后 ir/version 变化）→ 重置播放器状态并向新文档
  // 查询（拉 durationFrames）。iframe src 不带版本（preview.html no-store，
  // IR 更新后走 key 重挂载），故用 dataUpdatedAt 触发的 key 重挂载来换版。
  const previewKey = `${projectQ.dataUpdatedAt}`
  useEffect(() => {
    setPlayer(null)
    setPlaying(false)
    setFrame(0)
  }, [previewKey])

  // 播放中本地帧号推进（播放器不逐帧推送；state 帧只在 seek/ready 等节点回）
  // ——以 player.t 的最近回流为锚 + 本地 tick 估算，stop 由 getState 周期校准。
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

  // Agent/其他端改了 IR → refetch（origin==='ui' 的自推也 refetch：幂等且对齐版本号）
  useWsFrame('video.ir.updated', (frameMsg) => {
    const p = frameMsg.payload as IrUpdatedPayload | undefined
    if (!p || p.project_id !== projectId) return
    qc.invalidateQueries({ queryKey: ['video', 'project', projectId] })
  }, wsClient)

  // 渲染进度帧 → 更新历史行（就地 merge，省一次列表 refetch；终态再失效一次拉全量）
  const mergeRenderFrame = useCallback((p: RenderUpdatedPayload) => {
    qc.setQueryData<{ items: VideoRender[] }>(['video', 'renders', projectId], (old) => {
      if (!old) return old
      const items = old.items.map((r) =>
        r.id === p.render_id
          ? { ...r, status: p.status, frames_done: p.frames_done, frames_total: p.frames_total, error: p.error }
          : r,
      )
      return { items }
    })
    if (p.status === 'succeeded' || p.status === 'failed' || p.status === 'interrupted') {
      qc.invalidateQueries({ queryKey: ['video', 'renders', projectId] })
    }
  }, [qc, projectId])

  useWsFrame('video.render.updated', (frameMsg) => {
    const p = frameMsg.payload as RenderUpdatedPayload | undefined
    if (!p || p.project_id !== projectId) return
    mergeRenderFrame(p)
  }, wsClient)

  // bridgeWsToQuery：WS 重连后的兜底失效（连接重建期间丢帧的补偿）
  useEffect(() => {
    return bridgeWsToQuery(wsClient, qc, [
      { match: 'video.ir.updated', invalidate: [['video', 'project', projectId]] },
      { match: 'video.render.updated', invalidate: [['video', 'renders', projectId]] },
    ])
  }, [qc, projectId])

  // 降级轮询：存在活跃渲染但 WS 未连通时，1s 拉 GET renders（§5.2「useInterval 兜底」）
  const hasActiveRender = renders.some((r) => r.status === 'queued' || r.status === 'running')
  useEffect(() => {
    if (!hasActiveRender) return
    if (wsStatus === 'open') return
    const timer = setInterval(() => {
      void qc.invalidateQueries({ queryKey: ['video', 'renders', projectId] })
    }, 1000)
    return () => clearInterval(timer)
  }, [hasActiveRender, wsStatus, qc, projectId])

  // -------------------------------------------------------------------------
  // 脚本编辑 + 保存（PUT ir，乐观锁）
  // -------------------------------------------------------------------------

  const [scriptDraft, setScriptDraft] = useState<string | null>(null)
  const scriptValue = scriptDraft ?? ir?.script ?? ''
  const scriptDirty = scriptDraft !== null && scriptDraft !== (ir?.script ?? '')

  useEffect(() => {
    // 远端 IR 更新（WS refetch）时丢弃本地草稿——不静默覆盖远端，以远端为准。
    setScriptDraft(null)
  }, [previewKey])

  const [saving, setSaving] = useState(false)
  const saveScript = async () => {
    if (!ir || !project) return
    setSaving(true)
    try {
      const nextIR: VideoIR = { ...ir, script: scriptValue }
      await videoApi.putIR(projectId, { ir: nextIR, expected_version: project.version })
      setScriptDraft(null)
      toast.success('已保存')
      await qc.invalidateQueries({ queryKey: ['video', 'project', projectId] })
    } catch (err: unknown) {
      if (isApiError(err, E_VIDEO_VERSION_CONFLICT)) {
        // 乐观锁冲突（Agent 同期写入了新版本）：提示刷新，以服务端为准。
        toast.error('版本冲突：Agent 刚更新了该项目。正在为你加载最新版本…')
        await qc.invalidateQueries({ queryKey: ['video', 'project', projectId] })
        setScriptDraft(null)
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
  const [bgmVolume, setBgmVolume] = useState('') // 空串 = 跟随 IR

  const [rendering, setRendering] = useState(false)
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
    setRendering(true)
    try {
      await videoApi.submitRender(projectId, params)
      toast.success('已提交渲染')
      await qc.invalidateQueries({ queryKey: ['video', 'renders', projectId] })
    } catch (err: unknown) {
      toast.error(apiErrorMessage(err, '提交渲染失败'))
    } finally {
      setRendering(false)
    }
  }

  // -------------------------------------------------------------------------
  // 素材上传（POST /api/video/assets，multipart ≤1MiB）
  // -------------------------------------------------------------------------

  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [uploading, setUploading] = useState(false)
  const onUploadAsset = async (file: File) => {
    if (file.size > 1024 * 1024) {
      toast.error('素材上限 1MiB（v1），请压缩后再上传')
      return
    }
    setUploading(true)
    try {
      const res = await videoApi.uploadAsset(file)
      toast.success(`素材已上传：${shortID(res.key, 24)}`)
    } catch (err: unknown) {
      toast.error(apiErrorMessage(err, '上传失败'))
    } finally {
      setUploading(false)
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
            {/* ProgressValue 是 ProgressPrimitive.Value，必须作为 Progress(Root) 子元素渲染——
                平级兄弟会抛 ProgressRootContext missing 把整页炸掉（界面走查实拍）。 */}
            <Progress value={pct} className="flex-1" aria-label={`渲染进度 ${pct}%`}>
              <ProgressTrack>
                <ProgressIndicator />
              </ProgressTrack>
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
          <a
            href={r.output_url}
            download
            className="inline-flex items-center gap-1 text-sm text-primary underline-offset-4 hover:underline"
          >
            <Download size={14} aria-hidden="true" />
            下载 mp4
          </a>
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
  // 重新组合（POST /compose，批B）：入口弹层状态
  // -------------------------------------------------------------------------

  const [recomposeOpen, setRecomposeOpen] = useState(false)

  // -------------------------------------------------------------------------
  // 渲染
  // -------------------------------------------------------------------------

  if (!projectId) {
    return <PageError message="缺少项目 ID" />
  }
  if (projectQ.isPending) {
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
                  <Button size="sm" variant="outline" aria-label="更多项目操作" />
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
              <Button size="xs" variant={scriptDirty ? 'default' : 'outline'} onClick={() => void saveScript()} disabled={saving || !scriptDirty}>
                {saving ? '保存中…' : scriptDirty ? '保存' : '已同步'}
              </Button>
            </div>
            <Textarea
              value={scriptValue}
              onChange={(e) => setScriptDraft(e.target.value)}
              rows={10}
              placeholder="输入口播脚本…（≤5000 字符；保存后由服务端重排词级时间戳并重解析效果锚点）"
              className="min-h-40 font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">
              {scriptValue.length}/5000 字符 · 保存走 v{project.version} 乐观锁
            </p>
          </section>

          <section className="space-y-2 rounded-lg border bg-card p-3">
            <h2 className="text-sm font-semibold text-foreground">词条时间轴</h2>
            {ir.words.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                暂无词条。保存脚本后（TTS/对齐可用时）自动生成词级时间戳。
              </p>
            ) : (
              <div className="flex flex-wrap gap-1">
                {ir.words.map((w) => (
                  <button
                    key={w.index}
                    type="button"
                    onClick={() => seekToSec(w.start)}
                    title={`${w.start.toFixed(2)}s–${w.end.toFixed(2)}s · ${w.source}`}
                    className="rounded border border-border bg-muted/40 px-1.5 py-0.5 text-xs text-foreground hover:border-primary/50 hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {w.text}
                  </button>
                ))}
              </div>
            )}
            {ir.audio?.voice && (
              <p className="text-xs text-muted-foreground">
                配音：{ir.audio.voice.durationSec.toFixed(1)}s
                {ir.audio.bgm ? ` · BGM vol ${ir.audio.bgm.volume}` : ''}
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
                src={videoApi.previewUrl(projectId)}
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
              aria-label="时间线 scrub（帧）"
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
                暂无效果。让 Agent 用 video_add_effect_at_word 添加，或在 MCP 侧编排。
              </p>
            ) : (
              <ul className="space-y-1.5">
                {ir.effects.map((fx) => {
                  const word = fx.resolvedFrom ? ir.words[fx.resolvedFrom.wordIndex] : undefined
                  const unresolved = fx.resolvedFrom?.reason === 'missing'
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
                          {word ? `@「${word.text}」 ${word.start.toFixed(2)}s` : '锚点未解析'}
                        </span>
                        {unresolved && (
                          <Badge className={STATUS_TONE_CLASS.warning}>missing</Badge>
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
                    <SelectValue>{fps === '' ? `跟随 IR（${ir.meta.fps}）` : fps}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">跟随 IR</SelectItem>
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
                      {resPreset === 'meta' ? `跟随 IR（${ir.meta.width}×${ir.meta.height}）` : resPreset}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="meta">跟随 IR</SelectItem>
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
                    aria-label="BGM 音量（%）"
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
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload size={14} aria-hidden="true" />
                {uploading ? '上传中…' : '上传素材'}
              </Button>
              <Button size="sm" onClick={() => void submitRender()} disabled={rendering}>
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
          </section>
        </div>
      </div>

      {/* 底部：渲染历史 */}
      <section className="space-y-3">
        <h2 className="text-base font-semibold text-foreground">渲染历史</h2>
        <DataTable
          columns={renderColumns}
          rows={renders}
          rowKey={(r) => r.id}
          loading={rendersQ.isPending}
          empty={<PageEmpty label="暂无渲染记录" hint="点击右栏「渲染」提交第一次云端渲染" />}
        />
      </section>

      {/* 重新组合（批B compose） */}
      <RecomposeDialog
        projectId={projectId}
        currentVersion={project.version}
        currentScript={ir.script}
        open={recomposeOpen}
        onOpenChange={setRecomposeOpen}
      />
    </div>
  )
}
