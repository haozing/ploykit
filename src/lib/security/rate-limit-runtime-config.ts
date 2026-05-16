import { readProxyRuntimeEnv } from './proxy-runtime-env';

export function getRateLimitMultiplier(): number {
  const raw = readProxyRuntimeEnv().apiRateLimitMultiplier;
  if (!raw) return 1;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;

  return Math.min(100, Math.floor(parsed));
}
