
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Skeleton } from '../../components/ui/skeleton'
import { toast } from '../../components/toast'
import { useApi } from '../../hooks/useApi'
import { useWorkspace } from '../../hooks/useWorkspace'
import { queryKeys, type PKSubscription } from '../../provider/PloykitProvider'

const POLL_MS = 5_000
const MAX_TRIES = 12


function toBaseline(sub: PKSubscription): { plan: string; paidIds: string } {
  return {
    plan: sub.plan_code,
    paidIds: sub.orders.filter((o) => o.status === 'paid').map((o) => o.id).sort().join(','),
  }
}

export interface BillingSuccessPageProps {
  
  redirectTo?: string
}

export function BillingSuccessPage({ redirectTo = '/settings/workspace/billing' }: BillingSuccessPageProps = {}) {
  const { current } = useWorkspace()
  const api = useApi()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const wsId = current?.id ?? ''

  
  
  
  const [baseline, setBaseline] = useState<{ plan: string; paidIds: string } | null>(() => {
    if (!wsId) return null
    const cached = qc.getQueryData<PKSubscription>(queryKeys.billingSubscription(wsId))
    return cached ? toBaseline(cached) : null
  })
  const tries = useRef(0)
  const done = useRef(false)

  const subQ = useQuery({
    queryKey: queryKeys.billingSubscription(wsId),
    queryFn: () => api.get<PKSubscription>('/api/billing/subscription'),
    enabled: !!wsId,
    refetchInterval: POLL_MS,
  })

  const finish = (ok: boolean) => {
    if (done.current) return
    done.current = true
    if (ok) toast.success('支付成功，套餐已生效')
    else toast.info('支付结果确认超时，可稍后在计费页查看')
    navigate(redirectTo)
  }

  useEffect(() => {
    
    
    
    const sub = subQ.data
    if (!sub || !subQ.dataUpdatedAt || done.current) return

    if (baseline === null) {
      setBaseline(toBaseline(sub))
      return
    }

    tries.current += 1
    const planChanged = sub.plan_code !== baseline.plan
    const newPaid = toBaseline(sub).paidIds !== baseline.paidIds

    if (planChanged || newPaid) {
      finish(true)
    } else if (tries.current >= MAX_TRIES) {
      finish(false)
    }
    // baseline 有意不入依赖：基线固定后轮询推进只由 dataUpdatedAt 驱动
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subQ.dataUpdatedAt]) // eslint-disable-line react-hooks/exhaustive-deps

  
  if (!wsId) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-sm font-medium">暂无法确认支付结果</p>
        <p className="text-xs text-muted-foreground">
          当前没有选中的工作区，无法查询订阅状态。
        </p>
        <a
          href={redirectTo}
          className="text-sm text-primary underline-offset-4 hover:underline"
        >
          前往计费页查看当前套餐
        </a>
      </div>
    )
  }

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-6">
      <div className="size-8 animate-spin rounded-full border-2 border-muted border-t-primary" aria-hidden="true" />
      <p className="text-sm font-medium">正在确认支付结果…</p>
      <p className="text-xs text-muted-foreground">确认完成后将自动返回计费页，请勿关闭页面。</p>
      <div className="mt-4 w-full max-w-md space-y-2" aria-hidden="true">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    </div>
  )
}
