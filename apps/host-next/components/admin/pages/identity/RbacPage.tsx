import Link from 'next/link';
import { ShieldCheck, UserCheck, Users } from 'lucide-react';
import { adminNav, StatCard, WorkspaceShell } from '@host/components/ProductShell';
import { DataTable, Input, Select } from '@host/components/ui';
import { StatusBadge } from '@host/components/admin/shared/StatusBadge';
import {
  AdminPanel,
  EvidenceSection,
  PermissionMatrix,
  StatGrid,
  TimelineList,
} from '@host/components/admin/shared/AdminPrimitives';
import { localizedPath, type SupportedLanguage } from '@host/lib/i18n';
import { adminInlineColumns, adminInlineText } from '@host/lib/admin-inline-i18n';
import { getAdminRbacCopy } from '@host/lib/admin-copy';
import type { AdminTableQuery } from '@host/lib/table-query';
import type { RuntimeStoreHostUser } from '@/lib/module-runtime';
import { cleanIdentityTableQuery, matchesTextSearch } from './IdentityPageModel';

export function AdminRbacOperationsPage({
  lang,
  roles,
  permissions,
  users = [],
  query,
}: {
  lang: SupportedLanguage;
  roles: readonly {
    id: string;
    label: string;
    builtIn: boolean;
    capabilities: readonly string[];
    modulePermissions: readonly string[];
  }[];
  permissions: {
    hostCapabilities: readonly { id: string; label: string }[];
    modulePermissions: readonly { value: string }[];
  };
  users?: readonly RuntimeStoreHostUser[];
  query?: AdminTableQuery;
}) {
  const copy = getAdminRbacCopy(lang);
  const tableQuery = cleanIdentityTableQuery(query);
  const systemRoles = roles.filter((role) => role.builtIn).length;
  const adminRole = roles.find((role) => role.id === 'admin');
  const totalCapabilities = roles.reduce((sum, role) => sum + role.capabilities.length, 0);
  const totalModulePermissions = roles.reduce(
    (sum, role) => sum + role.modulePermissions.length,
    0
  );
  const highRiskAuthorizationCount = (role: (typeof roles)[number]) => {
    const hostRisk = role.capabilities.filter(
      (capability) =>
        capability.includes('write') ||
        capability.includes('manage') ||
        capability === 'admin.users.manage' ||
        capability === 'admin.settings.write'
    ).length;
    const moduleRisk = role.modulePermissions.filter((permission) =>
      /write|delete|manage|admin|billing/i.test(permission)
    ).length;
    return hostRisk + moduleRisk;
  };
  const membersByRole = users.reduce<Record<string, number>>((acc, user) => {
    acc[user.role] = (acc[user.role] ?? 0) + 1;
    return acc;
  }, {});
  const matrixRoles = roles.map((role) => ({
    ...role,
    id: role.id,
    label: role.label,
    builtIn: role.builtIn,
    capabilities: role.capabilities,
    modulePermissions: role.modulePermissions,
  }));
  const matrixPermissions = [
    ...permissions.hostCapabilities.map((capability) => ({
      id: capability.id,
      label: capability.label,
      group: 'host' as const,
      category: `Host · ${capability.id.split(/[.:_-]/)[0].replace(/\b\w/g, (value) => value.toUpperCase())}`,
      description: copy.hostCoverage,
    })),
    ...permissions.modulePermissions.map((permission) => ({
      id: permission.value,
      label: permission.value,
      group: 'module' as const,
      category: `Module · ${permission.value.split(/[.:_-]/)[0].replace(/\b\w/g, (value) => value.toUpperCase())}`,
      description: copy.moduleCoverage,
    })),
  ];
  const filteredMatrixPermissions = matrixPermissions.filter(
    (permission) =>
      matchesTextSearch(tableQuery.q, [
        permission.id,
        permission.label,
        permission.category,
        permission.description,
      ]) &&
      (!tableQuery.type || permission.group === tableQuery.type)
  );
  const diffLeft = roles.find((role) => role.id === 'admin') ?? roles[0];
  const diffRight = roles.find((role) => role.id === 'user') ?? roles[1] ?? diffLeft;
  const permissionDiffRows = filteredMatrixPermissions.map((permission) => {
    const leftGranted =
      permission.group === 'host'
        ? diffLeft?.capabilities.includes(permission.id)
        : diffLeft?.modulePermissions.includes(permission.id);
    const rightGranted =
      permission.group === 'host'
        ? diffRight?.capabilities.includes(permission.id)
        : diffRight?.modulePermissions.includes(permission.id);
    return [
      <span key={`${permission.id}:permission`} className="block min-w-0">
        <span className="block truncate font-semibold text-admin-text">{permission.label}</span>
        <span className="mt-0.5 block truncate font-mono text-[11px] text-admin-text-muted">
          {permission.id}
        </span>
      </span>,
      leftGranted ? adminInlineText(lang, 'yes') : '-',
      rightGranted ? adminInlineText(lang, 'yes') : '-',
      leftGranted === rightGranted
        ? adminInlineText(lang, 'same_c8958a49')
        : adminInlineText(lang, 'diff_f5d65d73'),
    ];
  });
  const coverageTimeline = [
    {
      key: 'roles',
      title: copy.roleSnapshot,
      description: copy.roleSnapshotDescription(roles.length, systemRoles),
      meta: copy.roleSnapshotMeta(totalCapabilities, totalModulePermissions),
      tone: 'primary' as const,
    },
    {
      key: 'host',
      title: copy.hostInventory,
      description: copy.hostInventoryDescription(permissions.hostCapabilities.length),
      meta: copy.currentMatrix,
      tone: 'info' as const,
    },
    {
      key: 'module',
      title: copy.moduleInventory,
      description: copy.moduleInventoryDescription(permissions.modulePermissions.length),
      meta: copy.currentMatrix,
      tone: 'success' as const,
    },
  ];
  return (
    <WorkspaceShell lang={lang} title={copy.title} subtitle={copy.subtitle} nav={adminNav}>
      <StatGrid>
        <StatCard
          label={copy.roles}
          value={String(roles.length)}
          helper={copy.systemRoles(systemRoles)}
          tone="blue"
          icon={ShieldCheck}
        />
        <StatCard
          label={copy.capabilities}
          value={String(permissions.hostCapabilities.length)}
          helper={copy.assigned(totalCapabilities)}
          icon={UserCheck}
        />
        <StatCard
          label={copy.modulePermissions}
          value={String(permissions.modulePermissions.length)}
          helper={copy.assigned(totalModulePermissions)}
          icon={Users}
        />
        <StatCard
          label={copy.customRoles}
          value={String(roles.length - systemRoles)}
          helper={copy.productAccess}
          icon={ShieldCheck}
        />
      </StatGrid>

      <AdminPanel
        title={copy.roleManagementTitle}
        description={copy.roleManagementDescription}
        contentClassName="p-0"
      >
        <DataTable
          className="rounded-none border-x-0 shadow-none"
          columns={adminInlineColumns(lang, [
            'Role',
            'Type',
            'Members',
            'Capabilities',
            'High-risk',
            'Module permissions',
            'Status',
          ])}
          rows={roles.map((role) => [
            role.label,
            role.builtIn ? copy.systemRole : copy.customRole,
            String(membersByRole[role.id] ?? 0),
            String(role.capabilities.length),
            String(highRiskAuthorizationCount(role)),
            String(role.modulePermissions.length),
            <StatusBadge
              key={role.id}
              lang={lang}
              value={role.builtIn ? 'system' : 'custom'}
              label={role.builtIn ? copy.systemRole : copy.customRole}
              tone={role.builtIn ? 'info' : 'success'}
            />,
          ])}
          empty={copy.empty}
          minWidthClass="min-w-[980px]"
        />
        {adminRole && adminRole.modulePermissions.length === 0 ? (
          <div className="border-t border-admin-border px-4 py-3 text-sm leading-6 text-admin-text-muted sm:px-5">
            {adminInlineText(lang, 'admin_has_0_module_permissions_by_design_host_admins_fec4e732')}
          </div>
        ) : null}
      </AdminPanel>

      <AdminPanel
        title={copy.panelTitle}
        description={copy.panelDescription}
        contentClassName="grid gap-4"
      >
        <div className="grid gap-2 sm:grid-cols-3">
          <div className="rounded-admin-md border border-admin-border bg-admin-bg/45 px-3 py-2.5">
            <span className="block text-[11px] font-semibold uppercase text-admin-text-subtle">
              {copy.systemRolesLabel}
            </span>
            <strong className="mt-1 block text-sm text-admin-text">{systemRoles}</strong>
          </div>
          <div className="rounded-admin-md border border-admin-border bg-admin-bg/45 px-3 py-2.5">
            <span className="block text-[11px] font-semibold uppercase text-admin-text-subtle">
              {copy.hostAssignments}
            </span>
            <strong className="mt-1 block text-sm text-admin-text">{totalCapabilities}</strong>
          </div>
          <div className="rounded-admin-md border border-admin-border bg-admin-bg/45 px-3 py-2.5">
            <span className="block text-[11px] font-semibold uppercase text-admin-text-subtle">
              {copy.moduleAssignments}
            </span>
            <strong className="mt-1 block text-sm text-admin-text">{totalModulePermissions}</strong>
          </div>
        </div>
        <form
          method="get"
          className="grid gap-3 rounded-admin-md border border-admin-border bg-admin-bg/45 p-3 md:grid-cols-[minmax(0,1fr)_180px_auto] md:items-end"
        >
          <label className="grid gap-2 text-sm font-medium text-admin-text">
            <span className="text-xs font-semibold uppercase text-admin-text-subtle">
              {adminInlineText(lang, 'permission_search_43af6a5b')}
            </span>
            <Input
              type="search"
              name="q"
              defaultValue={tableQuery.q}
              placeholder={adminInlineText(
                lang,
                'search_capability_permission_or_category_e4548dae'
              )}
            />
          </label>
          <label className="grid gap-2 text-sm font-medium text-admin-text">
            <span className="text-xs font-semibold uppercase text-admin-text-subtle">
              {adminInlineText(lang, 'scope_2e8dbfee')}
            </span>
            <Select
              name="type"
              defaultValue={tableQuery.type}
              aria-label={adminInlineText(lang, 'permission_scope_44e7a957')}
            >
              <option value="">{adminInlineText(lang, 'All')}</option>
              <option value="host">{adminInlineText(lang, 'host_capabilities_e1480ad4')}</option>
              <option value="module">{adminInlineText(lang, 'module_permissions_628742dc')}</option>
            </Select>
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="submit"
              className="inline-flex min-h-9 items-center justify-center rounded-admin-md bg-admin-primary px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary"
            >
              {adminInlineText(lang, 'Filter')}
            </button>
            {tableQuery.q || tableQuery.type ? (
              <Link
                href={localizedPath(lang, '/admin/rbac')}
                className="inline-flex min-h-9 items-center justify-center rounded-admin-md border border-admin-border px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted"
              >
                {adminInlineText(lang, 'Clear')}
              </Link>
            ) : null}
          </div>
        </form>
        <EvidenceSection
          title={copy.coverageEvidenceTitle}
          description={copy.coverageEvidenceDescription}
        >
          <PermissionMatrix
            lang={lang}
            roles={matrixRoles}
            permissions={filteredMatrixPermissions}
          />
        </EvidenceSection>
        <EvidenceSection
          title={adminInlineText(lang, 'permission_diff_view_116b636d')}
          description={adminInlineText(
            lang,
            'compares_admin_and_user_roles_by_default_filters_app_e1d91d4a'
          )}
        >
          <DataTable
            className="shadow-none"
            columns={adminInlineColumns(lang, [
              'Permission',
              diffLeft?.label ?? 'Left',
              diffRight?.label ?? 'Right',
              'Diff',
            ])}
            rows={permissionDiffRows}
            empty={adminInlineText(lang, 'no_permissions_match_this_filter_598e3d56')}
            minWidthClass="min-w-[760px]"
          />
        </EvidenceSection>
        <TimelineList lang={lang} items={coverageTimeline} empty={copy.empty} />
      </AdminPanel>
    </WorkspaceShell>
  );
}
