import { contentPage } from './content-view';
import { whiteLabelCopy } from '../locales';

export default function TermsPage(props?: { lang?: string }) {
  const copy = whiteLabelCopy(props?.lang).pages.terms;
  return contentPage(copy.title, copy.description, copy.body, copy.eyebrow);
}
