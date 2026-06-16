import { ActionQueue } from '@host/components/admin/shared/AdminPrimitives';
import type { SupportedLanguage } from '@host/lib/i18n';

export interface RiskQueueItem {
  key: string;
  title: string;
  detail: string;
  action: string;
  status: string;
  href: string;
  tone: 'success' | 'warning' | 'danger';
}

export function RiskQueuePanel({
  lang,
  items,
}: {
  lang: SupportedLanguage;
  items: readonly RiskQueueItem[];
}) {
  const copy = {
    zh: {
      title: '风险队列',
      description: '首页只展示需要处理的风险，诊断证据留在详情页。',
    },
    en: {
      title: 'Risk Queue',
      description:
        'The homepage shows only actionable risks. Diagnostic evidence stays in detail pages.',
    },
  }[lang];
  const activeRisks = items.filter((item) => item.tone !== 'success').length;

  return (
    <ActionQueue
      lang={lang}
      title={copy.title}
      description={copy.description}
      status={activeRisks > 0 ? 'warning' : 'clear'}
      items={items.map((item) => ({
        key: item.key,
        title: item.title,
        description: item.detail,
        actionLabel: item.action,
        href: item.href,
        status: item.status,
        tone: item.tone,
      }))}
    />
  );
}
