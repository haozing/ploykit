import type { ModuleFileRecord, ModuleFileVisibility } from '@ploykit/module-sdk';

export interface RuntimeStoreFileRecord extends ModuleFileRecord {
  productId: string;
  workspaceId?: string | null;
  ownerId?: string | null;
  visibility: ModuleFileVisibility;
  storageKey: string;
}
