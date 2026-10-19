
import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '../deps'
import { apiFetch } from '@ploykit/client'
import type { components } from '@ploykit/client'
import { useApi, useWorkspace, useWsScope, useWsFrame, useUsagePreview, useUsage } from '@ploykit/hooks'
import {
  useConfirm, DataTable, PageHeader, PageEmpty, PageError, PageLoading, toast, apiErrorMessage,
  Input, Button, Card, CardHeader, CardTitle, CardContent,
  Field, FieldError, Spinner, Alert, AlertTitle, AlertDescription, dimLabel, type Column,
} from '@ploykit/ui'
import { Pencil, Trash2, TriangleAlert } from 'lucide-react'

import { wsClient } from '../ws'


type Task = components['schemas']['Task']
type UsageItem = components['schemas']['UsageItem']

const usageColumns: Column<UsageItem>[] = [
  { key: 'key', header: '项目', render: (it) => dimLabel(it.key) },
  { key: 'used', header: '已用', render: (it) => <span className="text-foreground">{it.used}{it.granted > 0 ? ` (+${it.granted})` : ''}</span> },
  {
    key: 'limit',
    header: '上限',
    render: (it) => <span className="text-muted-foreground">{it.limit < 0 ? '不限' : it.limit === 0 ? '—' : it.limit}</span>,
  },
]

