
import { useEffect, useState } from 'react'
import { useQueryClient } from '../deps'
import type { WsFrame, WsStatus } from '@ploykit/client'
import { useWorkspace, useWsStatus, useWsScope, useWsFrame, bridgeWsToQuery } from '@ploykit/hooks'
import { PageHeader, PageEmpty, Button, cn, STATUS_TONE_CLASS } from '@ploykit/ui'
import { wsClient } from '../ws'

const MAX_LOG = 50

const STATUS_META: Record<WsStatus, { label: string; tone: keyof typeof STATUS_TONE_CLASS }> = {
  idle: { label: '未连接', tone: 'neutral' },
  connecting: { label: '连接中', tone: 'warning' },
  open: { label: '已连接', tone: 'positive' },
  reconnecting: { label: '重连中', tone: 'warning' },
  stopped: { label: '已断开', tone: 'neutral' },
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
    <div className="max-w-4xl mx-auto space-y-6">
      <PageHeader
        title="实时"
        description="WebSocket 帧订阅演示（同源 /ws，自动重连与按 scope 订阅）"
        actions={
          <Button size="sm" variant="outline" onClick={() => wsClient.reconnect()}>
            重新连接
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-3 p-4 bg-white rounded-lg border">
        <span className={cn('inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium',
          STATUS_TONE_CLASS[meta.tone])}>
          {meta.label}
        </span>
        <span className="text-sm text-gray-500">
          订阅 scope：<code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">
            workspace:{wsId ?? '（未选择工作区）'}
          </code>
        </span>
        <span className="text-xs text-gray-400">日志上限 {MAX_LOG} 条，新帧置顶</span>
      </div>

      <section className="space-y-3">
        <h3 className="text-base font-semibold text-gray-900">帧日志</h3>
        {logs.length === 0 ? (
          <PageEmpty label="暂无帧" hint="连接建立后，订阅 scope 内广播的事件会出现在这里" />
        ) : (
          <ul className="divide-y divide-border bg-white rounded-lg border">
            {logs.map((frame, i) => (
              <li key={frame.event_id ?? `${frame.type}-${i}`} className="px-4 py-2.5 text-sm flex flex-wrap gap-x-3 gap-y-1">
                <code className="font-mono text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded self-center">
                  {frame.type}
                </code>
                {frame.event_id && (
                  <span className="font-mono text-xs text-gray-400 self-center break-all">{frame.event_id}</span>
                )}
                <span className="text-xs text-gray-500 basis-full pl-1 truncate">
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
