/**
 * RBAC Tab Component (Simplified)
 *
 * Simple role assignment management for Admin/User roles only
 * Single-level role system
 */

'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Plus, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { RolesTable } from '@/components/dashboard/rbac/roles-table';
import { RoleDialog } from '@/components/dashboard/rbac/role-dialog';
import { useRoles, type RoleWithDetails } from '@/hooks/use-roles';

export function RBACTab() {
  const t = useTranslations('dashboard.rbac.tab');
  const [searchQuery, setSearchQuery] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<RoleWithDetails | null>(null);

  const { roles, loading, pagination, setFilters, refetch } = useRoles({
    page: 1,
    limit: 50,
  });

  /**
   * Handle search input
   */
  const handleSearch = (value: string) => {
    setSearchQuery(value);
    setFilters({ search: value || undefined });
  };

  /**
   * Handle page change
   */
  const handlePageChange = (page: number) => {
    setFilters({ page });
  };

  const handleCreateRole = () => {
    setEditingRole(null);
    setDialogOpen(true);
  };

  const handleEditRole = (role: RoleWithDetails) => {
    setEditingRole(role);
    setDialogOpen(true);
  };

  return (
    <>
      {/* Search Card */}
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>{t('title')}</CardTitle>
              <CardDescription>{t('description')}</CardDescription>
            </div>
            <Button onClick={handleCreateRole}>
              <Plus className="mr-2 h-4 w-4" />
              {t('createRole')}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              placeholder={t('searchPlaceholder')}
              className="pl-9"
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      {/* Roles Table */}
      <Card>
        <CardContent className="p-0">
          <RolesTable
            roles={roles}
            loading={loading}
            pagination={pagination}
            onPageChange={handlePageChange}
            onRefresh={refetch}
            onEditRole={handleEditRole}
          />
        </CardContent>
      </Card>

      <RoleDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) {
            setEditingRole(null);
          }
        }}
        role={editingRole}
        onSuccess={refetch}
      />
    </>
  );
}
