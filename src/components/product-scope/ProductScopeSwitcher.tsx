'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Building2, Check, ChevronDown, Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { useProductScope } from '@/hooks/use-product-scope';

function messageFromError(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function ProductScopeSwitcher() {
  const t = useTranslations('dashboard.header.productScope');
  const router = useRouter();
  const { product, current, scopes, createScope, switchScope } = useProductScope();
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [switchingWorkspaceId, setSwitchingWorkspaceId] = useState<string | null>(null);

  if (!product || product.profile.mode === 'hidden-default') {
    return null;
  }

  const profile = product.profile;
  const canOpenMenu = Boolean(current && (profile.allowSwitch || profile.allowCreate));
  const canCreate = profile.allowCreate;

  async function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = createName.trim();
    if (!name) {
      return;
    }

    try {
      setIsCreating(true);
      await createScope({ name });
      setCreateName('');
      setCreateOpen(false);
      router.refresh();
    } catch (error) {
      toast.error(messageFromError(error, t('createFailed')));
    } finally {
      setIsCreating(false);
    }
  }

  async function handleSwitch(workspaceId: string) {
    if (workspaceId === current?.workspaceId) {
      return;
    }

    try {
      setSwitchingWorkspaceId(workspaceId);
      await switchScope(workspaceId);
      router.refresh();
    } catch (error) {
      toast.error(messageFromError(error, t('switchFailed')));
    } finally {
      setSwitchingWorkspaceId(null);
    }
  }

  if (!current) {
    if (!canCreate) {
      return null;
    }

    return (
      <>
        <Button variant="outline" size="sm" className="gap-2" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">{t('create', { label: profile.label })}</span>
        </Button>
        <CreateScopeDialog
          label={profile.label}
          open={createOpen}
          name={createName}
          isCreating={isCreating}
          onOpenChange={setCreateOpen}
          onNameChange={setCreateName}
          onSubmit={handleCreate}
        />
      </>
    );
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={!canOpenMenu}>
          <Button
            variant="ghost"
            size="sm"
            className="min-w-0 max-w-[220px] gap-2 px-2 hover:bg-primary/10 hover:text-primary"
          >
            <Building2 className="h-4 w-4 shrink-0" />
            <span className="min-w-0 truncate text-sm font-medium">{current.displayName}</span>
            {canOpenMenu && <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel>{profile.pluralLabel}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {scopes.length === 0 && (
            <DropdownMenuItem disabled>
              {t('empty', { label: profile.pluralLabel })}
            </DropdownMenuItem>
          )}
          {scopes.map((scope) => (
            <DropdownMenuItem
              key={scope.workspaceId}
              disabled={switchingWorkspaceId !== null}
              onSelect={() => void handleSwitch(scope.workspaceId)}
            >
              <span className="min-w-0 flex-1 truncate">{scope.displayName}</span>
              {switchingWorkspaceId === scope.workspaceId ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : scope.workspaceId === current.workspaceId ? (
                <Check className="h-4 w-4" />
              ) : null}
            </DropdownMenuItem>
          ))}
          {canCreate && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault();
                  setCreateOpen(true);
                }}
              >
                <Plus className="h-4 w-4" />
                {t('create', { label: profile.label })}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <CreateScopeDialog
        label={profile.label}
        open={createOpen}
        name={createName}
        isCreating={isCreating}
        onOpenChange={setCreateOpen}
        onNameChange={setCreateName}
        onSubmit={handleCreate}
      />
    </>
  );
}

interface CreateScopeDialogProps {
  label: string;
  open: boolean;
  name: string;
  isCreating: boolean;
  onOpenChange: (open: boolean) => void;
  onNameChange: (value: string) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}

function CreateScopeDialog({
  label,
  open,
  name,
  isCreating,
  onOpenChange,
  onNameChange,
  onSubmit,
}: CreateScopeDialogProps) {
  const t = useTranslations('dashboard.header.productScope');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={onSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{t('createTitle', { label })}</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            value={name}
            maxLength={120}
            placeholder={t('namePlaceholder', { label })}
            aria-label={t('nameAriaLabel', { label })}
            onChange={(event) => onNameChange(event.target.value)}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('cancel')}
            </Button>
            <Button type="submit" disabled={!name.trim() || isCreating}>
              {isCreating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('createAction')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
