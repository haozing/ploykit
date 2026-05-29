export default function NotesPage(props: { loaderData?: unknown }) {
  return {
    title: 'CMS Notes',
    message:
      'Workspace notes use the CMS module Data v2 tables and optional file attachments.',
    module: 'cms-demo',
    loaderData: props.loaderData,
    actions: ['createNote'],
    api: '/api/modules/cms-demo/notes',
  };
}
