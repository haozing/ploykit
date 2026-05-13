'use client';

import * as React from 'react';
import { formatDistance } from 'date-fns';
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Clock,
  Eye,
  Inbox,
  RefreshCw,
  RotateCcw,
  Webhook,
} from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { apiFetch } from '@/lib/shared/auth-client';

interface OutboxStats {
  total: number;
  pending: number;
  processing: number;
  completed: number;
  failed: number;
}

interface OutboxDeadLetter {
  id: string;
  event: string;
  emitterId: string;
  attempts: number;
  maxAttempts: number;
  error?: string | null;
  createdAt: string;
  updatedAt?: string | null;
  nextAttemptAt?: string | null;
}

interface OutboxDeadLetterResponse {
  success?: boolean;
  stats?: OutboxStats;
  entries?: OutboxDeadLetter[];
}

interface WebhookReceipt {
  id: string;
  provider: string;
  eventId: string | null;
  eventType: string;
  status: string;
  retryCount: number;
  error: string | null;
  processingTime: number | null;
  createdAt?: string | Date | null;
  updatedAt?: string | Date | null;
  processedAt?: string | Date | null;
}

interface WebhookRetryListResponse {
  success?: boolean;
  receipts?: WebhookReceipt[];
}

interface WebhookRetryRunResponse {
  success?: boolean;
  processed?: number;
  succeeded?: number;
  failed?: number;
}

interface WebhookRetryRecord {
  id: string;
  webhookLogId: string;
  attempt: number;
  status: string;
  error: string | null;
  retriedAt: string | Date;
}

interface WebhookReceiptDetailResponse {
  success?: boolean;
  receipt?: WebhookReceipt | null;
  retries?: WebhookRetryRecord[];
  result?: {
    webhookLogId?: string;
    attempt?: number;
    success?: boolean;
    error?: string;
  };
}

