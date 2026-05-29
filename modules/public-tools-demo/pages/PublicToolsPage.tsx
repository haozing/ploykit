import { PublicToolsWorkbench } from '../components/PublicToolsWorkbench';

export default function PublicToolsPage(props: { language?: string }) {
  return <PublicToolsWorkbench language={props.language} />;
}
