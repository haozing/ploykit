'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { MoreHorizontal, Eye, Edit, Trash2, Shield, Users, Copy } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { useCreateRole, useDeleteRole, type RoleWithDetails } from '@/hooks/use-roles';
import type { Pagination } from '@/hooks/types/common';

/**
 * Roles Table Props
 */
interface RolesTableProps {
  roles: RoleWithDetails[];
  loading?: boolean;
  pagination?: Pagination | null;
  onPageChange?: (page: number) => void;
  onRefresh?: () => void;
  onEditRole?: (role: RoleWithDetails) => void;
}

/**
 * Roles Table Component
 *
 * Displays roles with:
 * - Role info (name, slug, type)
 * - Permissions count
 * - User assignments count
 * - Actions menu
 */
export function RolesTable({
  roles,
  loading = false,
  pagination = null,
  onPageChange,
  onRefresh,
  onEditRole,
}: RolesTableProps) {
  const t = useTranslations('dashboard.rbac.rolesTable');
  const router = useRouter();
  const params = useParams();
  const lang = params.lang as string;
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);
  const deleteRoleMutation = useDeleteRole();
  const createRoleMutation = useCreateRole();

  /**
   * Handle role deletion
   */
  const handleDelete = async (roleId: string, roleName: string) => {
    if (!confirm(t('deleteConfirm', { roleName }))) {
      return;
    }

    setDeletingId(roleId);

    try {
      const result = await deleteRoleMutation.trigger(roleId);

      if (result.success) {
        toast.success(t('deleteSuccess', { roleName }));
        onRefresh?.();
      } else {
        toast.error(result.error || t('deleteFailed'));
      }
    } catch (error) {
      console.error('Delete error:', error);
      toast.error(t('deleteError'));
    } finally {
      setDeletingId(null);
    }
  };

  /**
   * Handle role duplication
   */
  const handleDuplicate = async (role: RoleWithDetails) => {
    if (!confirm(t('duplicateConfirm', { roleName: role.name }))) {
      return;
    }

    setDuplicatingId(role.id);

    try {
      const result = await createRoleMutation.trigger({
        name: `${role.name} (Copy)`,
        slug: `${role.slug}-copy-${Date.now()}`,
        description: role.description || null,
        isDefault: false,
        metadata: null,
      });

      if (result.success) {
        toast.success(t('duplicateSuccess', { roleName: role.name }));
        onRefresh?.();
      } else {
        toast.error(result.error || t('duplicateFailed'));
      }
    } catch (error) {
      console.error('Duplicate error:', error);
      toast.error(t('duplicateError'));
    } finally {
      setDuplicatingId(null);
    }
  };

  /**
   * Handle view assignments
   */
  const handleViewAssignments = (roleId: string, roleName: string) => {
    router.push(
      `/${lang}/admin/users?tab=users&roleId=${roleId}&roleName=${encodeURIComponent(roleName)}`
    );
  };

  // Loading state
  if (loading) {
    return (
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('columns.role')}</TableHead>
              <TableHead>{t('columns.type')}</TableHead>
              <TableHead>{t('columns.permissions')}</TableHead>
              <TableHead>{t('columns.users')}</TableHead>
              <TableHead>{t('columns.created')}</TableHead>
              <TableHead className="w-[70px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {[...Array(5)].map((_, i) => (
              <TableRow key={i}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-lg bg-muted animate-pulse" />
                    <div className="space-y-2">
                      <div className="h-4 w-32 bg-muted animate-pulse rounded" />
                      <div className="h-3 w-24 bg-muted animate-pulse rounded" />
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="h-6 w-16 bg-muted animate-pulse rounded" />
                </TableCell>
                <TableCell>
                  <div className="h-6 w-32 bg-muted animate-pulse rounded" />
                </TableCell>
                <TableCell>
                  <div className="h-4 w-20 bg-muted animate-pulse rounded" />
                </TableCell>
                <TableCell>
                  <div className="h-4 w-20 bg-muted animate-pulse rounded" />
                </TableCell>
                <TableCell>
                  <div className="h-8 w-8 bg-muted animate-pulse rounded" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  }

  // Empty state
  if (roles.length === 0) {
    return (
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('columns.role')}</TableHead>
              <TableHead>{t('columns.type')}</TableHead>
              <TableHead>{t('columns.permissions')}</TableHead>
              <TableHead>{t('columns.users')}</TableHead>
              <TableHead>{t('columns.created')}</TableHead>
              <TableHead className="w-[70px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell colSpan={6} className="h-24 text-center">
                <div className="text-muted-foreground">{t('noRoles')}</div>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    );
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('columns.role')}</TableHead>
            <TableHead>{t('columns.type')}</TableHead>
            <TableHead>{t('columns.permissions')}</TableHead>
            <TableHead>{t('columns.users')}</TableHead>
            <TableHead>{t('columns.created')}</TableHead>
            <TableHead className="w-[70px]"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {roles.map((role) => (
            <TableRow key={role.id}>
              {/* Role Info */}
              <TableCell>
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Shield className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{role.name}</span>
                      {role.isDefault && (
                        <Badge variant="outline" className="text-xs">
                          {t('badges.default')}
                        </Badge>
                      )}
                    </div>
                    <div className="text-sm text-muted-foreground">{role.slug}</div>
                  </div>
                </div>
              </TableCell>

              {/* Type */}
              <TableCell>
                <Badge variant={role.isDefault ? 'default' : 'secondary'}>
                  {role.isDefault ? t('badges.default') : t('badges.custom')}
                </Badge>
              </TableCell>

              {/* Permissions */}
              <TableCell>
                {role.permissions && role.permissions.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {role.permissions.slice(0, 2).map((perm, idx) => (
                      <Badge key={idx} variant="outline" className="text-xs font-mono">
                        {perm}
                      </Badge>
                    ))}
                    {role.permissions.length > 2 && (
                      <Badge variant="outline" className="text-xs">
                        {t('morePermissions', { count: role.permissions.length - 2 })}
                      </Badge>
                    )}
                  </div>
                ) : (
                  <span className="text-sm text-muted-foreground">{t('noPermissions')}</span>
                )}
              </TableCell>

              {/* User Count */}
              <TableCell>
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium">{role.userCount || 0}</span>
                  <span className="text-sm text-muted-foreground">{t('usersCount')}</span>
                </div>
              </TableCell>

              {/* Created Date */}
              <TableCell className="text-sm text-muted-foreground">
                {format(new Date(role.createdAt), 'MMM d, yyyy')}
              </TableCell>

              {/* Actions */}
              <TableCell>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" disabled={deletingId === role.id}>
                      <MoreHorizontal className="h-4 w-4" />
                      <span className="sr-only">{t('actions.openMenu')}</span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuLabel>{t('actions.title')}</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem asChild>
                      <Link href={`/${lang}/admin/rbac/${role.id}`}>
                        <Eye className="mr-2 h-4 w-4" />
                        {t('actions.viewDetails')}
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={
                        role.isDefault || duplicatingId === role.id || deletingId === role.id
                      }
                      onClick={() => onEditRole?.(role)}
                    >
                      <Edit className="mr-2 h-4 w-4" />
                      {t('actions.editRole')}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={duplicatingId === role.id || deletingId === role.id}
                      onClick={() => handleDuplicate(role)}
                    >
                      <Copy className="mr-2 h-4 w-4" />
                      {duplicatingId === role.id
                        ? t('actions.duplicating')
                        : t('actions.duplicateRole')}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={duplicatingId === role.id || deletingId === role.id}
                      onClick={() => handleViewAssignments(role.id, role.name)}
                    >
                      <Users className="mr-2 h-4 w-4" />
                      {t('actions.viewAssignments')}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive"
                      disabled={
                        role.isDefault || deletingId === role.id || duplicatingId === role.id
                      }
                      onClick={() => handleDelete(role.id, role.name)}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      {deletingId === role.id ? t('actions.deleting') : t('actions.deleteRole')}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {/* Pagination */}
      {pagination && pagination.totalPages > 1 && (
        <div className="flex items-center justify-between border-t px-4 py-4">
          <div className="text-sm text-muted-foreground">
            {t.rich('pagination.showing', {
              from: (pagination.page - 1) * pagination.limit + 1,
              to: Math.min(pagination.page * pagination.limit, pagination.total),
              total: pagination.total,
              strong: (chunks) => <strong>{chunks}</strong>,
            })}
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.page === 1 || loading}
              onClick={() => onPageChange?.(pagination.page - 1)}
            >
              {t('pagination.previous')}
            </Button>
            <div className="flex items-center gap-2 text-sm">
              {t('pagination.page', {
                current: pagination.page,
                total: pagination.totalPages,
              })}
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.page === pagination.totalPages || loading}
              onClick={() => onPageChange?.(pagination.page + 1)}
            >
              {t('pagination.next')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
