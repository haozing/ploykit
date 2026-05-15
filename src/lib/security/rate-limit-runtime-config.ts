export function getRateLimitMultiplier(): number {
  const raw = process.env.PLOYKIT_API_RATE_LIMIT_MULTIPLIER;
  if (!raw) return 1;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;

  return Math.min(100, Math.floor(parsed));
}
