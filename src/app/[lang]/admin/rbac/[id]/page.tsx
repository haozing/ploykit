'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { ArrowLeft, Shield, Users, Calendar, Edit, Copy, Trash2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useCreateRole, useDeleteRole, useRole } from '@/hooks/use-roles';
import { RoleDialog } from '@/components/dashboard/rbac/role-dialog';
import { toast } from 'sonner';

/**
 * Role Detail Page
 *
 * Shows detailed information about a role:
 * - Role information and metadata
 * - Permissions list
 * - User assignments count
 * - Settings
 */
export default function RoleDetailPage() {
  const params = useParams();
  const router = useRouter();
  const roleId = params.id as string;
  const lang = params.lang as string;
  const t = useTranslations('dashboard.rbac');

  const { role, loading, refetch } = useRole(roleId);
  const createRoleMutation = useCreateRole();
  const deleteRoleMutation = useDeleteRole();

  // Dialog states
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [duplicating, setDuplicating] = useState(false);

  /**
   * Handle edit role
   */
  const handleEdit = () => {
    setEditDialogOpen(true);
  };

  /**
   * Handle duplicate role
   */
  const handleDuplicate = async () => {
    if (!role) return;

    if (!confirm(`Duplicate "${role.name}"? This will create a copy with "-copy" suffix.`)) {
      return;
    }

    setDuplicating(true);

    try {
      const result = await createRoleMutation.trigger({
        name: `${role.name} (Copy)`,
        slug: `${role.slug}-copy-${Date.now()}`,
        description: role.description || null,
        isDefault: false,
        metadata: null,
      });

      const createdRole = result.role || result.data;
      if (result.success && createdRole) {
        toast.success(`Role "${role.name}" duplicated successfully`);
        router.push(`/${lang}/admin/rbac/${createdRole.id}`);
      } else {
        toast.error(result.error || 'Failed to duplicate role');
      }
    } catch (error) {
      console.error('Duplicate error:', error);
      toast.error('An unexpected error occurred');
    } finally {
      setDuplicating(false);
    }
  };

  /**
   * Handle delete role
   */
  const handleDelete = async () => {
    if (!role) return;

    if (!confirm(`Are you sure you want to delete "${role.name}"? This action cannot be undone.`)) {
      return;
    }

    setDeleting(true);

    try {
      const result = await deleteRoleMutation.trigger(role.id);

      if (result.success) {
        toast.success(`Role "${role.name}" deleted successfully`);
        router.push(`/${lang}/admin/rbac`);
      } else {
        toast.error(result.error || 'Failed to delete role');
      }
    } catch (error) {
      console.error('Delete error:', error);
      toast.error('An unexpected error occurred');
    } finally {
      setDeleting(false);
    }
  };

  /**
   * Handle view assignments
   */
  const handleViewAssignments = () => {
    if (!role) return;
    router.push(
      `/${lang}/admin/users?tab=users&roleId=${role.id}&roleName=${encodeURIComponent(role.name)}`
    );
  };

  // Loading state
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center space-y-4">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
          <p className="text-muted-foreground">{t('detail.loading')}</p>
        </div>
      </div>
    );
  }

  // Error state
  if (!role) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" asChild>
          <Link href={`/${lang}/admin/rbac`}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            {t('detail.backToRoles')}
          </Link>
        </Button>
        <Card>
          <CardContent className="pt-6">
            <div className="text-center space-y-4">
              <p className="text-destructive">{t('detail.roleNotFound')}</p>
              <Button asChild>
                <Link href={`/${lang}/admin/rbac`}>{t('detail.returnToRoles')}</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Back Button */}
      <Button variant="ghost" asChild>
        <Link href={`/${lang}/admin/rbac`}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          {t('detail.backToRoles')}
        </Link>
      </Button>

      {/* Role Header */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col gap-6 md:flex-row md:items-start">
            {/* Icon */}
            <div className="flex h-24 w-24 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Shield className="h-12 w-12" />
            </div>

            {/* Role Info */}
            <div className="flex-1 space-y-4">
              <div>
                <div className="flex items-center gap-3">
                  <h1 className="text-3xl font-bold">{role.name}</h1>
                  {role.isDefault && <Badge variant="outline">Default</Badge>}
                </div>
                <div className="mt-2 flex flex-wrap gap-4 text-sm text-muted-foreground">
                  <span className="flex items-center gap-1">
                    Slug: <strong className="font-mono">{role.slug}</strong>
                  </span>
                  <span className="flex items-center gap-1">
                    <Users className="h-4 w-4" />
                    {role.userCount || 0} users
                  </span>
                  <span className="flex items-center gap-1">
                    <Calendar className="h-4 w-4" />
                    Created {new Date(role.createdAt).toLocaleDateString()}
                  </span>
                </div>
                {role.description && (
                  <p className="mt-2 text-sm text-muted-foreground">{role.description}</p>
                )}
              </div>

              {/* Actions */}
              <div className="flex gap-2">
                <Button onClick={handleEdit} disabled={deleting || duplicating}>
                  <Edit className="mr-2 h-4 w-4" />
                  {t('detail.editRole')}
                </Button>
                <Button
                  variant="outline"
                  onClick={handleDuplicate}
                  disabled={deleting || duplicating}
                >
                  {duplicating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  <Copy className="mr-2 h-4 w-4" />
                  {duplicating
                    ? t('rolesTable.actions.duplicating')
                    : t('rolesTable.actions.duplicateRole')}
                </Button>
                <Button
                  variant="outline"
                  onClick={handleViewAssignments}
                  disabled={deleting || duplicating}
                >
                  <Users className="mr-2 h-4 w-4" />
                  {t('rolesTable.actions.viewAssignments')}
                </Button>
                {!role.isDefault && (
                  <Button
                    variant="outline"
                    className="text-destructive"
                    onClick={handleDelete}
                    disabled={deleting || duplicating}
                  >
                    {deleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    <Trash2 className="mr-2 h-4 w-4" />
                    {deleting
                      ? t('rolesTable.actions.deleting')
                      : t('rolesTable.actions.deleteRole')}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs defaultValue="permissions" className="space-y-4">
        <TabsList>
          <TabsTrigger value="permissions">
            {role.permissions
              ? t('detail.tabs.permissionsWithCount', { count: role.permissions.length })
              : t('detail.tabs.permissions')}
          </TabsTrigger>
          <TabsTrigger value="settings">{t('detail.tabs.settings')}</TabsTrigger>
        </TabsList>

        {/* Permissions Tab */}
        <TabsContent value="permissions" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>{t('detail.permissions.title')}</CardTitle>
              <CardDescription>{t('detail.permissions.description')}</CardDescription>
            </CardHeader>
            <CardContent>
              {role.permissions && role.permissions.length > 0 ? (
                <div className="space-y-2">
                  {role.permissions.map((permission, idx) => (
                    <div
                      key={idx}
                      className="flex items-center gap-2 border-b pb-2 last:border-b-0"
                    >
                      <code className="text-sm font-mono bg-muted px-2 py-1 rounded">
                        {permission}
                      </code>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {t('detail.permissions.noPermissions')}
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Settings Tab */}
        <TabsContent value="settings" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>{t('detail.settings.title')}</CardTitle>
              <CardDescription>{t('detail.settings.description')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <h4 className="text-sm font-medium">{t('detail.settings.roleType.label')}</h4>
                <p className="text-sm text-muted-foreground">
                  {role.isDefault
                    ? t('detail.settings.roleType.default')
                    : t('detail.settings.roleType.custom')}
                </p>
              </div>

              <Separator />

              <div className="space-y-2">
                <h4 className="text-sm font-medium">{t('detail.settings.roleType.label')}</h4>
                <p className="text-sm text-muted-foreground">
                  {t(`detail.settings.isDefault.${role.isDefault ? 'true' : 'false'}`)}
                </p>
              </div>

              <Separator />

              <div className="space-y-2">
                <h4 className="text-sm font-medium">{t('detail.settings.created')}</h4>
                <p className="text-sm text-muted-foreground">
                  {new Date(role.createdAt).toLocaleString()}
                </p>
              </div>

              <Separator />

              <div className="space-y-2">
                <h4 className="text-sm font-medium">{t('detail.settings.lastUpdated')}</h4>
                <p className="text-sm text-muted-foreground">
                  {new Date(role.updatedAt).toLocaleString()}
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Edit Dialog */}
      <RoleDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        role={role}
        onSuccess={() => {
          refetch();
          setEditDialogOpen(false);
        }}
      />
    </div>
  );
}
