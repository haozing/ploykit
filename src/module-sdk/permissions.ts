export const Permission = {
  DataDocumentRead: 'data.document.read',
  DataDocumentWrite: 'data.document.write',
  DataTableRead: 'data.table.read',
  DataTableWrite: 'data.table.write',
  DataTransaction: 'data.transaction',
  SurfaceOverride: 'surface.override',
  RunsRead: 'runs.read',
  RunsWrite: 'runs.write',
  JobsEnqueue: 'jobs.enqueue',
  EventsEmit: 'events.emit',
  FilesRead: 'files.read',
  FilesWrite: 'files.write',
  FilesPublish: 'files.publish',
  ServicesInvoke: 'services.invoke',
  AiGenerate: 'ai.generate',
  AiEmbed: 'ai.embed',
  RagRead: 'rag.read',
  RagWrite: 'rag.write',
  AuditWrite: 'audit.write',
  NotificationsRead: 'notifications.read',
  NotificationsSend: 'notifications.send',
  CommercialRead: 'commercial.read',
  CommercialCharge: 'commercial.charge',
  CommercialCheckout: 'commercial.checkout',
} as const;

export type PermissionValue = (typeof Permission)[keyof typeof Permission];
export type PermissionRiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type PermissionScopeLevel = 'user' | 'workspace' | 'product' | 'system' | 'external';

export interface PermissionRegistryEntry {
  value: PermissionValue;
  group: string;
  labelKey: string;
  risk: PermissionRiskLevel;
  scope: PermissionScopeLevel;
  ctxCapability?: string;
}

const entries: Array<[PermissionValue, string, PermissionRiskLevel, PermissionScopeLevel, string]> = [
  [Permission.DataDocumentRead, 'data', 'medium', 'workspace', 'ctx.data.document.read'],
  [Permission.DataDocumentWrite, 'data', 'high', 'workspace', 'ctx.data.document.write'],
  [Permission.DataTableRead, 'data', 'medium', 'workspace', 'ctx.data.table.read'],
  [Permission.DataTableWrite, 'data', 'high', 'workspace', 'ctx.data.table.write'],
  [Permission.DataTransaction, 'data', 'high', 'workspace', 'ctx.data.transaction'],
  [Permission.SurfaceOverride, 'presentation', 'high', 'product', 'ctx.surfaces.override'],
  [Permission.RunsRead, 'background', 'medium', 'workspace', 'ctx.runs.read'],
  [Permission.RunsWrite, 'background', 'high', 'workspace', 'ctx.runs.write'],
  [Permission.JobsEnqueue, 'background', 'high', 'workspace', 'ctx.jobs.run'],
  [Permission.EventsEmit, 'background', 'medium', 'workspace', 'ctx.events.publish'],
  [Permission.FilesRead, 'files', 'medium', 'workspace', 'ctx.files.read'],
  [Permission.FilesWrite, 'files', 'high', 'workspace', 'ctx.files.write'],
  [Permission.FilesPublish, 'files', 'high', 'product', 'ctx.files.publish'],
  [Permission.ServicesInvoke, 'providers', 'high', 'external', 'ctx.services.invoke'],
  [Permission.AiGenerate, 'ai', 'high', 'workspace', 'ctx.ai.generateText'],
  [Permission.AiEmbed, 'ai', 'high', 'workspace', 'ctx.ai.embedText'],
  [Permission.RagRead, 'ai', 'medium', 'workspace', 'ctx.rag.search'],
  [Permission.RagWrite, 'ai', 'high', 'workspace', 'ctx.rag.index'],
  [Permission.AuditWrite, 'security', 'medium', 'workspace', 'ctx.audit.record'],
  [Permission.NotificationsRead, 'security', 'low', 'user', 'ctx.notifications.list'],
  [Permission.NotificationsSend, 'security', 'medium', 'user', 'ctx.notifications.send'],
  [Permission.CommercialRead, 'commerce', 'medium', 'user', 'ctx.commercial.read'],
  [Permission.CommercialCharge, 'commerce', 'high', 'user', 'ctx.commercial.charge'],
  [Permission.CommercialCheckout, 'commerce', 'high', 'user', 'ctx.commercial.checkout'],
];

export const PermissionRegistry: Record<PermissionValue, PermissionRegistryEntry> = Object.fromEntries(
  entries.map(([value, group, risk, scope, ctxCapability]) => [
    value,
    { value, group, risk, scope, ctxCapability, labelKey: `permissions.${value.replaceAll('.', '_')}` },
  ])
) as Record<PermissionValue, PermissionRegistryEntry>;

export const PermissionRegistryEntries = Object.values(PermissionRegistry);
export const SystemOnlyPermissions = new Set<PermissionValue>();
export const ReservedRuntimePermissions = new Set<PermissionValue>();
export const ModulePermissionValues = new Set<PermissionValue>(Object.values(Permission));
