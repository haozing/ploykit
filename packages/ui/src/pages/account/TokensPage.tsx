
import { useState } from 'react'
import { PageHeader, PageEmpty } from '../../components/Page'
import { FormField } from '../../components/FormField'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Badge } from '../../components/ui/badge'
import { DataTable, type Column } from '../../components/DataTable'
import { SecretModal } from '../../components/SecretModal'
import { useConfirm } from '../../components/ConfirmDialog'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '../../components/ui/dialog'
import { toast } from '../../components/toast'
import { useTokens, useCreateToken, useRevokeToken, type PAT } from '@ploykit/hooks'
import { apiErrorMessage } from '../../lib/api-error'
import { formatDateTime } from '../../lib/utils'


const NAME_MAX_BYTES = 64
const utf8Bytes = (s: string) => new TextEncoder().encode(s).length

export function TokensPage() {
  const { tokens, loading, refetch } = useTokens()
  const { create } = useCreateToken()
  const { revoke } = useRevokeToken()
  const confirm = useConfirm()

  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState('')
  const [nameError, setNameError] = useState<string | null>(null)
  const [ttlHours, setTtlHours] = useState('')
  const [ttlError, setTtlError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [secret, setSecret] = useState<string | null>(null)

  
  function parseTtl(raw: string): { ok: true; hours?: number } | { ok: false; error: string } {
    const s = raw.trim()
    if (s === '') return { ok: true }
    const n = Number(s)
    if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
      return { ok: false, error: '有效期必须是正整数（小时）；不需要过期时间请留空' }
    }
    return { ok: true, hours: n }
  }

  const handleCreate = async () => {
    const trimmed = name.trim()
    if (!trimmed) return 
    
    if (utf8Bytes(trimmed) > NAME_MAX_BYTES) {
      setNameError(`名称不能超过 64 字节（约 21 个汉字），当前 ${utf8Bytes(trimmed)} 字节`)
      return
    }
    const ttl = parseTtl(ttlHours)
    if (!ttl.ok) {
      setTtlError(ttl.error)
      return
    }
    setNameError(null)
    setTtlError(null)
    setCreating(true)
    try {
      const res = await create(trimmed, ttl.hours)
      setCreateOpen(false)
      setName('')
      setTtlHours('')
      setSecret(res.token) 
      toast.success('令牌已创建')
    } catch (e) {
      
      toast.error(apiErrorMessage(e, '创建失败'))
    } finally {
      setCreating(false)
    }
  }

  const handleRevoke = async (t: PAT) => {
    const ok = await confirm({
      title: '吊销此令牌？',
      description: `使用「${t.name}」（前缀 ${t.prefix}…）的集成将立即失去访问权限。`,
      confirmText: '吊销',
      danger: true,
    })
    if (!ok) return
    try {
      await revoke(t.id)
      toast.success('令牌已吊销')
    } catch (e) {
      toast.error(apiErrorMessage(e, '吊销失败'))
    }
  }

  const columns: Column<PAT>[] = [
    {
      
      
      
      key: 'name', header: '名称',
      render: (t) => (
        <span className="font-medium block max-w-[16rem] truncate" title={t.name}>
          {t.name}
        </span>
      ),
    },
    { key: 'prefix', header: '前缀', render: (t) => <code className="font-mono text-xs">{t.prefix}…</code> },
    {
      key: 'last_used_at', header: '最近使用',
      render: (t) => (t.last_used_at ? formatDateTime(t.last_used_at) : <span className="text-muted-foreground">从未使用</span>),
    },
    {
      key: 'expires_at', header: '过期时间',
      render: (t) =>
        t.expires_at ? (
          formatDateTime(t.expires_at)
        ) : (
          <Badge variant="outline">永不过期</Badge>
        ),
    },
    { key: 'created_at', header: '创建时间', render: (t) => formatDateTime(t.created_at) },
    {
      key: 'actions', header: '', className: 'text-right',
      render: (t) => (
        
        <Button
          variant="ghost" size="sm" className="text-destructive"
          aria-label={`吊销令牌 ${t.name}`}
          onClick={() => handleRevoke(t)}
        >
          吊销
        </Button>
      ),
    },
  ]

  return (
    <div>
      <PageHeader
        title="个人访问令牌"
        description="用于脚本与 API 集成；明文只在创建时显示一次"
        actions={<Button onClick={() => setCreateOpen(true)}>新建令牌</Button>}
      />

      <DataTable
        columns={columns}
        rows={tokens}
        rowKey={(t) => t.id}
        loading={loading}
        empty={
          <PageEmpty
            label="还没有令牌"
            hint="创建一个令牌，让脚本以你的身份调用 API"
          />
        }
      />

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建令牌</DialogTitle>
            <DialogDescription>
              创建后明文只显示一次，请立即保存到安全的地方。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <FormField label="名称" htmlFor="pat-name" error={nameError ?? undefined}>
              {/* B3：maxLength 只按 UTF-16 计（64 汉字 = 192 字节拦不住），
                  作 ASCII 粗预约束；真正的字节上限在 handleCreate 校验。 */}
              <Input
                id="pat-name" value={name} onChange={(e) => {
                  setName(e.target.value)
                  if (nameError) setNameError(null) 
                }}
                placeholder="如：ci-deploy" maxLength={64} autoFocus
                aria-invalid={nameError ? true : undefined}
              />
            </FormField>
            <FormField label="有效期（小时，可选）" htmlFor="pat-ttl" error={ttlError ?? undefined}>
              {/* P2-1：不用 type="number"——非法字符（如字母）不会进入受控值，
                  会被静默当成留空创建永不过期凭证；text + inputMode 保留数字键盘
                  且让 parseTtl 能真正拒绝非法输入。 */}
              <Input
                id="pat-ttl" type="text" inputMode="numeric" value={ttlHours}
                onChange={(e) => {
                  setTtlHours(e.target.value)
                  if (ttlError) setTtlError(null) 
                }}
                placeholder="留空 = 永不过期（不建议）"
                aria-invalid={ttlError ? true : undefined}
              />
            </FormField>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>取消</Button>
            <Button onClick={handleCreate} disabled={creating || !name.trim()}>
              {creating ? '创建中…' : '创建'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SecretModal
        open={secret !== null}
        onOpenChange={(o) => !o && setSecret(null)}
        secretName="个人访问令牌"
        secretValue={secret ?? ''}
      />
    </div>
  )
}
