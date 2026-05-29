export default function PublicCmsPage(props: { loaderData?: unknown }) {
  return {
    title: 'CMS Demo',
    message: 'Published posts, categories and SEO metadata are served by the cms-demo module.',
    loaderData: props.loaderData,
  };
}
