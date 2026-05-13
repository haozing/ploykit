import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getStripe } from '../client';
import { getCurrentStripeEnv, validateStripePriceEnvironment } from '../env-guard';

vi.mock('../client', () => ({
  getStripe: vi.fn(),
}));

describe('Stripe environment guard', () => {
  const originalStripeSecretKey = process.env.STRIPE_SECRET_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = originalStripeSecretKey;
  });

  it('detects test and live mode from the secret key', () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    expect(getCurrentStripeEnv()).toBe('test');

    process.env.STRIPE_SECRET_KEY = 'sk_live_123';
    expect(getCurrentStripeEnv()).toBe('live');
  });

  it('validates price livemode through Stripe API', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    vi.mocked(getStripe).mockReturnValue({
      prices: {
        retrieve: vi.fn().mockResolvedValue({ id: 'price_123', livemode: false }),
      },
    } as never);

    await expect(validateStripePriceEnvironment('price_123')).resolves.toBeUndefined();
    expect(getStripe().prices.retrieve).toHaveBeenCalledWith('price_123');
  });

  it('rejects test/live price mismatches', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_live_123';
    vi.mocked(getStripe).mockReturnValue({
      prices: {
        retrieve: vi.fn().mockResolvedValue({ id: 'price_123', livemode: false }),
      },
    } as never);

    await expect(validateStripePriceEnvironment('price_123')).rejects.toThrow(
      'Stripe price environment mismatch'
    );
  });
});
