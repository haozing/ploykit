import { contentPage } from './content-view';
import { whiteLabelCopy } from '../locales';

export default function AboutPage(props?: { lang?: string }) {
  const copy = whiteLabelCopy(props?.lang).pages.about;
  return contentPage(copy.title, copy.description, copy.body, copy.eyebrow);
}
