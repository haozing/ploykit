
import { useEffect, useState } from 'react'
import { useQueryClient } from '../deps'
import type { WsFrame, WsStatus } from '@ploykit/client'
import { useWorkspace, useWsStatus, useWsScope, useWsFrame, bridgeWsToQuery } from '@ploykit/hooks'
import { PageHeader, PageEmpty, Button, Badge, StatusBadge, cn, STATUS_TONE_CLASS } from '@ploykit/ui'
import { wsClient } from '../ws'

const MAX_LOG = 50

const STATUS_META: Record<WsStatus, { label: string; tone: keyof typeof STATUS_TONE_CLASS }> = {
  idle: { label: '未连接', tone: 'neutral' },
  connecting: { label: '连接中', tone: 'warning' },
  open: { label: '已连接', tone: 'positive' },
  reconnecting: { label: '重连中', tone: 'warning' },
  stopped: { label: '已断开', tone: 'critical' },
}

export function RealtimePage() {
  const { current } = useWorkspace()
  const wsId = current?.id
  const qc = useQueryClient()
  const status = useWsStatus(wsClient)

  
  useEffect(() => {
    wsClient.connect()
    return () => wsClient.close()
  }, [])

  
  useWsScope('workspace', wsId, wsClient)

  
  const [logs, setLogs] = useState<WsFrame[]>([])
  useWsFrame('*', (frame) => {
    setLogs((prev) => [frame, ...prev].slice(0, MAX_LOG))
  }, wsClient)

  
  
  
  useEffect(() => {
    return bridgeWsToQuery(wsClient, qc, [
      { match: 'task.created', invalidate: [['tasks'], ['usage']] },
    ])
  }, [qc])

  const meta = STATUS_META[status]

  return (
    <div className="space-y-6">
      <PageHeader
        title="实时连接（调试）"
        description="查看与服务器的实时连接状态，以及工作区内推送的原始事件（帧）。用于验证 wsx 接线与排查推送问题。"
        actions={
          <Button size="sm" variant="outline" onClick={() => wsClient.reconnect()}>
            重新连接
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-3 p-4 bg-card rounded-lg border">
        <StatusBadge label={meta.label} tone={meta.tone} />
        <span className="text-sm text-muted-foreground">
          订阅 scope：<code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">
            workspace:{wsId ?? '（未选择工作区）'}
          </code>
        </span>
      </div>

      <section className="space-y-3">
        <h3 className="text-base font-semibold text-foreground">事件流</h3>
        {logs.length === 0 ? (
          <PageEmpty label="暂无事件" hint="工作区内产生新任务时，这里会实时出现" />
        ) : (
          <ul className="divide-y divide-border bg-card rounded-lg border">
            {logs.map((frame, i) => (
              <li key={frame.event_id ?? `${frame.type}-${i}`} className="px-4 py-2.5 text-sm flex flex-wrap gap-x-3 gap-y-1">
                <Badge className={cn('self-center font-mono rounded', STATUS_TONE_CLASS.brand)}>
                  {frame.type}
                </Badge>
                {frame.event_id && (
                  <span className="font-mono text-xs text-muted-foreground self-center break-all">{frame.event_id}</span>
                )}
                <span className="text-xs text-muted-foreground basis-full pl-1 truncate">
                  {JSON.stringify(frame.payload)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