export default function AdminOperationsPage() {
  const [outboxStats, setOutboxStats] = React.useState<OutboxStats | null>(null);
  const [outboxEntries, setOutboxEntries] = React.useState<OutboxDeadLetter[]>([]);
  const [webhookReceipts, setWebhookReceipts] = React.useState<WebhookReceipt[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [actingId, setActingId] = React.useState<string | null>(null);
  const [selectedOutboxIds, setSelectedOutboxIds] = React.useState<string[]>([]);
  const [retryingWebhooks, setRetryingWebhooks] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [webhookDetailOpen, setWebhookDetailOpen] = React.useState(false);
  const [selectedWebhookReceipt, setSelectedWebhookReceipt] = React.useState<WebhookReceipt | null>(
    null
  );
  const [webhookDetail, setWebhookDetail] = React.useState<WebhookReceiptDetailResponse | null>(
    null
  );
  const [webhookDetailLoading, setWebhookDetailLoading] = React.useState(false);
  const [webhookDetailError, setWebhookDetailError] = React.useState<string | null>(null);
  const [retryingReceiptId, setRetryingReceiptId] = React.useState<string | null>(null);

  const fetchOperations = React.useCallback(async (showRefresh = false) => {
    if (showRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      const [outboxResponse, webhookResponse] = await Promise.all([
        apiFetch('/api/admin/outbox/dead-letters'),
        apiFetch('/api/admin/webhooks/retry?limit=50'),
      ]);

      if (!outboxResponse.ok) {
        throw new Error('Failed to load outbox dead letters');
      }
      if (!webhookResponse.ok) {
        throw new Error('Failed to load webhook receipts');
      }

      const outboxData = (await outboxResponse.json()) as OutboxDeadLetterResponse;
      const webhookData = (await webhookResponse.json()) as WebhookRetryListResponse;

      setOutboxStats(outboxData.stats ?? null);
      setOutboxEntries(outboxData.entries ?? []);
      setWebhookReceipts(webhookData.receipts ?? []);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to load operations data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  React.useEffect(() => {
    void fetchOperations();
  }, [fetchOperations]);

  async function handleReplayOutbox(entry: OutboxDeadLetter) {
    await handleOutboxAction(entry.id, 'replay');
  }

  async function handleOutboxAction(
    entryId: string,
    action: 'replay' | 'ignore' | 'archive',
    reason?: string
  ) {
    setActingId(entryId);
    setError(null);
    setMessage(null);

    try {
      const response = await apiFetch(`/api/admin/outbox/dead-letters/${entryId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, reason }),
      });

      if (!response.ok) {
        throw new Error(`Failed to ${action} outbox entry`);
      }

      setMessage(`Outbox entry ${entryId} ${formatOutboxActionPastTense(action)}.`);
      await fetchOperations(true);
    } catch (error) {
      setError(error instanceof Error ? error.message : `Failed to ${action} outbox entry`);
    } finally {
      setActingId(null);
    }
  }

  async function handleBulkOutbox(action: 'replay' | 'ignore' | 'archive') {
    if (selectedOutboxIds.length === 0) {
      return;
    }

    const reason =
      action === 'replay'
        ? undefined
        : window.prompt(`${action} ${selectedOutboxIds.length} dead letter(s)? Optional reason:`);

    if (action !== 'replay' && reason === null) {
      return;
    }

    setError(null);
    setMessage(null);

    try {
      const response = await apiFetch('/api/admin/outbox/dead-letters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          entryIds: selectedOutboxIds,
          reason: reason?.trim() || undefined,
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to ${action} selected dead letters`);
      }

      const data = (await response.json()) as { handled?: number; skipped?: number };
      setMessage(`Bulk ${action} handled ${data.handled ?? 0}, skipped ${data.skipped ?? 0}.`);
      setSelectedOutboxIds([]);
      await fetchOperations(true);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : `Failed to ${action} selected dead letters`
      );
    }
  }

  async function handleRetryWebhooks() {
    setRetryingWebhooks(true);
    setError(null);
    setMessage(null);

    try {
      const response = await apiFetch('/api/admin/webhooks/retry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 25 }),
      });

      if (!response.ok) {
        throw new Error('Failed to retry webhook receipts');
      }

      const data = (await response.json()) as WebhookRetryRunResponse;
      setMessage(
        `Webhook retry processed ${data.processed ?? 0}, succeeded ${data.succeeded ?? 0}, failed ${data.failed ?? 0}.`
      );
      await fetchOperations(true);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to retry webhook receipts');
    } finally {
      setRetryingWebhooks(false);
    }
  }

  async function handleViewWebhookReceipt(receipt: WebhookReceipt) {
    setSelectedWebhookReceipt(receipt);
    setWebhookDetail({ receipt, retries: [] });
    setWebhookDetailOpen(true);
    setWebhookDetailLoading(true);
    setWebhookDetailError(null);

    try {
      const response = await apiFetch(`/api/admin/webhooks/retry/${receipt.id}`);

      if (!response.ok) {
        throw new Error('Failed to load webhook receipt detail');
      }

      const data = (await response.json()) as WebhookReceiptDetailResponse;
      setWebhookDetail(data);

      if (data.receipt) {
        setSelectedWebhookReceipt(data.receipt);
        setWebhookReceipts((receipts) =>
          receipts.map((item) => (item.id === data.receipt?.id ? data.receipt : item))
        );
      }
    } catch (error) {
      setWebhookDetailError(
        error instanceof Error ? error.message : 'Failed to load webhook receipt detail'
      );
    } finally {
      setWebhookDetailLoading(false);
    }
  }

  async function handleRetryWebhookReceipt(receiptId: string) {
    setRetryingReceiptId(receiptId);
    setError(null);
    setMessage(null);
    setWebhookDetailError(null);

    try {
      const response = await apiFetch(`/api/admin/webhooks/retry/${receiptId}`, {
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error('Failed to retry webhook receipt');
      }

      const data = (await response.json()) as WebhookReceiptDetailResponse;
      setWebhookDetail(data);

      if (data.receipt) {
        setSelectedWebhookReceipt(data.receipt);
      }

      const retrySucceeded = data.result?.success === true;
      setMessage(
        retrySucceeded
          ? `Webhook receipt ${receiptId} retried successfully.`
          : `Webhook receipt ${receiptId} retry finished with failure.`
      );
      await fetchOperations(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to retry webhook receipt';
      setError(message);
      setWebhookDetailError(message);
    } finally {
      setRetryingReceiptId(null);
    }
  }

  const hasOutboxFailures = (outboxStats?.failed ?? 0) > 0;
  const hasWebhookRetries = webhookReceipts.length > 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Operations Center</h1>
          <p className="text-muted-foreground">Queue health, dead letters, and webhook retries.</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void fetchOperations(true)}
            disabled={loading || refreshing}
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button
            size="sm"
            onClick={() => void handleRetryWebhooks()}
            disabled={loading || retryingWebhooks}
          >
            <RotateCcw className={`h-4 w-4 ${retryingWebhooks ? 'animate-spin' : ''}`} />
            Retry Webhooks
          </Button>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Operation failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {message && (
        <Alert>
          <CheckCircle2 className="h-4 w-4" />
          <AlertTitle>Operation complete</AlertTitle>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={<Inbox className="h-4 w-4 text-muted-foreground" />}
          label="Outbox Failed"
          value={(outboxStats?.failed ?? 0).toLocaleString()}
          tone={hasOutboxFailures ? 'danger' : 'default'}
        />
        <StatCard
          icon={<Clock className="h-4 w-4 text-muted-foreground" />}
          label="Outbox Pending"
          value={(outboxStats?.pending ?? 0).toLocaleString()}
        />
        <StatCard
          icon={<Webhook className="h-4 w-4 text-muted-foreground" />}
          label="Webhook Retryable"
          value={webhookReceipts.length.toLocaleString()}
          tone={hasWebhookRetries ? 'warning' : 'default'}
        />
        <StatCard
          icon={<Activity className="h-4 w-4 text-muted-foreground" />}
          label="Outbox Total"
          value={(outboxStats?.total ?? 0).toLocaleString()}
        />
      </div>

      <Tabs defaultValue="outbox" className="space-y-4">
        <TabsList>
          <TabsTrigger value="outbox">Outbox</TabsTrigger>
          <TabsTrigger value="webhooks">Webhooks</TabsTrigger>
        </TabsList>

        <TabsContent value="outbox">
          <Card>
            <CardHeader>
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <CardTitle>Dead Letters</CardTitle>
                  <CardDescription>
                    Failed outbox entries that can be replayed, ignored, or archived.
                  </CardDescription>
                </div>
                {outboxEntries.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={selectedOutboxIds.length === 0}
                      onClick={() => void handleBulkOutbox('replay')}
                    >
                      Replay Selected
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={selectedOutboxIds.length === 0}
                      onClick={() => void handleBulkOutbox('ignore')}
                    >
                      Ignore Selected
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={selectedOutboxIds.length === 0}
                      onClick={() => void handleBulkOutbox('archive')}
                    >
                      Archive Selected
                    </Button>
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {loading ? (
                <LoadingRows />
              ) : outboxEntries.length === 0 ? (
                <EmptyState icon={<CheckCircle2 className="h-10 w-10" />} title="No dead letters" />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[40px]">
                        <input
                          type="checkbox"
                          aria-label="Select all dead letters"
                          checked={
                            outboxEntries.length > 0 &&
                            selectedOutboxIds.length === outboxEntries.length
                          }
                          onChange={(event) =>
                            setSelectedOutboxIds(
                              event.target.checked ? outboxEntries.map((entry) => entry.id) : []
                            )
                          }
                        />
                      </TableHead>
                      <TableHead>Event</TableHead>
                      <TableHead>Emitter</TableHead>
                      <TableHead>Attempts</TableHead>
                      <TableHead>Last Error</TableHead>
                      <TableHead>Updated</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {outboxEntries.map((entry) => (
                      <TableRow key={entry.id}>
                        <TableCell>
                          <input
                            type="checkbox"
                            aria-label={`Select dead letter ${entry.id}`}
                            checked={selectedOutboxIds.includes(entry.id)}
                            onChange={(event) =>
                              setSelectedOutboxIds((current) =>
                                event.target.checked
                                  ? [...new Set([...current, entry.id])]
                                  : current.filter((id) => id !== entry.id)
                              )
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <div className="font-medium">{entry.event}</div>
                          <div className="max-w-[220px] truncate text-xs text-muted-foreground">
                            {entry.id}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="max-w-[180px] truncate text-sm">{entry.emitterId}</div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="destructive">
                            {entry.attempts}/{entry.maxAttempts}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="max-w-[300px] truncate text-sm text-muted-foreground">
                            {entry.error ?? 'No error recorded'}
                          </div>
                        </TableCell>
                        <TableCell>
                          {formatRelativeTime(entry.updatedAt ?? entry.createdAt)}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => void handleReplayOutbox(entry)}
                              disabled={actingId === entry.id}
                            >
                              <RotateCcw
                                className={`h-4 w-4 ${actingId === entry.id ? 'animate-spin' : ''}`}
                              />
                              Replay
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                const reason = window.prompt('Ignore reason:');
                                if (reason !== null) {
                                  void handleOutboxAction(
                                    entry.id,
                                    'ignore',
                                    reason.trim() || undefined
                                  );
                                }
                              }}
                              disabled={actingId === entry.id}
                            >
                              Ignore
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                const reason = window.prompt('Archive reason:');
                                if (reason !== null) {
                                  void handleOutboxAction(
                                    entry.id,
                                    'archive',
                                    reason.trim() || undefined
                                  );
                                }
                              }}
                              disabled={actingId === entry.id}
                            >
                              Archive
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="webhooks">
          <Card>
            <CardHeader>
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <CardTitle>Retryable Receipts</CardTitle>
                  <CardDescription>
                    Webhook receipts waiting for a manual or scheduled retry.
                  </CardDescription>
                </div>
                {hasWebhookRetries && (
                  <Badge variant="secondary">{webhookReceipts.length} queued</Badge>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {loading ? (
                <LoadingRows />
              ) : webhookReceipts.length === 0 ? (
                <EmptyState
                  icon={<CheckCircle2 className="h-10 w-10" />}
                  title="No retryable receipts"
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Provider</TableHead>
                      <TableHead>Event</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Retries</TableHead>
                      <TableHead>Last Error</TableHead>
                      <TableHead>Updated</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {webhookReceipts.map((receipt) => (
                      <TableRow key={receipt.id}>
                        <TableCell>
                          <div className="font-medium">{receipt.provider}</div>
                          <div className="max-w-[160px] truncate text-xs text-muted-foreground">
                            {receipt.eventId ?? receipt.id}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="max-w-[220px] truncate text-sm">{receipt.eventType}</div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={getWebhookStatusVariant(receipt.status)}>
                            {receipt.status}
                          </Badge>
                        </TableCell>
                        <TableCell>{receipt.retryCount.toLocaleString()}</TableCell>
                        <TableCell>
                          <div className="max-w-[320px] truncate text-sm text-muted-foreground">
                            {receipt.error ?? 'No error recorded'}
                          </div>
                        </TableCell>
                        <TableCell>
                          {formatRelativeTime(receipt.updatedAt ?? receipt.createdAt)}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => void handleViewWebhookReceipt(receipt)}
                            >
                              <Eye className="h-4 w-4" />
                              Detail
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => void handleRetryWebhookReceipt(receipt.id)}
                              disabled={retryingReceiptId === receipt.id}
                            >
                              <RotateCcw
                                className={`h-4 w-4 ${
                                  retryingReceiptId === receipt.id ? 'animate-spin' : ''
                                }`}
                              />
                              Retry
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <WebhookReceiptDetailDialog
        open={webhookDetailOpen}
        onOpenChange={setWebhookDetailOpen}
        receipt={webhookDetail?.receipt ?? selectedWebhookReceipt}
        retries={webhookDetail?.retries ?? []}
        loading={webhookDetailLoading}
        error={webhookDetailError}
        retrying={Boolean(
          (webhookDetail?.receipt?.id ?? selectedWebhookReceipt?.id) &&
            retryingReceiptId === (webhookDetail?.receipt?.id ?? selectedWebhookReceipt?.id)
        )}
        onRetry={(receiptId) => void handleRetryWebhookReceipt(receiptId)}
      />
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  tone = 'default',
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: 'default' | 'warning' | 'danger';
}) {
  const toneClass =
    tone === 'danger'
      ? 'text-destructive'
      : tone === 'warning'
        ? 'text-warning'
        : 'text-foreground';

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardDescription>{label}</CardDescription>
        {icon}
      </CardHeader>
      <CardContent>
        <div className={`text-2xl font-bold ${toneClass}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

function LoadingRows() {
  return (
    <div className="space-y-3">
      {[...Array(5)].map((_, index) => (
        <div key={index} className="h-12 animate-pulse rounded bg-muted" />
      ))}
    </div>
  );
}

function EmptyState({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
      {icon}
      <div className="mt-3 text-sm font-medium text-foreground">{title}</div>
    </div>
  );
}

function WebhookReceiptDetailDialog({
  open,
  onOpenChange,
  receipt,
  retries,
  loading,
  error,
  retrying,
  onRetry,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  receipt: WebhookReceipt | null;
  retries: WebhookRetryRecord[];
  loading: boolean;
  error: string | null;
  retrying: boolean;
  onRetry: (receiptId: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-hidden">
        <DialogHeader>
          <DialogTitle>Webhook Receipt Detail</DialogTitle>
          <DialogDescription>
            {receipt ? `${receipt.provider} - ${receipt.eventType}` : 'Receipt detail'}
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Detail load failed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {loading ? (
          <LoadingRows />
        ) : receipt ? (
          <ScrollArea className="max-h-[58vh] pr-4">
            <div className="space-y-6">
              <div className="grid gap-3 md:grid-cols-2">
                <DetailItem label="Receipt ID" value={receipt.id} mono />
                <DetailItem label="Event ID" value={receipt.eventId ?? 'Not provided'} mono />
                <DetailItem label="Provider" value={receipt.provider} />
                <DetailItem label="Event Type" value={receipt.eventType} />
                <DetailItem label="Status" value={receipt.status} />
                <DetailItem label="Retries" value={receipt.retryCount.toLocaleString()} />
                <DetailItem
                  label="Processing Time"
                  value={
                    receipt.processingTime == null
                      ? 'Not recorded'
                      : `${receipt.processingTime.toLocaleString()} ms`
                  }
                />
                <DetailItem label="Updated" value={formatDateTime(receipt.updatedAt)} />
                <DetailItem label="Created" value={formatDateTime(receipt.createdAt)} />
                <DetailItem label="Processed" value={formatDateTime(receipt.processedAt)} />
              </div>

              <div>
                <div className="mb-2 text-sm font-medium">Last Error</div>
                <pre className="max-h-40 overflow-auto rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
                  {receipt.error ?? 'No error recorded'}
                </pre>
              </div>

              <Separator />

              <div className="space-y-3">
                <div>
                  <h3 className="text-sm font-medium">Retry History</h3>
                  <p className="text-sm text-muted-foreground">
                    Previous manual or scheduled processing attempts for this receipt.
                  </p>
                </div>

                {retries.length === 0 ? (
                  <EmptyState icon={<Clock className="h-10 w-10" />} title="No retry history" />
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Attempt</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Error</TableHead>
                        <TableHead>Retried</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {retries.map((retry) => (
                        <TableRow key={retry.id}>
                          <TableCell>{retry.attempt.toLocaleString()}</TableCell>
                          <TableCell>
                            <Badge variant={getWebhookStatusVariant(retry.status)}>
                              {retry.status}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="max-w-[280px] truncate text-sm text-muted-foreground">
                              {retry.error ?? 'No error recorded'}
                            </div>
                          </TableCell>
                          <TableCell>{formatRelativeTime(retry.retriedAt)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            </div>
          </ScrollArea>
        ) : (
          <EmptyState icon={<AlertCircle className="h-10 w-10" />} title="Receipt not loaded" />
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => receipt && onRetry(receipt.id)}
            disabled={!receipt || retrying}
          >
            <RotateCcw className={`h-4 w-4 ${retrying ? 'animate-spin' : ''}`} />
            Retry Receipt
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DetailItem({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0 rounded-md border p-3">
      <div className="text-xs font-medium uppercase text-muted-foreground">{label}</div>
      <div className={`mt-1 truncate text-sm ${mono ? 'font-mono' : 'font-medium'}`}>{value}</div>
    </div>
  );
}

function getWebhookStatusVariant(
  status: string
): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'failed':
    case 'dead_letter':
      return 'destructive';
    case 'processing':
      return 'secondary';
    case 'received':
      return 'outline';
    default:
      return 'default';
  }
}

function formatDateTime(value?: string | Date | null): string {
  if (!value) {
    return 'Never';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Unknown';
  }

  return date.toLocaleString();
}

function formatOutboxActionPastTense(action: 'replay' | 'ignore' | 'archive'): string {
  if (action === 'replay') {
    return 'queued for replay';
  }
  if (action === 'ignore') {
    return 'ignored';
  }
  return 'archived';
}

function formatRelativeTime(value?: string | Date | null): string {
  if (!value) {
    return 'Never';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Unknown';
  }

  return formatDistance(date, new Date(), { addSuffix: true });
}
