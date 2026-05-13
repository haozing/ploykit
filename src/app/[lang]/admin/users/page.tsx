/**
 * Users Management Page (with RBAC)
 *
 * Combined page with tabs:
 * - Users: User list and management
 * - Roles & Permissions: RBAC management
 */

'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { UsersTab } from '@/components/dashboard/users/users-tab';
import { RBACTab } from '@/components/dashboard/users/rbac-tab';

export default function UsersPage() {
  const t = useTranslations('dashboard.users.page');

  // Get tab from URL query parameter
  const searchParams = useSearchParams();
  const defaultTab = searchParams.get('tab') || 'users';
  const [activeTab, setActiveTab] = useState(defaultTab);

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-muted-foreground">{t('description')}</p>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList>
          <TabsTrigger value="users">{t('tabs.users')}</TabsTrigger>
          <TabsTrigger value="rbac">{t('tabs.rbac')}</TabsTrigger>
        </TabsList>

        {/* Users Tab */}
        <TabsContent value="users" className="space-y-6">
          <UsersTab />
        </TabsContent>

        {/* RBAC Tab */}
        <TabsContent value="rbac" className="space-y-6">
          <RBACTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
