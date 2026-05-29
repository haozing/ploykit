export default function ShopfrontPage(props: { loaderData?: unknown }) {
  return {
    title: 'Shop Demo',
    message: 'Catalog, coupons and checkout are served by the shop-demo module.',
    loaderData: props.loaderData,
  };
}
