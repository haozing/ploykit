'use client';

import * as React from 'react';
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
  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">File Management</h1>
        <p className="text-muted-foreground">Audit and manage files across all users.</p>
      </div>

      <AdminFileManager key={userId} />
    </div>
  );
}
