'use client';

import * as React from 'react';
import { RefreshCw, ShieldCheck, ShieldMinus, ShieldPlus } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAssignRole, useRevokeRole, useRoles, type RoleWithDetails } from '@/hooks/use-roles';

interface UserRoleManagerProps {
  userId: string;
  currentRole: {
    id: string;
    name: string;
    slug: string;
    permissions?: string[];
  } | null;
}

export function UserRoleManager({ userId, currentRole }: UserRoleManagerProps) {
  const [selectedRoleId, setSelectedRoleId] = React.useState('');
  const [role, setRole] = React.useState(currentRole);
  const [message, setMessage] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const { roles, loading, refetch } = useRoles({ page: 1, limit: 100 });
  const { trigger: assignRole, isMutating: assigning } = useAssignRole();
  const { trigger: revokeRole, isMutating: revoking } = useRevokeRole();

  const selectedRole = roles.find((item) => item.id === selectedRoleId);
  const availableRoles = role ? roles.filter((item) => item.id !== role.id) : roles;
  const busy = assigning || revoking;

  async function handleAssign() {
    if (!selectedRoleId || !selectedRole) {
      return;
    }

    setError(null);
    setMessage(null);

    try {
      await assignRole({ roleId: selectedRoleId, userId });
      setRole(toAssignedRole(selectedRole));
      setSelectedRoleId('');
      setMessage(`Assigned ${selectedRole.name}.`);
      refetch();
    } catch (assignError) {
      setError(assignError instanceof Error ? assignError.message : 'Failed to assign role.');
    }
  }

  async function handleRevoke() {
    if (!role) {
      return;
    }

    setError(null);
    setMessage(null);

    try {
      await revokeRole({ roleId: role.id, userId });
      setMessage(`Revoked ${role.name}.`);
      setRole(null);
      refetch();
    } catch (revokeError) {
      setError(revokeError instanceof Error ? revokeError.message : 'Failed to revoke role.');
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md border p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="space-y-2">
            <div className="text-sm font-medium">Current role</div>
            {role ? (
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary" className="gap-1.5">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  {role.name}
                </Badge>
                <span className="text-xs text-muted-foreground">{role.slug}</span>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">No role assigned</div>
            )}
          </div>

          {role ? (
            <Button variant="outline" size="sm" onClick={() => void handleRevoke()} disabled={busy}>
              <ShieldMinus className="mr-2 h-4 w-4" />
              Revoke Role
            </Button>
          ) : null}
        </div>
      </div>

      {!role ? (
        <div className="grid gap-3 md:grid-cols-[1fr_auto]">
          <Select
            value={selectedRoleId}
            onValueChange={setSelectedRoleId}
            disabled={busy || loading}
          >
            <SelectTrigger>
              <SelectValue placeholder={loading ? 'Loading roles...' : 'Select a role'} />
            </SelectTrigger>
            <SelectContent>
              {availableRoles.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.name} ({item.slug})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={() => void handleAssign()} disabled={!selectedRoleId || busy}>
            <ShieldPlus className="mr-2 h-4 w-4" />
            Assign Role
          </Button>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          This system uses one active role per user. Revoke the current role before assigning a
          different one.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" onClick={refetch} disabled={busy || loading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh Roles
        </Button>
        {message ? <span className="text-sm text-success">{message}</span> : null}
        {error ? <span className="text-sm text-destructive">{error}</span> : null}
      </div>
    </div>
  );
}

function toAssignedRole(role: RoleWithDetails) {
  return {
    id: role.id,
    name: role.name,
    slug: role.slug,
    permissions: role.permissions ?? [],
  };
}
