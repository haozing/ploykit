import { localizedHref, templateCopy } from '../locales';

export default function HomePage(props?: { lang?: string }) {
  const copy = templateCopy(props?.lang).pages.home;

  return {
    eyebrow: copy.eyebrow,
    title: copy.title,
    description: copy.description,
    primaryAction: {
      label: copy.primaryAction,
      href: localizedHref(props?.lang, '/register'),
    },
  };
}
