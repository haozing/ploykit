import { defineModule, integer, jsonb, Permission, table, text, timestamp } from '@ploykit/module-sdk';

export default defineModule({
  id: 'shop-demo',
  name: 'Shop Demo',
  contractVersion: 1,
  version: '0.1.0',
  description:
    'Product-grade shop module sample with catalog, coupons, orders and checkout workflow.',
  permissions: [
    Permission.DataTableRead,
    Permission.DataTableWrite,
    Permission.BillingRead,
    Permission.CreditsRead,
    Permission.CreditsConsume,
    Permission.EntitlementsRead,
    Permission.CommerceWrite,
    Permission.MeteringWrite,
    Permission.AuditWrite,
    Permission.EventsEmit,
    Permission.NotificationsSend,
    Permission.CacheRevalidate,
    Permission.SurfaceContribute,
    Permission.UsageWrite,
  ],
  data: {
    version: 1,
    tables: {
      products: table({
        scope: 'product',
        columns: {
          sku: text().notNull(),
          title: text().notNull(),
          slug: text().notNull(),
          description: text().nullable(),
          status: text().notNull().default('active'),
          price_cents: integer().notNull(),
          currency: text().notNull().default('usd'),
          inventory: integer().notNull().default(0),
          metadata: jsonb().notNull().default({ source: 'shop-demo' }),
        },
        unique: [['sku'], ['slug']],
        indexes: [['status'], ['inventory']],
      }),
      coupons: table({
        scope: 'product',
        columns: {
          code: text().notNull(),
          percent_off: integer().notNull().default(0),
          status: text().notNull().default('active'),
          expires_at: timestamp().nullable(),
          metadata: jsonb().notNull().default({ source: 'shop-demo' }),
        },
        unique: [['code']],
        indexes: [['status'], ['expires_at']],
      }),
      orders: table({
        scope: 'product',
        columns: {
          order_number: text().notNull(),
          user_id: text().notNull(),
          sku: text().notNull(),
          product_title: text().notNull(),
          quantity: integer().notNull().default(1),
          subtotal_cents: integer().notNull(),
          discount_cents: integer().notNull().default(0),
          total_cents: integer().notNull(),
          currency: text().notNull().default('usd'),
          status: text().notNull().default('checkout_created'),
          checkout_id: text().nullable(),
          coupon_code: text().nullable(),
          metadata: jsonb().notNull().default({ source: 'shop-demo' }),
        },
        unique: [['order_number']],
        indexes: [['user_id'], ['sku'], ['status']],
      }),
    },
    migrations: {
      mode: 'generated',
      dir: './migrations',
    },
  },
  routes: {
    site: [
      {
        path: '/shop-demo',
        component: './pages/ShopfrontPage',
        loader: './loaders/shopfront',
        metadata: './loaders/shop-metadata',
        publicAliases: ['/shop', '/store'],
        auth: 'public',
        cache: {
          strategy: 'public',
          revalidateSeconds: 120,
          tags: ['shop-demo', 'shop-demo-products'],
        },
      },
    ],
    dashboard: [
      {
        path: '/shop-demo',
        component: './pages/ShopOpsPage',
        loader: './loaders/ops',
        auth: 'auth',
        permissions: [Permission.DataTableRead],
      },
      {
        path: '/shop-demo/billing',
        component: './pages/BillingToolPage',
        auth: 'auth',
        commercial: {
          entitlements: ['demo.entitlement'],
          credits: { amount: 1 },
        },
      },
    ],
    api: [
      {
        path: '/shop-demo/products',
        handler: './api/products',
        methods: ['GET', 'POST'],
        auth: 'auth',
        permissions: [Permission.DataTableRead, Permission.DataTableWrite],
      },
      {
        path: '/shop-demo/orders',
        handler: './api/orders',
        methods: ['GET'],
        auth: 'auth',
        permissions: [Permission.DataTableRead],
      },
      {
        path: '/shop-demo/billing/status',
        handler: './api/billing-status',
        methods: ['GET'],
        auth: 'auth',
      },
    ],
  },
  actions: {
    checkoutCart: {
      handler: './actions/checkout-cart',
      auth: 'auth',
      sideEffect: 'write',
      permissions: [
        Permission.DataTableRead,
        Permission.DataTableWrite,
        Permission.CommerceWrite,
        Permission.AuditWrite,
        Permission.EventsEmit,
        Permission.NotificationsSend,
      ],
    },
    runPaidTool: {
      handler: './actions/run-paid-tool',
      auth: 'auth',
      sideEffect: 'write',
      commercial: {
        entitlements: ['demo.entitlement'],
        credits: { amount: 1 },
      },
      permissions: [Permission.CreditsRead, Permission.CreditsConsume, Permission.MeteringWrite],
    },
  },
  events: {
    publishes: ['shop.order.created'],
  },
  surfaces: {
    'admin.modules:panels': {
      mode: 'panel',
      component: './surfaces/AdminSummary',
      priority: 35,
      permissions: [Permission.SurfaceContribute],
    },
  },
  navigation: [
    {
      location: 'dashboard.sidebar',
      fallbackLabel: 'Shop',
      path: '/shop-demo',
      weight: 48,
      requires: {
        entitlements: ['ploykit.demo_modules'],
      },
    },
    {
      location: 'dashboard.sidebar',
      fallbackLabel: 'Billing Guard',
      path: '/shop-demo/billing',
      weight: 49,
      requires: {
        entitlements: ['ploykit.demo_modules', 'demo.entitlement'],
      },
    },
  ],
});
