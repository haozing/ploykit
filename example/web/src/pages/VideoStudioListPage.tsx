import { useState } from 'react'
import { useQuery, useQueryClient } from '../deps'
import { Link, useNavigate } from '@ploykit/ui/router'
import {
  PageHeader, PageLoading, PageError, PageEmpty, Button, Input, Field, FieldError,
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
  Card, CardContent, CardHeader, CardTitle, CardDescription,
  Spinner, toast, apiErrorMessage, cn, formatDate,
} from '@ploykit/ui'
import { Clapperboard, Plus } from 'lucide-react'
import { videoApi } from '../api/video'

/**
 * /studio 项目列表：卡片网格 + 新建对话框。
 *
 * 数据经 react-query（['video','projects', wsId]）；新建成功后跳进工作室页。
 * WS 不接（列表页为低频浏览面，ir/render 推送只在工作室页消费）。
 */
export function VideoStudioListPage() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [createOpen, setCreateOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [titleError, setTitleError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const projectsQ = useQuery({
    queryKey: ['video', 'projects'],
    queryFn: () => videoApi.listProjects(),
  })
  const projects = projectsQ.data?.projects ?? []
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

  return (
    <div className="space-y-6">
      <PageHeader
        title="视频工作室"
        description="把脚本变成 9:16 短视频：编辑脚本与效果，预览时间线，提交云端渲染。"
        actions={
          <Button size="sm" onClick={openCreate}>
            <Plus aria-hidden="true" />
            新建项目
          </Button>
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
          hint="点击右上角「新建项目」，从一个脚本开始"
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

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建视频项目</DialogTitle>
            <DialogDescription>项目以脚本为中心：先把文案写进来，后续由 Agent 或你手工编排效果。</DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={submitCreate}>
            <Field data-invalid={!!titleError}>
              <Input
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value)
                  if (titleError) setTitleError(null)
                }}
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
