/**
 * Users Tab Component
 *
 * User list and management functionality
 */

'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Search } from 'lucide-react';
import { UsersTable } from './users-table';
import { useUsers } from '@/hooks/use-users';

export function UsersTab() {
  const t = useTranslations('dashboard.users.tab');
  const [searchQuery, setSearchQuery] = useState('');

  const { users, loading, pagination, setFilters, refetch } = useUsers({
    page: 1,
    limit: 20,
  });

  const handleSearch = (value: string) => {
    setSearchQuery(value);
    setFilters({ search: value || undefined });
  };

  const handlePageChange = (page: number) => {
    setFilters({ page });
  };

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>{t('allUsers')}</CardTitle>
          <CardDescription>{t('searchAndFilter')}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              placeholder={t('searchPlaceholder')}
              className="pl-9"
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
            />
          </div>
        </div>

        <UsersTable
          users={users}
          loading={loading}
          pagination={pagination}
          onPageChange={handlePageChange}
          onRefresh={refetch}
        />
      </CardContent>
    </Card>
  );
}
