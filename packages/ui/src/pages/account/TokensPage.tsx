
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
import { useT } from '../../i18n'


const NAME_MAX_BYTES = 64
const utf8Bytes = (s: string) => new TextEncoder().encode(s).length

export function TokensPage() {
  const { tokens, loading, refetch } = useTokens()
  const { create } = useCreateToken()
  const { revoke } = useRevokeToken()
  const confirm = useConfirm()
  const t = useT() // i18n（B 方案）：页面文案走字典（g7 分片 account.tokens.*）
  // 注：PAT 行参命名 tk——避免遮蔽翻译函数 t。

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
      return { ok: false, error: t('account.tokens.ttlInvalid') }
    }
    return { ok: true, hours: n }
  }

  const handleCreate = async () => {
    const trimmed = name.trim()
    if (!trimmed) return

    if (utf8Bytes(trimmed) > NAME_MAX_BYTES) {
      setNameError(t('account.tokens.nameTooLong', { bytes: utf8Bytes(trimmed) }))
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
      toast.success(t('account.tokens.createOk'))
    } catch (e) {

      toast.error(apiErrorMessage(e, t('account.tokens.createFailed')))
    } finally {
      setCreating(false)
    }
  }

  const handleRevoke = async (tk: PAT) => {
    const ok = await confirm({
      title: t('account.tokens.revokeTitle'),
      description: t('account.tokens.revokeDesc', { name: tk.name, prefix: tk.prefix }),
      confirmText: t('account.security.revoke'),
      danger: true,
    })
    if (!ok) return
    try {
      await revoke(tk.id)
      toast.success(t('account.tokens.revokeOk'))
    } catch (e) {
      toast.error(apiErrorMessage(e, t('account.tokens.revokeFailed')))
    }
  }

  const columns: Column<PAT>[] = [
    {



      key: 'name', header: t('account.tokens.colName'),
      render: (tk) => (
        <span className="font-medium block max-w-[16rem] truncate" title={tk.name}>
          {tk.name}
        </span>
      ),
    },
    { key: 'prefix', header: t('account.tokens.colPrefix'), render: (tk) => <code className="font-mono text-xs">{tk.prefix}…</code> },
    {
      key: 'last_used_at', header: t('account.tokens.colLastUsed'),
      render: (tk) => (tk.last_used_at ? formatDateTime(tk.last_used_at) : <span className="text-muted-foreground">{t('account.tokens.neverUsed')}</span>),
    },
    {
      key: 'expires_at', header: t('account.tokens.colExpires'),
      render: (tk) =>
        tk.expires_at ? (
          formatDateTime(tk.expires_at)
        ) : (
          <Badge variant="outline">{t('account.tokens.noExpiry')}</Badge>
        ),
    },
    { key: 'created_at', header: t('account.tokens.colCreated'), render: (tk) => formatDateTime(tk.created_at) },
    {
      key: 'actions', header: '', className: 'text-right',
      render: (tk) => (

        <Button
          variant="ghost" size="sm" className="text-destructive"
          aria-label={t('account.tokens.revokeAria', { name: tk.name })}
          onClick={() => handleRevoke(tk)}
        >
          {t('account.security.revoke')}
        </Button>
      ),
    },
  ]

  return (
    <div>
      <PageHeader
        title={t('account.tokens.title')}
        actions={<Button onClick={() => setCreateOpen(true)}>{t('account.tokens.create')}</Button>}
      />

      <DataTable
        columns={columns}
        rows={tokens}
        rowKey={(tk) => tk.id}
        loading={loading}
        empty={
          <PageEmpty
            label={t('account.tokens.empty')}
            hint={t('account.tokens.emptyHint')}
          />
        }
      />

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('account.tokens.dialogTitle')}</DialogTitle>
            <DialogDescription>
              {t('account.tokens.dialogDesc')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <FormField label={t('account.tokens.colName')} htmlFor="pat-name" error={nameError ?? undefined}>
              {/* B3：maxLength 只按 UTF-16 计（64 汉字 = 192 字节拦不住），
                  作 ASCII 粗预约束；真正的字节上限在 handleCreate 校验。 */}
              <Input
                id="pat-name" value={name} onChange={(e) => {
                  setName(e.target.value)
                  if (nameError) setNameError(null)
                }}
                placeholder={t('account.tokens.namePlaceholder')} maxLength={64} autoFocus
                aria-invalid={nameError ? true : undefined}
              />
            </FormField>
            <FormField label={t('account.tokens.ttlLabel')} htmlFor="pat-ttl" error={ttlError ?? undefined}>
              {/* P2-1：不用 type="number"——非法字符（如字母）不会进入受控值，
                  会被静默当成留空创建永不过期凭证；text + inputMode 保留数字键盘
                  且让 parseTtl 能真正拒绝非法输入。 */}
              <Input
                id="pat-ttl" type="text" inputMode="numeric" value={ttlHours}
                onChange={(e) => {
                  setTtlHours(e.target.value)
                  if (ttlError) setTtlError(null)
                }}
                placeholder={t('account.tokens.ttlPlaceholder')}
                aria-invalid={ttlError ? true : undefined}
              />
            </FormField>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>{t('account.tokens.cancel')}</Button>
            <Button onClick={handleCreate} disabled={creating || !name.trim()}>
              {creating ? t('account.tokens.creating') : t('account.tokens.createBtn')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SecretModal
        open={secret !== null}
        onOpenChange={(o) => !o && setSecret(null)}
        secretName={t('account.tokens.secretName')}
        secretValue={secret ?? ''}
      />
    </div>
  )
}
