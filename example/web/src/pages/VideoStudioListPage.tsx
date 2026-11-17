import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '../deps'
import { Link, useNavigate } from '@ploykit/ui/router'
import {
  PageHeader, PageLoading, PageError, PageEmpty, Button, Input, Field, FieldError, Textarea, Label,
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
  Card, CardContent, CardHeader, CardTitle, CardDescription,
  Spinner, toast, apiErrorMessage, cn, formatDate,
} from '@ploykit/ui'
import { Clapperboard, Plus, Wand2, ArrowLeft, Palette } from 'lucide-react'
import { useWorkspace } from '@ploykit/hooks'
import { videoApi, isApiError, E_NOT_CONFIGURED, E_VIDEO_IR_INVALID, E_VIDEO_VERSION_CONFLICT } from '../api/video'
import type { VideoTemplate, VideoTheme } from '../api/video'
import { hasPerm, radioNavProps } from '../lib/radio-nav'

/**
 * /studio 项目列表：卡片网格 + 新建对话框。
 *
 * 创建入口两条路径：
 * - 「从模板新建」（默认主路径）：两步对话框——选模板（CSS 缩略示意）→
 *   选主题 + 填剧本文案 → 先 POST /api/video/projects 建壳，成功后立刻
 *   POST /api/video/projects/{id}/compose 按模板组合 IR，跳 /studio/:id。
 *   compose 失败按错误码区分文案：400 是模板/主题参数问题，503 是服务端
 *   组合能力未配置；两种都降级为空白项目继续走（不留死路）。
 * - 「空白项目」（次级入口）：单字段对话框。
 *
 * 契约（example/internal/video/app/compose.go TemplateCatalogResponse）：
 * - GET /api/video/templates → {templates:[{key,name,description,canvas_w,
 *   canvas_h,fps,safe_margin}], themes:[{key,name,bg,fg,accent,muted,font_scale}]}
 * - 主题是顶层平级数组，模板自带 themes 字段是历史误读，已删除。
 * - POST /api/video/projects/{id}/compose body {script,template,theme,
 *   expected_version?} → {version,cards,words_source}
 *
 * 数据经 react-query（['video','projects', wsId]；模板目录 ['video','templates']
 * 仅在对话框打开时拉取）。查询键带 wsId：切换工作区后不复用上一个工作区的
 * 缓存（否则会短暂显示别的 workspace 的项目）。
 *
 * 权限：video:write 缺失（role_perms 已知且不含）时隐藏两个新建入口；
 * 模板目录为空时给「创建空白项目」按钮，而不是一条只有说明的死路。
 */

/** 文案首行 → 默认项目标题（截 24 字符，去空行）。 */
export function deriveTitleFromScript(script: string): string {
  const firstLine = script.split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? ''
  return firstLine.length > 24 ? `${firstLine.slice(0, 24)}…` : firstLine
}

/** 主题色板圆点：accent 打底 + bg 下弦，一眼看出配色。 */
export function ThemeDot({ theme, className }: { theme: VideoTheme; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn('inline-block size-4 shrink-0 rounded-full border border-border', className)}
      style={{ background: `linear-gradient(135deg, ${theme.accent} 0 55%, ${theme.bg} 55% 100%)` }}
    />
  )
}

/**
 * 模板迷你版式缩略图：纯 CSS div 按主题色板画示意（bg 打底、标题条、文本条、
 * accent 色块位置），不用图片资源。主题由调用方传入（顶层 themes 目录的
 * 一项，模板本身不带 themes）；画布规格只决定宽高比（竖版 9:16 / 横版 16:9 /
 * 方版 1:1 三档示意）。
 */
