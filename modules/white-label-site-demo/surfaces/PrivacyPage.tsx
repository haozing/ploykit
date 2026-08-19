import { contentPage } from './content-view';
import { whiteLabelCopy } from '../locales';

export default function PrivacyPage(props?: { lang?: string }) {
  const copy = whiteLabelCopy(props?.lang).pages.privacy;
  return contentPage(copy.title, copy.description, copy.body, copy.eyebrow);
}
