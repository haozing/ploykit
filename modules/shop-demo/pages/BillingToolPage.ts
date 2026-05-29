export default function BillingToolPage() {
  return {
    title: 'Shop Billing Guard',
    message:
      'This Shop module page is protected by entitlement and credit requirements.',
    module: 'shop-demo',
    entitlement: 'demo.entitlement',
    action: 'runPaidTool',
    upgrade: {
      label: 'Upgrade in billing',
      href: '/zh/dashboard/billing',
    },
  };
}
