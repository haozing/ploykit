export interface RuntimeStoreRiskEvent {
  id: string;
  productId: string;
  workspaceId?: string | null;
  moduleId?: string | null;
  subjectType?: 'user' | 'workspace' | 'organization' | 'apiKey';
  subjectId?: string;
  type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  source?: string;
  sourceId?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
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
  idempotencyKey?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}
