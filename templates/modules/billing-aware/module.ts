import { defineModule, Permission } from '@ploykit/module-sdk';

export default defineModule({
  id: '__MODULE_ID__',
  name: '__MODULE_NAME__',
  version: '0.1.0',
  permissions: [
    Permission.BillingRead,
    Permission.CreditsRead,
    Permission.CreditsConsume,
    Permission.UsageWrite,
  ],
  routes: {
    dashboard: [
      {
        path: '/__MODULE_ID__',
        component: './pages/BillingToolPage',
        auth: 'auth',
        commercial: {
          entitlements: ['pro'],
          credits: { amount: 1 },
        },
      },
    ],
  },
  actions: {
    run_paid_tool: {
      handler: './actions/run-paid-tool',
      auth: 'auth',
      commercial: {
        entitlements: ['pro'],
        credits: { amount: 1 },
      },
    },
  },
});
