export const Permission = {
  StorageRead: 'storage.read.self',
  StorageWrite: 'storage.write.self',

  UiToast: 'ui.toast',
  UiModal: 'ui.modal',
  UiNavigate: 'ui.navigate',
  NavigationExtend: 'navigation.extend',
  HeadTagWrite: 'head.write',
  BodyScriptWrite: 'body.write',
  HostPageExtend: 'hostPage.extend',
  HostPageOverride: 'hostPage.override',

  EventsEmit: 'events.emit',
  EventsSubscribe: 'events.subscribe',

  JobsEnqueue: 'jobs.enqueue',
  JobsRegister: 'jobs.register',

  WebhookReceive: 'webhook.receive',
  WebhookSend: 'webhook.send',

  FilesRead: 'files.read',
  FilesWrite: 'files.write',

  WorkspaceRead: 'workspace.read',
  WorkspaceWrite: 'workspace.write',

  ResourceBindingsRead: 'resourceBindings.read',
  ResourceBindingsWrite: 'resourceBindings.write',

  ArtifactsRead: 'artifacts.read',
  ArtifactsWrite: 'artifacts.write',

  RagRead: 'rag.read',
  RagWrite: 'rag.write',

  RunsRead: 'runs.read',
  RunsWrite: 'runs.write',

  ConnectorsRead: 'connectors.read',
  ConnectorsInvoke: 'connectors.invoke',
  ConnectorsManage: 'connectors.manage',

  ApiKeysRead: 'apiKeys.read',
  ApiKeysWrite: 'apiKeys.write',
  RateLimitCheck: 'rateLimit.check',

  AiGenerate: 'ai.generate',
  AiEmbed: 'ai.embed',

  ConfigRead: 'config.read',
  ConfigWrite: 'config.write',

  SecretsRead: 'secrets.read',
  SecretsWrite: 'secrets.write',

  AuditWrite: 'audit.write',
  UsageWrite: 'usage.write',
  MeteringWrite: 'metering.write',
  CreditsRead: 'credits.read',
  CreditsConsume: 'credits.consume',
  CreditsWrite: 'credits.write',
  BillingRead: 'billing.read',
  BillingWrite: 'billing.write',
  CommerceRead: 'commerce.read',
  CommerceWrite: 'commerce.write',
  NotificationsSend: 'notifications.send',

  ExternalHttp: 'http.external',
  ServicesInvoke: 'services.invoke',

  UnsafeSqlRaw: 'unsafe.sql.raw',
  UnsafeInternalResource: 'unsafe.internal_resource',
} as const;

export type PermissionValue = (typeof Permission)[keyof typeof Permission];

export const HostPermissionValues = new Set<PermissionValue>(
  Object.values(Permission) as PermissionValue[]
);
