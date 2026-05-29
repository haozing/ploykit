export default function CmsStudioPage(props: { loaderData?: unknown }) {
  return {
    title: 'CMS Studio',
    message: 'Create drafts, organize categories and publish content through module APIs/actions.',
    loaderData: props.loaderData,
    api: '/api/modules/cms-demo/posts',
    actions: ['publishPost'],
  };
}
