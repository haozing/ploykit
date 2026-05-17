import { env } from '@/lib/_core/env';
import { DEFAULT_PRODUCT_ID } from './loader';

export function getRuntimeProductId(input?: { productId?: string | null }): string {
  return (
    input?.productId?.trim() ||
    env.PLUGIN_RUNTIME_PRODUCT_ID?.trim() ||
    env.PLOYKIT_PRODUCT_ID?.trim() ||
    DEFAULT_PRODUCT_ID
  );
}
