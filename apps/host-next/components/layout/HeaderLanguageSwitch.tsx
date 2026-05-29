'use client';

import Link from 'next/link';
import { Languages } from 'lucide-react';
import { usePathname, useSearchParams } from 'next/navigation';
import { localizedPath, stripLanguagePrefix, type SupportedLanguage } from '@host/lib/i18n';

function nextLanguage(lang: SupportedLanguage): SupportedLanguage {
  return lang === 'zh' ? 'en' : 'zh';
}

export function HeaderLanguageSwitch({
  lang,
  label,
  targetShort,
}: {
  lang: SupportedLanguage;
  label: string;
  targetShort: string;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const targetLang = nextLanguage(lang);
  const search = searchParams.toString();
  const href = `${localizedPath(targetLang, stripLanguagePrefix(pathname ?? '/'))}${search ? `?${search}` : ''}`;

  return (
    <Link
      href={href}
      className="inline-flex h-9 items-center justify-center gap-1.5 rounded-admin-md px-2 text-sm font-semibold text-admin-text-muted transition hover:bg-admin-surface-muted hover:text-admin-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary"
      aria-label={label}
      title={label}
    >
      <Languages className="h-4 w-4" aria-hidden />
      <span className="hidden sm:inline">{targetShort}</span>
    </Link>
  );
}
