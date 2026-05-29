export interface ModuleRuntimeAuditEvent {
  type: string;
  moduleId: string;
  requestId?: string;
  actorId?: string | null;
  metadata?: Record<string, unknown>;
}

export type ModuleRuntimeAuditSink = (event: ModuleRuntimeAuditEvent) => void | Promise<void>;

export const noopModuleRuntimeAuditSink: ModuleRuntimeAuditSink = () => undefined;
