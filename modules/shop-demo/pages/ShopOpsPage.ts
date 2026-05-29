export default function ShopOpsPage(props: { loaderData?: unknown }) {
  return {
    title: 'Shop Ops',
    message: 'Operate products, coupons and orders through module APIs and actions.',
    loaderData: props.loaderData,
    api: ['/api/modules/shop-demo/products', '/api/modules/shop-demo/orders'],
    actions: ['checkoutCart'],
  };
}
