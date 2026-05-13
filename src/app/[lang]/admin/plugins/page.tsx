/**
 * Plugin Management Page
 *
 * Features:
 * - View all installed plugins
 * - Enable/Disable plugins
 * - View plugin basic information
 *
 * Permission Required: Admin
 *
 * Authentication Layers:
 * 1. Dashboard Layout: Base session validation (auto-inherited)
 * 2. requireAdmin(): Admin role validation (this page)
 * 3. API withAdminGuard: API level validation (API routes)
 */

import { requireAdmin } from '@/lib/shared/role-check';
import { PluginList } from '@/components/admin/PluginList';
import { getTranslations } from 'next-intl/server';

export default async function PluginsPage() {
  await requireAdmin();

  const t = await getTranslations('dashboard.plugins.page');

  return (
    <div className="container mx-auto p-8">
      {/* Page header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-foreground">{t('title')}</h1>
        <p className="text-muted-foreground mt-2">{t('description')}</p>
      </div>

      {/* Plugin list (Client component handles interactions) */}
      <PluginList />
    </div>
  );
}
