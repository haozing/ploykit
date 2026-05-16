'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { AdminFileManager } from '@/components/files/admin-file-manager';

/**
 * Files Page Client Component
 *
 * File management page with integrated storage limits
 */

interface FilesPageClientProps {
  userId: string;
}

export default function FilesPageClient({ userId }: FilesPageClientProps) {
  const t = useTranslations('dashboard.files.page');

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-muted-foreground">{t('description')}</p>
      </div>

      <AdminFileManager key={userId} />
    </div>
  );
}
