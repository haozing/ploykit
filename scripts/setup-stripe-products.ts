/**
 * Stripe Product Configuration Script
 *
 * Automatically creates subscription plan products and prices in Stripe
 * and updates the database with the generated Price IDs
 *
 * Usage: npm run stripe:setup
 */
/* eslint-disable no-console */
import Stripe from 'stripe';
import { config } from 'dotenv';
import { resolve } from 'path';
import { db } from '../src/lib/db/client.server';
import { entitlementPlans } from '../src/lib/db/schema';
import { eq } from 'drizzle-orm';

// Load environment variables
const envPath = resolve(__dirname, '../.env');
const result = config({ path: envPath });

if (result.error) {
  console.error('❌ Failed to load .env file:', result.error);
  process.exit(1);
}

// Ensure required environment variables exist
if (!process.env.DATABASE_URL) {
  console.error('❌ DATABASE_URL must be set');
  process.exit(1);
}

if (!process.env.DB_PROVIDER) {
  process.env.DB_PROVIDER = 'supabase';
}
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string | undefined>).NODE_ENV = 'development';
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-04-22.dahlia',
  typescript: true,
});

async function setupProducts() {
  console.log('🚀 Starting Stripe product and price creation...\n');

  try {
    // ═══════════════════════════════════════════════════════════
    // 1. Free Plan
    // ═══════════════════════════════════════════════════════════
    console.log('Creating Free Plan...');

    const freeProduct = await stripe.products.create({
      name: 'Free Plan',
      description: 'Free trial of platform basic features',
      metadata: {
        plan_slug: 'free',
      },
    });

    const freePrice = await stripe.prices.create({
      product: freeProduct.id,
      unit_amount: 0, // $0
      currency: 'usd',
      recurring: {
        interval: 'month',
      },
    });

    console.log('✅ Free Plan created successfully');
    console.log(`   Product ID: ${freeProduct.id}`);
    console.log(`   Price ID: ${freePrice.id}\n`);

    // ═══════════════════════════════════════════════════════════
    // 2. Pro Plan
    // ═══════════════════════════════════════════════════════════
    console.log('Creating Pro Plan...');

    const proProduct = await stripe.products.create({
      name: 'Pro Plan',
      description: 'Best choice for professional users',
      metadata: {
        plan_slug: 'pro',
      },
    });

    // Monthly
    const proMonthly = await stripe.prices.create({
      product: proProduct.id,
      unit_amount: 999, // $9.99
      currency: 'usd',
      recurring: {
        interval: 'month',
        trial_period_days: 7, // 7-day trial
      },
    });

    // Yearly
    const proYearly = await stripe.prices.create({
      product: proProduct.id,
      unit_amount: 9900, // $99 (approximately 17% discount)
      currency: 'usd',
      recurring: {
        interval: 'year',
        trial_period_days: 7,
      },
    });

    console.log('✅ Pro Plan created successfully');
    console.log(`   Product ID: ${proProduct.id}`);
    console.log(`   Monthly Price ID: ${proMonthly.id}`);
    console.log(`   Yearly Price ID: ${proYearly.id}\n`);

    // ═══════════════════════════════════════════════════════════
    // 3. Enterprise Plan
    // ═══════════════════════════════════════════════════════════
    console.log('Creating Enterprise Plan...');

    const enterpriseProduct = await stripe.products.create({
      name: 'Enterprise Plan',
      description: 'Enterprise-grade unlimited usage',
      metadata: {
        plan_slug: 'enterprise',
      },
    });

    // Monthly
    const enterpriseMonthly = await stripe.prices.create({
      product: enterpriseProduct.id,
      unit_amount: 2999, // $29.99
      currency: 'usd',
      recurring: {
        interval: 'month',
        trial_period_days: 14, // 14-day trial
      },
    });

    // Yearly
    const enterpriseYearly = await stripe.prices.create({
      product: enterpriseProduct.id,
      unit_amount: 29900, // $299 (approximately 17% discount)
      currency: 'usd',
      recurring: {
        interval: 'year',
        trial_period_days: 14,
      },
    });

    console.log('✅ Enterprise Plan created successfully');
    console.log(`   Product ID: ${enterpriseProduct.id}`);
    console.log(`   Monthly Price ID: ${enterpriseMonthly.id}`);
    console.log(`   Yearly Price ID: ${enterpriseYearly.id}\n`);

    // ═══════════════════════════════════════════════════════════
    // 4. Update database with Stripe Price IDs
    // ═══════════════════════════════════════════════════════════
    console.log('═════════════════════════════════════════════════');
    console.log('✅ All products created successfully!');
    console.log('═════════════════════════════════════════════════\n');
    console.log('📝 Updating database with Stripe Price IDs...\n');

    // Update Free Plan
    await db
      .update(entitlementPlans)
      .set({
        stripe: {
          productId: freeProduct.id,
          priceIdMonthly: freePrice.id,
          priceIdYearly: null,
        },
      })
      .where(eq(entitlementPlans.slug, 'free'));
    console.log(`✅ Updated Free Plan with Price ID: ${freePrice.id}`);

    // Update Pro Plan
    await db
      .update(entitlementPlans)
      .set({
        stripe: {
          productId: proProduct.id,
          priceIdMonthly: proMonthly.id,
          priceIdYearly: proYearly.id,
        },
      })
      .where(eq(entitlementPlans.slug, 'pro'));
    console.log(`✅ Updated Pro Plan with Monthly: ${proMonthly.id}, Yearly: ${proYearly.id}`);

    // Update Enterprise Plan
    await db
      .update(entitlementPlans)
      .set({
        stripe: {
          productId: enterpriseProduct.id,
          priceIdMonthly: enterpriseMonthly.id,
          priceIdYearly: enterpriseYearly.id,
        },
      })
      .where(eq(entitlementPlans.slug, 'enterprise'));
    console.log(
      `✅ Updated Enterprise Plan with Monthly: ${enterpriseMonthly.id}, Yearly: ${enterpriseYearly.id}`
    );

    console.log('\n═════════════════════════════════════════════════');
    console.log('✅ Database updated successfully!');
    console.log('═════════════════════════════════════════════════');
  } catch (error) {
    console.error('❌ Creation failed:', error);
    throw error;
  }
}

// Run script
setupProducts()
  .then(() => {
    console.log('\n✅ Script executed successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Script execution failed:', error);
    process.exit(1);
  });