export function TemplateThumbnail({
  template,
  theme,
  className,
}: {
  template: VideoTemplate
  theme?: VideoTheme
  className?: string
}) {
  const bg = theme?.bg ?? '#1b1b22'
  const fg = theme?.fg ?? '#f4f4f6'
  const accent = theme?.accent ?? '#7c5cff'
  const muted = theme?.muted ?? '#3d3d49'
  const aspect = template.canvas_h > template.canvas_w
    ? 'aspect-[9/16]'
    : template.canvas_h < template.canvas_w
      ? 'aspect-video'
      : 'aspect-square'
  return (
    <div
      data-testid="template-thumbnail"
      aria-hidden="true"
      className={cn('w-full overflow-hidden rounded-md border border-border', aspect, className)}
      style={{ backgroundColor: bg }}
    >
      <div className="flex h-full w-full flex-col gap-[7%] p-[10%]">
        {/* 标题条：accent 引导条 + 标题块 */}
        <div className="flex items-center gap-[5%]">
          <div className="h-[3px] w-[12%] shrink-0 rounded-full" style={{ backgroundColor: accent }} />
          <div className="h-[8%] min-h-1 w-[58%] rounded-sm" style={{ backgroundColor: fg, opacity: 0.92 }} />
        </div>
        {/* 文本条 */}
        <div className="h-[5%] min-h-1 w-[82%] rounded-sm" style={{ backgroundColor: muted }} />
        <div className="h-[5%] min-h-1 w-[64%] rounded-sm" style={{ backgroundColor: muted }} />
        {/* 底部 accent 色块（CTA 位置示意）+ 侧注条 */}
        <div className="mt-auto flex items-end justify-between gap-[6%]">
          <div className="h-[16%] min-h-1.5 w-[32%] rounded-md" style={{ backgroundColor: accent }} />
          <div className="h-[5%] min-h-1 w-[38%] rounded-sm" style={{ backgroundColor: muted }} />
        </div>
      </div>
    </div>
  )
}

/** 模板卡片：缩略图 + 名称/一句话描述/画布规格；选中态描边。 */
export function TemplateCard({
  template,
  theme,
  selected = false,
  index,
  count,
  onSelect,
}: {
  template: VideoTemplate
  theme?: VideoTheme
  selected?: boolean
  /** roving tabindex 的分组位置（不传则不参与组内键盘导航）。 */
  index?: number
  count?: number
  onSelect: () => void
}) {
  // 卡片是「选中即前进」的入口按钮：方向键只移动焦点，Enter/Space 才激活
  // （onSelect 不传，radioNavProps 只做 roving tabindex + 焦点移动）。
  const nav = index !== undefined && count !== undefined
    ? radioNavProps({ index, count, checkedIndex: -1 })
    : undefined
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      data-testid="template-card"
      {...nav}
      className={cn(
        'flex h-full flex-col gap-2 rounded-lg border p-2.5 text-left transition-colors',
        'hover:border-primary/40 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        selected ? 'border-primary bg-primary/5' : 'border-border bg-card',
      )}
    >
      <TemplateThumbnail template={template} theme={theme} />
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-foreground">{template.name}</p>
        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{template.description}</p>
        <p className="mt-1 font-mono text-[11px] text-muted-foreground/80">
          {template.canvas_w}×{template.canvas_h} · {template.fps}fps
        </p>
      </div>
    </button>
  )
}

/** compose 失败 → 面向人的提示（按错误码区分，不把真实原因吞成「暂不可用」）。 */
export function composeFailureMessage(err: unknown): string {
  if (isApiError(err, E_NOT_CONFIGURED)) {
    return '服务端尚未启用模板组合能力，已创建空白项目'
  }
  if (isApiError(err, E_VIDEO_IR_INVALID) || (isApiError(err) && err.status === 400)) {
    return `文案或模板参数不被接受：${apiErrorMessage(err, '请检查文案与所选模板')}`
  }
  if (isApiError(err, E_VIDEO_VERSION_CONFLICT)) {
    return '项目刚被其他人更新，本次未组合，已创建空白项目'
  }
  return `按模板组合失败（${apiErrorMessage(err, '未知错误')}），已创建空白项目`
}

// ---------------------------------------------------------------------------
// 「从模板新建」两步对话框
// ---------------------------------------------------------------------------

const SCRIPT_PLACEHOLDER = [
  '3 秒钩子：还在手动剪字幕吗？',
  '痛点：逐句对齐一条视频要花两小时…',
  '方案：AI 一键成片，脚本进、成片出',
  '行动：点击下方链接，免费试三条',
].join('\n')

