export type RuntimeStoreRiskEventStatus = 'open' | 'acknowledged' | 'resolved' | 'ignored';

export interface RuntimeStoreRiskEvent {
  id: string;
  productId: string;
  workspaceId?: string | null;
  moduleId?: string | null;
  subjectType?: 'user' | 'workspace' | 'organization' | 'apiKey';
  subjectId?: string;
  type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  status: RuntimeStoreRiskEventStatus;
  source?: string;
  sourceId?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt?: string;
  acknowledgedAt?: string;
  resolvedAt?: string;
  ignoredAt?: string;
}

export interface RuntimeStoreRiskBlock {
  id: string;
  productId: string;
  workspaceId?: string | null;
  subjectType: 'user' | 'workspace' | 'organization' | 'apiKey';
  subjectId: string;
  scope?: string;
  reason: string;
  expiresAt?: string;
  releasedAt?: string;
  releasedBy?: string;
  releaseReason?: string;
  idempotencyKey?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}
