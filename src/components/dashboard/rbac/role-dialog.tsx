'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, CheckCircle2 } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useCreateRole, useUpdateRole, type RoleWithDetails } from '@/hooks/use-roles';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';

interface PermissionTemplate {
  key: string;
  identifier: string;
  description: string;
  resource: string;
  action: string;
  scope: string;
}

/**
 * Role Dialog Props
 */
interface RoleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  role?: RoleWithDetails | null;
  onSuccess?: () => void;
}

/**
 * Role Dialog Component
 *
 * Used for creating new roles or editing existing ones
 */
export function RoleDialog({ open, onOpenChange, role, onSuccess }: RoleDialogProps) {
  const t = useTranslations('dashboard.rbac.roleDialog');
  const isEdit = !!role;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Form state
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [permissionCatalog, setPermissionCatalog] = useState<PermissionTemplate[]>([]);
  const [permissionLoading, setPermissionLoading] = useState(false);
  const createRoleMutation = useCreateRole();
  const updateRoleMutation = useUpdateRole();

  useEffect(() => {
    if (!open || permissionCatalog.length > 0 || permissionLoading) {
      return;
    }

    setPermissionLoading(true);
    fetch('/api/admin/permissions?templates=true')
      .then(async (response) => {
        if (!response.ok) {
          throw new Error('Failed to load permission catalog');
        }
        return response.json() as Promise<{ permissions?: PermissionTemplate[] }>;
      })
      .then((data) => setPermissionCatalog(data.permissions ?? []))
      .catch((error) => {
        console.error('Permission catalog load error:', error);
        setError(error instanceof Error ? error.message : 'Failed to load permission catalog');
      })
      .finally(() => setPermissionLoading(false));
  }, [open, permissionCatalog.length, permissionLoading]);

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      if (role) {
        setName(role.name);
        setSlug(role.slug);
        setDescription(role.description || '');
        setIsDefault(role.isDefault || false);
        setPermissions(role.permissions || []);
      } else {
        setName('');
        setSlug('');
        setDescription('');
        setIsDefault(false);
        setPermissions([]);
      }
      setError(null);
      setSuccess(false);
    }
  }, [open, role]);

  // Auto-generate slug from name
  const handleNameChange = (value: string) => {
    setName(value);
    if (!isEdit) {
      const generatedSlug = value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
      setSlug(generatedSlug);
    }
  };

  const togglePermission = (identifier: string, checked: boolean) => {
    setPermissions((current) => {
      if (checked) {
        return current.includes(identifier) ? current : [...current, identifier].sort();
      }

      return current.filter((permission) => permission !== identifier);
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim() || !slug.trim()) {
      setError(t('errors.required'));
      return;
    }

    setLoading(true);
    setError(null);

    try {
      let result;
      if (isEdit && role) {
        result = await updateRoleMutation.trigger({
          roleId: role.id,
          updates: {
            name,
            slug,
            description: description.trim() || undefined,
            permissions,
            isDefault,
          },
        });
      } else {
        result = await createRoleMutation.trigger({
          name,
          slug,
          description: description.trim() || undefined,
          permissions,
          isDefault,
        });
      }

      if (!result.success) {
        throw new Error(result.error || t('errors.operationFailed'));
      }

      setSuccess(true);

      // Close dialog after 1.5 seconds
      setTimeout(() => {
        onOpenChange(false);
        onSuccess?.();
      }, 1500);
    } catch (error) {
      console.error('Role operation error:', error);
      setError(error instanceof Error ? error.message : t('errors.operationFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{isEdit ? t('title.edit') : t('title.create')}</DialogTitle>
          <DialogDescription>
            {isEdit ? t('description.edit') : t('description.create')}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Name */}
          <div className="space-y-2">
            <Label htmlFor="name">{t('fields.name.label')}</Label>
            <Input
              id="name"
              placeholder={t('fields.name.placeholder')}
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              disabled={loading || success}
              required
            />
          </div>

          {/* Slug */}
          <div className="space-y-2">
            <Label htmlFor="slug">{t('fields.slug.label')}</Label>
            <Input
              id="slug"
              placeholder={t('fields.slug.placeholder')}
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              disabled={loading || success}
              required
            />
            <p className="text-xs text-muted-foreground">{t('fields.slug.hint')}</p>
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="description">{t('fields.description.label')}</Label>
            <Textarea
              id="description"
              placeholder={t('fields.description.placeholder')}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={loading || success}
              rows={3}
            />
          </div>

          {/* Default Role */}
          <div className="flex items-center space-x-2">
            <Checkbox
              id="isDefault"
              checked={isDefault}
              onCheckedChange={(checked) => setIsDefault(checked as boolean)}
              disabled={loading || success}
            />
            <label
              htmlFor="isDefault"
              className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
            >
              {t('fields.isDefault.label')}
            </label>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <Label>Permissions</Label>
              <Badge variant="secondary">{permissions.length} selected</Badge>
            </div>
            <div className="max-h-64 space-y-4 overflow-y-auto rounded-md border p-3">
              {permissionLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading permission catalog
                </div>
              ) : permissionCatalog.length === 0 ? (
                <p className="text-sm text-muted-foreground">No permissions found.</p>
              ) : (
                Object.entries(
                  permissionCatalog.reduce<Record<string, PermissionTemplate[]>>(
                    (groups, permission) => {
                      groups[permission.resource] = groups[permission.resource] || [];
                      groups[permission.resource].push(permission);
                      return groups;
                    },
                    {}
                  )
                ).map(([resource, items]) => (
                  <div key={resource} className="space-y-2">
                    <div className="text-xs font-semibold uppercase text-muted-foreground">
                      {resource}
                    </div>
                    <div className="grid gap-2">
                      {items.map((permission) => (
                        <label
                          key={permission.identifier}
                          className="flex cursor-pointer items-start gap-2 rounded-md border p-2 hover:bg-muted/40"
                        >
                          <Checkbox
                            checked={permissions.includes(permission.identifier)}
                            onCheckedChange={(checked) =>
                              togglePermission(permission.identifier, checked === true)
                            }
                            disabled={loading || success}
                          />
                          <span className="min-w-0">
                            <span className="block font-mono text-xs">{permission.identifier}</span>
                            <span className="block text-xs text-muted-foreground">
                              {permission.description}
                            </span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Error Alert */}
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* Success Alert */}
          {success && (
            <Alert className="border-success bg-success-50 text-green-900">
              <CheckCircle2 className="h-4 w-4" />
              <AlertDescription>
                {isEdit ? t('success.updated') : t('success.created')}
              </AlertDescription>
            </Alert>
          )}

          {/* Footer */}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading || success}
            >
              {t('buttons.cancel')}
            </Button>
            <Button type="submit" disabled={loading || success}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {success ? t('buttons.saved') : isEdit ? t('buttons.update') : t('buttons.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