export function Dashboard() {
  const api = useApi()
  const { current } = useWorkspace()
  const wsId = current?.id
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [title, setTitle] = useState('')
  const [titleError, setTitleError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  
  const idemKeyRef = useRef<string | null>(null)

  
  
  const { usage, loading: usageLoading, error: usageError, refetch: refetchUsage } = useUsage()

  
  
  const tasksQ = useQuery({
    queryKey: ['tasks', wsId],
    enabled: !!wsId,
    queryFn: () => api.get<Task[]>('/api/tasks'),
  })
  const tasks = tasksQ.data ?? []
  const invalidateTasks = () => qc.invalidateQueries({ queryKey: ['tasks', wsId] })

  
  const { preview } = useUsagePreview()

  
  useEffect(() => {
    wsClient.connect()
    return () => wsClient.close()
  }, [])
  useWsScope('workspace', wsId, wsClient)
  useWsFrame('task.created', () => {
    qc.invalidateQueries({ queryKey: ['tasks', wsId] })
    qc.invalidateQueries({ queryKey: ['usage', wsId] })
  }, wsClient)

  

  const addTask = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!title.trim()) {
      setTitleError('请输入任务标题')
      return
    }
    setTitleError(null)
    setCreating(true)
    try {
      await apiFetch('/api/tasks', {
        method: 'POST',
        body: { title },
        headers: { 'Idempotency-Key': (idemKeyRef.current ??= crypto.randomUUID()) },
      })
      setTitle('')
      idemKeyRef.current = null 
      await invalidateTasks()
      
      qc.invalidateQueries({ queryKey: ['usage', wsId] })
    } catch (err: unknown) {
      
      toast.error(apiErrorMessage(err, '创建失败'))
    } finally {
      setCreating(false)
    }
  }

  

  const updateTask = useMutation({
    mutationFn: (v: { id: string; title?: string; done?: boolean }) =>
      api.patch<Task>(`/api/tasks/${v.id}`, { title: v.title, done: v.done }),
    onSuccess: invalidateTasks,
    onError: (err) => toast.error(apiErrorMessage(err, '更新失败')),
  })

  const deleteTask = useMutation({
    mutationFn: (id: string) => api.delete(`/api/tasks/${id}`),
    onSuccess: async () => {
      toast.success('任务已删除')
      await invalidateTasks()
      qc.invalidateQueries({ queryKey: ['usage', wsId] })
    },
    onError: (err) => toast.error(apiErrorMessage(err, '删除失败')),
  })

  const startEdit = (t: Task) => {
    setEditingId(t.id)
    setEditTitle(t.title)
  }

  const commitEdit = () => {
    const t = tasks.find((x) => x.id === editingId)
    setEditingId(null)
    if (!t) return
    const next = editTitle.trim()
    if (!next) {
      toast.error('请输入任务标题')
      return
    }
    if (next === t.title) return
    updateTask.mutate({ id: t.id, title: next })
  }

  const onRemove = async (t: Task) => {
    if (!(await confirm({
      title: '删除任务',
      description: `确定删除「${t.title}」吗？该操作不可恢复。`,
      confirmText: '删除', danger: true,
    }))) return
    deleteTask.mutate(t.id)
  }

  return (
    <div className="space-y-6">
      <PageHeader title="概览" />
      <Card>
        <CardHeader>
          <CardTitle>任务</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={addTask} className="space-y-1">
            <Field data-invalid={!!titleError}>
              <div className="flex gap-2">
                <Input
                  value={title}
                  onChange={(e) => {
                    setTitle(e.target.value)
                    if (titleError) setTitleError(null)
                  }}
                  placeholder="新任务标题…"
                  aria-invalid={titleError ? true : undefined}
                  aria-describedby={titleError ? 'new-task-title-error' : undefined}
                />
                <Button type="submit" disabled={creating}>
                  {creating ? (
                    <>
                      <Spinner />
                      添加中…
                    </>
                  ) : '添加'}
                </Button>
              </div>
              <FieldError id="new-task-title-error">{titleError}</FieldError>
            </Field>
          </form>

          {!wsId ? (
            <PageEmpty label="请先创建并选择一个工作区" />
          ) : tasksQ.isPending ? (
            <PageLoading />
          ) : tasksQ.isError ? (
            <PageError
              message={apiErrorMessage(tasksQ.error, '任务列表加载失败')}
              onRetry={() => void tasksQ.refetch()}
            />
          ) : tasks.length === 0 ? (
            <PageEmpty label="暂无任务" />
          ) : (
            <ul className="space-y-2">
              {tasks.map((t) => (
                <li key={t.id} className="flex items-center gap-3 rounded-lg border border-border p-3">
                  <button
                    onClick={() => updateTask.mutate({ id: t.id, done: !t.done })}
                    disabled={updateTask.isPending}
                    aria-pressed={t.done}
                    aria-label={t.done ? `标记 ${t.title} 未完成` : `标记 ${t.title} 已完成`}
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border text-xs transition-colors ${
                      t.done
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-input hover:border-primary/60'
                    }`}
                  >
                    {t.done ? '✓' : ''}
                  </button>
                  {editingId === t.id ? (
                    <Input
                      autoFocus
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitEdit()
                        if (e.key === 'Escape') setEditingId(null)
                      }}
                      onBlur={commitEdit}
                      aria-label="编辑任务标题"
                      className="flex-1"
                    />
                  ) : (
                    <span
                      className={`flex-1 truncate ${t.done ? 'text-muted-foreground line-through' : 'text-foreground'}`}
                    >
                      {t.title}
                    </span>
                  )}
                  {editingId !== t.id && (
                    <div className="flex shrink-0 gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`编辑 ${t.title}`}
                        disabled={updateTask.isPending}
                        onClick={() => startEdit(t)}
                      >
                        <Pencil size={14} />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`删除 ${t.title}`}
                        disabled={deleteTask.isPending}
                        onClick={() => onRemove(t)}
                      >
                        <Trash2 size={14} className="text-destructive" />
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>用量</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {usageError ? (
            <PageError
              message={apiErrorMessage(usageError, '用量加载失败')}
              onRetry={() => void refetchUsage()}
            />
          ) : usageLoading ? (
            <PageLoading label="加载用量…" />
          ) : usage && usage.items.length > 0 ? (
            <>
              <p className="text-sm text-muted-foreground">
                套餐 <span className="font-medium text-foreground">{usage.plan_code}</span>
                　·　计费周期 {usage.period}
              </p>
              <DataTable
                columns={usageColumns}
                rows={usage.items}
                rowKey={(it) => it.key}
                loading={usageLoading}
              />
              {preview && preview.items.length > 0 && preview.projected_total_cents > 0 && (
                <Alert className="border-amber-500/40 bg-amber-50 text-amber-800">
                  <TriangleAlert aria-hidden="true" />
                  <AlertTitle>费用预估</AlertTitle>
                  <AlertDescription>
                    预计超额费用{' '}
                    <span className="font-medium">
                      {(preview.projected_total_cents / 100).toFixed(2)}
                    </span>{' '}
                    元（{preview.items.filter((it) => it.projected_overage_cents > 0).map((it) => dimLabel(it.dim)).join('、')}）
                  </AlertDescription>
                </Alert>
              )}
            </>
          ) : (
            <PageEmpty label="暂无用维度" />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
