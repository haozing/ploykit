import { DEFAULT_LANGUAGE, type SupportedLanguage } from '@host/lib/i18n';
import { createProductStructuredData } from '@host/lib/presentation/seo-presentation';

export function ProductStructuredData({
  lang = DEFAULT_LANGUAGE,
}: {
  lang?: SupportedLanguage;
}) {
  const structuredData = createProductStructuredData(lang);

  return (
    <script
      type="application/ld+json"
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
    />
  );
}
