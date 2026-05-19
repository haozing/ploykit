'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  MoreHorizontal,
  Eye,
  Edit,
  Trash2,
  Shield,
  Loader2,
  KeyRound,
  Ban,
  Undo2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  type UserWithDetails,
  useDeleteUser,
  useResetUserPassword,
  useRestoreUser,
  useSuspendUser,
} from '@/hooks/use-users';
import type { Pagination } from '@/hooks/types/common';
import { useState } from 'react';
import { toast } from 'sonner';
import { UserEditDialog } from './user-edit-dialog';

interface UsersTableProps {
  users: UserWithDetails[];
  loading?: boolean;
  pagination?: Pagination | null;
  onPageChange?: (page: number) => void;
  onRefresh?: () => void;
}

/**
 * Users Table Component
 *
 * Displays users in a table format with:
 * - User info (avatar, name, email)
 * - Status badges
 * - Roles
 * - Actions menu
 * - Pagination
 */
export function UsersTable({
  users,
  loading = false,
  pagination,
  onPageChange,
  onRefresh,
}: UsersTableProps) {
  const t = useTranslations('dashboard.users.table');
  const params = useParams();
  const lang = params.lang as string;
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);
  const [editingUser, setEditingUser] = useState<UserWithDetails | null>(null);
  const [temporaryPassword, setTemporaryPassword] = useState<{
    userName: string;
    value: string;
  } | null>(null);
  const deleteUserMutation = useDeleteUser();
  const suspendUserMutation = useSuspendUser();
  const restoreUserMutation = useRestoreUser();
  const resetPasswordMutation = useResetUserPassword();

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase();
  };

  const getListAvatarSrc = (image: string | null | undefined) => {
    if (!image) return undefined;
    if (image.startsWith('http://') || image.startsWith('https://') || image.startsWith('data:')) {
      return image;
    }
    return undefined;
  };

  const handleSuspend = async (userId: string, userName: string) => {
    const reason = window.prompt(t('suspendPrompt', { userName }));
    if (reason === null) {
      return;
    }

    try {
      setActingId(userId);
      const result = await suspendUserMutation.trigger({
        userId,
        reason: reason.trim() || undefined,
      });

      if (!result.success) {
        throw new Error(t('suspendFailed'));
      }

      toast.success(t('suspendSuccess', { userName }));
      onRefresh?.();
    } catch (error) {
      const message = error instanceof Error ? error.message : t('suspendFailed');
      toast.error(message);
    } finally {
      setActingId(null);
    }
  };

  const handleRestore = async (userId: string, userName: string) => {
    try {
      setActingId(userId);
      const result = await restoreUserMutation.trigger(userId);

      if (!result.success) {
        throw new Error(t('restoreFailed'));
      }

      toast.success(t('restoreSuccess', { userName }));
      onRefresh?.();
    } catch (error) {
      const message = error instanceof Error ? error.message : t('restoreFailed');
      toast.error(message);
    } finally {
      setActingId(null);
    }
  };

  const handleResetPassword = async (userId: string, userName: string) => {
    if (!window.confirm(t('resetPasswordConfirm', { userName }))) {
      return;
    }

    try {
      setActingId(userId);
      const result = await resetPasswordMutation.trigger(userId);

      if (!result.success || !result.temporaryPassword) {
        throw new Error(t('resetPasswordFailed'));
      }

      setTemporaryPassword({
        userName,
        value: result.temporaryPassword,
      });
      toast.success(t('resetPasswordSuccess', { userName }));
      onRefresh?.();
    } catch (error) {
      const message = error instanceof Error ? error.message : t('resetPasswordFailed');
      toast.error(message);
    } finally {
      setActingId(null);
    }
  };

  const handleDelete = async (userId: string, userName: string) => {
    if (!confirm(t('deleteConfirm', { userName }))) {
      return;
    }

    try {
      setDeletingId(userId);
      const result = await deleteUserMutation.trigger(userId);

      if (result.success) {
        toast.success(t('deleteSuccess', { userName }));
        onRefresh?.();
      } else {
        toast.error(result.error || t('deleteFailed'));
      }
    } catch (error) {
      toast.error(t('deleteError'));
      console.error('Delete user error:', error);
    } finally {
      setDeletingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const resolveRoleLabel = (user: UserWithDetails) => {
    const slug = user.role?.slug?.toLowerCase() || '';
    if (slug.includes('admin')) return t('roles.admin');
    return t('roles.user');
  };

  const formatCreatedAt = (value: Date | string | null | undefined) => {
    if (!value) return t('notAvailable');
    const date = value instanceof Date ? value : new Date(value);
    const locale = lang?.startsWith('zh') ? 'zh-CN' : 'en-US';
    return Number.isNaN(date.getTime()) ? t('notAvailable') : date.toLocaleString(locale);
  };

  const formatEndDate = (value: string | null | undefined, planSlug?: string) => {
    if (planSlug?.toLowerCase() === 'free') {
      return t('subscription.permanent');
    }
    if (!value) return t('notAvailable');
    const date = new Date(value);
    const locale = lang?.startsWith('zh') ? 'zh-CN' : 'en-US';
    return Number.isNaN(date.getTime()) ? t('notAvailable') : date.toLocaleString(locale);
  };

  const getStatusVariant = (
    status: UserWithDetails['status']
  ): 'default' | 'secondary' | 'destructive' | 'outline' => {
    if (status === 'active') return 'default';
    if (status === 'suspended' || status === 'deleted') return 'destructive';
    return 'secondary';
  };

  const formatStatus = (status: UserWithDetails['status'] | null | undefined) => {
    switch (status) {
      case 'pending':
        return t('status.pending');
      case 'suspended':
        return t('status.suspended');
      case 'deleted':
        return t('status.deleted');
      case 'active':
      default:
        return t('status.active');
    }
  };

  return (
    <>
      <div className="min-w-0 rounded-lg border border-border/30">
        <Table className="min-w-[980px] border-collapse border-border/30">
          <TableHeader className="[&_tr]:border-b [&_tr]:border-border/30">
            <TableRow className="border-border/30">
              <TableHead>{t('columns.user')}</TableHead>
              <TableHead>{t('columns.email')}</TableHead>
              <TableHead>{t('columns.status')}</TableHead>
              <TableHead>{t('columns.role')}</TableHead>
              <TableHead>{t('columns.plan')}</TableHead>
              <TableHead>{t('columns.subscriptionEnd')}</TableHead>
              <TableHead>{t('columns.created')}</TableHead>
              <TableHead className="w-[90px] text-right">{t('columns.actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="text-foreground [&_tr]:border-b [&_tr]:border-border/30">
            {users.length === 0 ? (
              <TableRow className="border-border/30">
                <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                  {t('noUsers')}
                </TableCell>
              </TableRow>
            ) : (
              users.map((user) => (
                <TableRow key={user.id} className="border-border/30">
                  <TableCell className="max-w-[240px] py-4">
                    <div className="flex items-center gap-3">
                      <Avatar className="h-10 w-10">
                        <AvatarImage src={getListAvatarSrc(user.image)} alt={user.name} />
                        <AvatarFallback>{getInitials(user.name)}</AvatarFallback>
                      </Avatar>
                      <div className="truncate font-medium" title={user.name}>
                        {user.name}
                      </div>
                    </div>
                  </TableCell>

                  <TableCell className="max-w-[260px] truncate text-sm" title={user.email}>
                    {user.email}
                  </TableCell>

                  <TableCell className="text-sm">
                    <Badge variant={getStatusVariant(user.status)}>
                      {formatStatus(user.status)}
                    </Badge>
                  </TableCell>

                  <TableCell className="text-sm">{resolveRoleLabel(user)}</TableCell>

                  <TableCell className="text-sm">
                    {user.subscription?.planName || t('notAvailable')}
                  </TableCell>

                  <TableCell className="text-sm">
                    {formatEndDate(user.subscription?.endDate, user.subscription?.planSlug)}
                  </TableCell>

                  <TableCell className="text-sm">{formatCreatedAt(user.createdAt)}</TableCell>

                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={deletingId === user.id || actingId === user.id}
                        >
                          {deletingId === user.id || actingId === user.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <MoreHorizontal className="h-4 w-4" />
                          )}
                          <span className="sr-only">{t('actions.openMenu')}</span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuLabel>{t('actions.title')}</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem asChild>
                          <Link href={`/${lang}/admin/users/${user.id}`}>
                            <Eye className="mr-2 h-4 w-4" />
                            {t('actions.viewDetails')}
                          </Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setEditingUser(user)}>
                          <Edit className="mr-2 h-4 w-4" />
                          {t('actions.editUser')}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleResetPassword(user.id, user.name)}>
                          <KeyRound className="mr-2 h-4 w-4" />
                          {t('actions.resetPassword')}
                        </DropdownMenuItem>
                        {user.status === 'suspended' ? (
                          <DropdownMenuItem onClick={() => handleRestore(user.id, user.name)}>
                            <Undo2 className="mr-2 h-4 w-4" />
                            {t('actions.restoreUser')}
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem onClick={() => handleSuspend(user.id, user.name)}>
                            <Ban className="mr-2 h-4 w-4" />
                            {t('actions.suspendUser')}
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem asChild>
                          <Link href={`/${lang}/admin/users?tab=rbac`}>
                            <Shield className="mr-2 h-4 w-4" />
                            {t('actions.manageRoles')}
                          </Link>
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive"
                          onClick={() => handleDelete(user.id, user.name)}
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          {t('actions.deleteUser')}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>

        {/* Pagination */}
        {pagination && pagination.totalPages > 1 && (
          <div className="flex items-center justify-between pt-4">
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
                disabled={pagination.page === 1}
                onClick={() => onPageChange?.(pagination.page - 1)}
              >
                {t('pagination.previous')}
              </Button>
              <div className="flex items-center gap-2 px-3">
                <span className="text-sm">
                  {t('pagination.page', {
                    current: pagination.page,
                    total: pagination.totalPages,
                  })}
                </span>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={pagination.page === pagination.totalPages}
                onClick={() => onPageChange?.(pagination.page + 1)}
              >
                {t('pagination.next')}
              </Button>
            </div>
          </div>
        )}
      </div>

      <UserEditDialog
        user={editingUser}
        open={Boolean(editingUser)}
        onOpenChange={(open) => {
          if (!open) {
            setEditingUser(null);
          }
        }}
        onSuccess={onRefresh}
      />

      {temporaryPassword && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm"
        >
          <div className="w-full max-w-md rounded-lg border bg-background p-6 shadow-lg">
            <h2 className="text-lg font-semibold">{t('temporaryPassword.title')}</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {t('temporaryPassword.description', { userName: temporaryPassword.userName })}
            </p>
            <div className="mt-4 rounded-md border bg-muted p-3 font-mono text-sm break-all">
              {temporaryPassword.value}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => navigator.clipboard.writeText(temporaryPassword.value)}
              >
                {t('temporaryPassword.copy')}
              </Button>
              <Button onClick={() => setTemporaryPassword(null)}>
                {t('temporaryPassword.done')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
