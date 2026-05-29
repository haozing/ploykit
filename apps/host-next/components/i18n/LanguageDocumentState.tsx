'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { DEFAULT_LANGUAGE, isSupportedLanguage } from '@host/lib/i18n';

function resolvePathLanguage(pathname: string | null): string {
  const segment = pathname?.split('/').filter(Boolean)[0];
  return segment && isSupportedLanguage(segment) ? segment : DEFAULT_LANGUAGE;
}

export function LanguageDocumentState() {
  const pathname = usePathname();

  useEffect(() => {
    const language = resolvePathLanguage(pathname);
    document.documentElement.lang = language;
    document.documentElement.dataset.lang = language;
  }, [pathname]);

  return null;
}
