export interface RuntimeStoreScope {
  productId: string;
  environmentId?: string | null;
  workspaceId?: string | null;
  moduleId?: string | null;
  actorId?: string | null;
}
