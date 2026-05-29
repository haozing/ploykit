import type { ModuleConnectorsApi } from '@ploykit/module-sdk';

export type ModuleConnectorKind =
  | 'http'
  | 'email'
  | 'object-storage'
  | 'vector-search'
  | 'payment'
  | 'database';

export interface ModuleConnectorDefinition {
  kind: ModuleConnectorKind;
  label: string;
  operations: readonly string[];
  requiredConfig: readonly string[];
  risk: 'low' | 'medium' | 'high';
  description: string;
}

export const MODULE_CONNECTOR_REGISTRY: readonly ModuleConnectorDefinition[] = [
  {
    kind: 'http',
    label: 'HTTP',
    operations: ['fetch', 'http.fetch'],
    requiredConfig: ['baseUrl', 'timeoutMs', 'maxResponseBytes'],
    risk: 'high',
    description: 'Outbound HTTP connector constrained by a service connection policy.',
  },
  {
    kind: 'email',
    label: 'Email',
    operations: ['email.send', 'send'],
    requiredConfig: ['provider', 'template'],
    risk: 'medium',
    description: 'Email delivery connector backed by the host email provider.',
  },
  {
    kind: 'object-storage',
    label: 'Object Storage',
    operations: ['object.put', 'object.get', 'object.delete', 'object.list'],
    requiredConfig: ['bucket'],
    risk: 'high',
    description: 'Object storage connector for file and media workloads.',
  },
  {
    kind: 'vector-search',
    label: 'Vector Search',
    operations: ['vector.upsert', 'vector.search', 'vector.delete'],
    requiredConfig: ['index'],
    risk: 'medium',
    description: 'Vector/search connector for RAG and semantic retrieval.',
  },
  {
    kind: 'payment',
    label: 'Payment',
    operations: ['payment.checkout', 'payment.refund', 'payment.reconcile'],
    requiredConfig: ['provider'],
    risk: 'high',
    description: 'Payment connector for checkout, refunds, and reconciliation.',
  },
  {
    kind: 'database',
    label: 'Database',
    operations: ['database.query'],
    requiredConfig: ['connectionId'],
    risk: 'high',
    description: 'Database connector placeholder. Direct module database access remains disabled.',
  },
] as const;

export function normalizeModuleConnectorKind(value: string | undefined): ModuleConnectorKind {
  const normalized = value?.trim().toLowerCase() ?? '';
  if (normalized.includes('http') || normalized.includes('api') || normalized === 'custom') {
    return 'http';
  }
  if (normalized.includes('email') || normalized.includes('mail')) {
    return 'email';
  }
  if (normalized.includes('s3') || normalized.includes('file') || normalized.includes('storage')) {
    return 'object-storage';
  }
  if (normalized.includes('rag') || normalized.includes('vector') || normalized.includes('search')) {
    return 'vector-search';
  }
  if (normalized.includes('stripe') || normalized.includes('billing') || normalized.includes('payment')) {
    return 'payment';
  }
  if (normalized.includes('postgres') || normalized.includes('database')) {
    return 'database';
  }
  return 'http';
}

export function getModuleConnectorDefinition(
  value: string | undefined
): ModuleConnectorDefinition {
  const kind = normalizeModuleConnectorKind(value);
  return MODULE_CONNECTOR_REGISTRY.find((definition) => definition.kind === kind)!;
}

export type ModuleConnectorHandler<TInput = unknown, TResult = unknown> = (
  operation: string,
  input: TInput
) => TResult | Promise<TResult>;

export function createStaticModuleConnectorsApi(
  configs: Record<string, unknown>,
  handlers: Record<string, ModuleConnectorHandler> = {}
): ModuleConnectorsApi {
  return {
    async get<TConfig = unknown>(name: string): Promise<TConfig | null> {
      return Object.hasOwn(configs, name) ? (configs[name] as TConfig) : null;
    },
    async invoke<TInput = unknown, TResult = unknown>(
      name: string,
      operation: string,
      input: TInput
    ): Promise<TResult> {
      const handler = handlers[name];
      if (!handler) {
        throw new Error(`MODULE_CONNECTOR_MISSING: ${name}`);
      }
      return (await handler(operation, input)) as TResult;
    },
  };
}
