import { Permission } from '@ploykit/module-sdk';
import type { ModuleHttpApi } from '@ploykit/module-sdk';
import type { CapabilityDescriptor } from '../registry';

export const httpCapabilityDescriptor: CapabilityDescriptor<'http', ModuleHttpApi> = {
  name: 'http',
  ctxKey: 'http',
  permissions: [Permission.ExternalHttp],
};