function TemplateCreateDialog({
  open,
  onOpenChange,
  onCreated,
  onCreateBlank,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onCreated: (id: string, composed: boolean) => Promise<void> | void
  /** 模板目录为空时的出路：关掉本对话框并打开空白项目表单。 */
  onCreateBlank: () => void
}) {
  const [step, setStep] = useState<'template' | 'compose'>('template')
  const [selected, setSelected] = useState<VideoTemplate | null>(null)
  const [themeKey, setThemeKey] = useState('')
  const [script, setScript] = useState('')
  const [title, setTitle] = useState('')
  const [titleError, setTitleError] = useState<string | null>(null)
  const [scriptError, setScriptError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  // 模板目录仅在对话框打开时拉取；staleTime 内复用（模板目录是静态配置面）。
  // 目录与主题是两个平级数组（后端 TemplateCatalogResponse）——主题不挂在
  // 模板上，模板卡片只能借用顶层 themes[0] 的配色做示意。
  const templatesQ = useQuery({
    queryKey: ['video', 'templates'],
    queryFn: () => videoApi.listTemplates(),
    enabled: open,
    staleTime: 5 * 60_000,
  })
  const templates = templatesQ.data?.templates ?? []
  const themes = templatesQ.data?.themes ?? []
  const defaultTheme = themes[0]

  const close = (v: boolean) => {
    if (!v) {
      // 关闭即复位两步状态（下次打开从第一步开始）。
      setStep('template')
      setSelected(null)
      setThemeKey('')
      setScript('')
      setTitle('')
      setTitleError(null)
      setScriptError(null)
    }
    onOpenChange(v)
  }

  const pickTemplate = (t: VideoTemplate) => {
    setSelected(t)
    // 主题默认取顶层 themes[0].key（模板没有自己的主题列表）。
    setThemeKey(defaultTheme?.key ?? '')
    setStep('compose')
  }

  // 自动标题：文案首行；用户改过（title 非空）则以用户输入为准。
  const effectiveTitle = title.trim() || deriveTitleFromScript(script)

  const submit = async () => {
    if (!selected) return
    if (!script.trim()) {
      setScriptError('请输入剧本文案')
      return
    }
    if (!effectiveTitle) {
      setTitleError('请输入项目标题（或先在文案里写首行）')
      return
    }
    setTitleError(null)
    setScriptError(null)
    setCreating(true)
    try {
      // 顺序契约：先建壳（既有端点），成功后立刻按模板组合。组合失败不回滚
      // 建壳——降级为空白项目继续走，不留死路。
      const { id } = await videoApi.createProject(effectiveTitle)
      let composed = false
      try {
        await videoApi.compose(id, {
          script: script.trim(),
          template: selected.key,
          theme: themeKey || defaultTheme?.key || '',
        })
        composed = true
      } catch (composeErr: unknown) {
        // 按错误码区分（400 参数 / 503 未配置 / 其他），不把所有原因吞成
        // 「模板服务暂不可用」。项目已建好，提示后进编辑器。
        toast.warning(composeFailureMessage(composeErr))
      }
      await onCreated(id, composed)
      close(false)
    } catch (err: unknown) {
      // createProject 失败才走到这里（compose 失败已在上层消化）。
      toast.error(apiErrorMessage(err, '创建失败'))
    } finally {
      setCreating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-2xl">
        {step === 'template' ? (
          <>
            <DialogHeader>
              <DialogTitle>从模板新建</DialogTitle>
              <DialogDescription>选一个版式模板：文案进、成片出，色彩与字号由主题统一编排。</DialogDescription>
            </DialogHeader>
            {templatesQ.isPending ? (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                <Spinner />
                加载模板…
              </div>
            ) : templatesQ.isError ? (
              <div className="space-y-3 py-6 text-center">
                <p className="text-sm text-muted-foreground">
                  模板目录加载失败（{apiErrorMessage(templatesQ.error, '请稍后重试')}）
                </p>
                <div className="flex items-center justify-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => void templatesQ.refetch()}>
                    重试
                  </Button>
                  <Button variant="outline" size="sm" onClick={onCreateBlank}>
                    创建空白项目
                  </Button>
                </div>
              </div>
            ) : templates.length === 0 ? (
              <div className="space-y-3 py-6 text-center">
                <p className="text-sm text-muted-foreground">当前没有可用的模板，可以先创建空白项目。</p>
                <Button variant="outline" size="sm" onClick={onCreateBlank}>
                  <Plus size={14} aria-hidden="true" />
                  创建空白项目
                </Button>
              </div>
            ) : (
              <div
                role="radiogroup"
                aria-label="模板选择"
                className="grid grid-cols-2 gap-3 sm:grid-cols-3"
              >
                {templates.map((t, i) => (
                  <TemplateCard
                    key={t.key}
                    template={t}
                    theme={defaultTheme}
                    selected={false}
                    index={i}
                    count={templates.length}
                    onSelect={() => pickTemplate(t)}
                  />
                ))}
              </div>
            )}
          </>
        ) : selected ? (
          <>
            <DialogHeader>
              <DialogTitle>填写文案 · {selected.name}</DialogTitle>
              <DialogDescription>
                剧本文案按行分段，由模板组合为卡片；主题决定配色与字号。
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              {/* 主题选择：色板圆点 + 名称（顶层 themes 目录，方向键可切换） */}
              {themes.length > 0 && (
                <Field>
                  <Label id="template-theme-label">
                    <Palette size={13} aria-hidden="true" className="mr-1 inline align-[-2px]" />
                    主题
                  </Label>
                  <div
                    role="radiogroup"
                    aria-labelledby="template-theme-label"
                    className="flex flex-wrap gap-2"
                  >
                    {themes.map((th, i) => {
                      const active = th.key === themeKey
                      const checkedIndex = Math.max(0, themes.findIndex((t) => t.key === themeKey))
                      return (
                        <button
                          key={th.key}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          data-testid="theme-option"
                          onClick={() => setThemeKey(th.key)}
                          {...radioNavProps({
                            index: i,
                            count: themes.length,
                            checkedIndex,
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
                </Field>
              )}
              <Field data-invalid={!!scriptError}>
                <Label htmlFor="template-script">剧本文案</Label>
                <Textarea
                  id="template-script"
                  value={script}
                  onChange={(e) => {
                    setScript(e.target.value)
                    if (scriptError) setScriptError(null)
                  }}
                  rows={6}
                  maxLength={5000}
                  placeholder={SCRIPT_PLACEHOLDER}
                  aria-invalid={scriptError ? true : undefined}
                  aria-describedby={scriptError ? 'template-script-error' : undefined}
                  className="min-h-32"
                />
                <FieldError id="template-script-error">{scriptError}</FieldError>
              </Field>
              <Field data-invalid={!!titleError}>
                <Label htmlFor="template-title">项目标题（可选）</Label>
                <Input
                  id="template-title"
                  value={title}
                  onChange={(e) => {
                    setTitle(e.target.value)
                    if (titleError) setTitleError(null)
                  }}
                  maxLength={200}
                  placeholder={deriveTitleFromScript(script) || '默认取文案首行'}
                  aria-invalid={titleError ? true : undefined}
                  aria-describedby={titleError ? 'template-title-error' : undefined}
                />
                <FieldError id="template-title-error">{titleError}</FieldError>
              </Field>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                disabled={creating}
                onClick={() => setStep('template')}
              >
                <ArrowLeft size={14} aria-hidden="true" />
                上一步
              </Button>
              <Button type="button" disabled={creating} onClick={() => void submit()}>
                {creating ? (
                  <>
                    <Spinner />
                    创建中…
                  </>
                ) : (
                  <>
                    <Wand2 size={14} aria-hidden="true" />
                    创建并组合
                  </>
                )}
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// 列表页
// ---------------------------------------------------------------------------

export function VideoStudioListPage() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { current: workspace } = useWorkspace()
  const wsId = workspace?.id
  const canWrite = hasPerm(workspace?.role_perms, 'video:write')
  const [createOpen, setCreateOpen] = useState(false)
  const [templateOpen, setTemplateOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [titleError, setTitleError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const projectsQ = useQuery({
    // wsId 进键 + enabled：切换工作区既不命中上一个 ws 的缓存，也不在
    // 工作区尚未水合时发无 X-Workspace-Id 的请求（否则后端 400 被缓存）。
    queryKey: ['video', 'projects', wsId],
    queryFn: () => videoApi.listProjects(),
    enabled: !!wsId,
  })
  const projects = useMemo(() => projectsQ.data?.items ?? [], [projectsQ.data])
  const invalidateProjects = () => qc.invalidateQueries({ queryKey: ['video', 'projects'] })

  const openCreate = () => {
    setTitle('')
    setTitleError(null)
    setCreateOpen(true)
  }

  const submitCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) {
      setTitleError('请输入项目标题')
      return
    }
    setTitleError(null)
    setCreating(true)
    try {
      const { id } = await videoApi.createProject(title.trim())
      setCreateOpen(false)
      toast.success('项目已创建')
      await invalidateProjects()
      void navigate(`/studio/${id}`)
    } catch (err: unknown) {
      toast.error(apiErrorMessage(err, '创建失败'))
    } finally {
      setCreating(false)
    }
  }

  // 模板流收口：失效列表 + 跳编辑器（composed=false 时对话框已先发降级 toast）。
  const onTemplateCreated = async (id: string, composed: boolean) => {
    if (composed) toast.success('已按模板生成项目')
    await invalidateProjects()
    void navigate(`/studio/${id}`)
  }

  // 模板目录空/失败时的出路：关模板对话框，开空白项目表单。
  const createBlankFromTemplate = () => {
    setTemplateOpen(false)
    openCreate()
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="视频工作室"
        description="把脚本变成 9:16 短视频：编辑脚本与效果，预览时间线，提交云端渲染。"
        actions={
          canWrite ? (
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={() => setTemplateOpen(true)}>
                <Wand2 aria-hidden="true" />
                从模板新建
              </Button>
              <Button size="sm" variant="outline" onClick={openCreate}>
                <Plus aria-hidden="true" />
                空白项目
              </Button>
            </div>
          ) : undefined
        }
      />

      {projectsQ.isPending ? (
        <PageLoading />
      ) : projectsQ.isError ? (
        <PageError
          message={apiErrorMessage(projectsQ.error, '项目列表加载失败')}
          onRetry={() => void projectsQ.refetch()}
        />
      ) : projects.length === 0 ? (
        <PageEmpty
          label="还没有视频项目"
          hint={canWrite ? '点击右上角「从模板新建」，选版式、填文案，一键成片' : '当前角色只能浏览项目；新建需要编辑权限'}
        />
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <li key={p.id}>
              <Link
                to={`/studio/${p.id}`}
                className="group block focus-visible:outline-none"
                aria-label={`打开项目 ${p.title}`}
              >
                <Card className="h-full transition-colors group-hover:border-primary/40 group-focus-visible:border-primary/40">
                  <CardHeader>
                    <CardTitle className="flex min-w-0 items-center gap-2">
                      <Clapperboard size={16} className="shrink-0 text-muted-foreground" aria-hidden="true" />
                      <span className="min-w-0 truncate">{p.title}</span>
                    </CardTitle>
                    <CardDescription>v{p.version}</CardDescription>
                  </CardHeader>
                  <CardContent className={cn('text-sm text-muted-foreground')}>
                    更新于 {formatDate(p.updated_at)}
                  </CardContent>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <TemplateCreateDialog
        open={templateOpen}
        onOpenChange={setTemplateOpen}
        onCreated={onTemplateCreated}
        onCreateBlank={createBlankFromTemplate}
      />

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建视频项目</DialogTitle>
            <DialogDescription>项目以脚本为中心：先把文案写进来，后续由 Agent 或你手工编排效果。</DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={submitCreate}>
            <Field data-invalid={!!titleError}>
              <Label htmlFor="video-project-title">项目标题</Label>
              <Input
                id="video-project-title"
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value)
                  if (titleError) setTitleError(null)
                }}
                maxLength={200}
                placeholder="项目标题…"
                aria-invalid={titleError ? true : undefined}
                aria-describedby={titleError ? 'video-project-title-error' : undefined}
                autoFocus
              />
              <FieldError id="video-project-title-error">{titleError}</FieldError>
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                取消
              </Button>
              <Button type="submit" disabled={creating}>
                {creating ? (
                  <>
                    <Spinner />
                    创建中…
                  </>
                ) : (
                  '创建'
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
