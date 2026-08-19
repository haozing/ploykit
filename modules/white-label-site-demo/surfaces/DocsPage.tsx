import { contentPage } from './content-view';
import { whiteLabelCopy } from '../locales';

export default function DocsPage(props?: { lang?: string }) {
  const copy = whiteLabelCopy(props?.lang).pages.docs;
  return contentPage(
    copy.title,
    copy.description,
    copy.body,
    copy.eyebrow
  );
}
