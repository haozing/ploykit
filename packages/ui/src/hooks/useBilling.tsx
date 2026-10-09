
import { useCallback, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type APICheckoutSession, type components } from '@ploykit/client'
import {
  useWorkspaceCtx, queryKeys, type PKPlan, type PKSubscription,
} from '../provider/PloykitProvider'

export function useBilling() {
  const { current } = useWorkspaceCtx()
  const qc = useQueryClient()
  const wsId = current?.id ?? ''

  const subQ = useQuery({
    queryKey: queryKeys.billingSubscription(wsId),
    queryFn: () => api.get<PKSubscription>('/api/billing/subscription'),
    enabled: !!current,
  })
  const planQ = useQuery({
    queryKey: queryKeys.billingPlans,
    queryFn: () => api.get<PKPlan[]>('/api/billing/plans'),
  })

  const checkoutM = useMutation({
    mutationFn: (v: { planCode: string; interval: string; channel: string }) =>
      
      api.post<APICheckoutSession>('/api/billing/checkout', {
        plan_code: v.planCode, interval: v.interval, channel: v.channel,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.billing }),
  })

  
  
  
  
  const checkout = useCallback(async (planCode: string, interval: string, channel: string) => {
    if (!wsId) return null
    return checkoutM.mutateAsync({ planCode, interval, channel }).catch(() => null)
  }, [wsId, checkoutM.mutateAsync]) // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = useCallback(async () => {
    await qc.invalidateQueries({ queryKey: queryKeys.billing })
  }, [qc])

  return {
    subscription: current ? (subQ.data ?? null) : null,
    plans: Array.isArray(planQ.data) ? planQ.data : [],
    checkout,
    
    checkoutError: checkoutM.error ?? null,
    loading: planQ.isPending || (!!current && subQ.isPending),
    refresh,
  }
}


export function PlanGate({ plan, denied, children, busy }: {
  plan: string; denied?: ReactNode; children: ReactNode; busy?: ReactNode;
}) {
  const { subscription, plans, loading } = useBilling()
  if (loading) return <>{busy ?? null}</>
  if (!subscription) return <>{denied ?? null}</>

  const currentPlan = plans.find((p) => p.code === subscription.plan_code)
  const requiredPlan = plans.find((p) => p.code === plan)
  const entitled = currentPlan && requiredPlan && currentPlan.sort_no >= requiredPlan.sort_no

  return <>{entitled ? children : denied}</>
}


export type UsagePreviewItem = components['schemas']['UsagePreviewItem']
export type UsagePreviewResp = components['schemas']['UsagePreview']


export function useUsagePreview() {
  const { current } = useWorkspaceCtx()
  const previewQ = useQuery({
    queryKey: ['billing', 'usage-preview', current?.id ?? ''],
    queryFn: () => api.get<UsagePreviewResp>('/api/billing/usage-preview'),
    enabled: !!current,
  })

  return {
    
    preview: current ? (previewQ.data ?? null) : null,
    loading: !!current && previewQ.isPending,
  }
}
