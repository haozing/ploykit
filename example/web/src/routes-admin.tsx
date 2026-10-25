import { Navigate } from '@tanstack/react-router';
import {
  AdminShell,
  OverviewPage,
  UsersPage,
  UserDetailPage,
  WorkspacesPage,
  WorkspaceDetailPage,
  OrdersPage,
  PlansPage,
  WebhookDeliveriesPage,
  AuditPage,
  SSOPage,
  AdminSettingsPage,
} from '@ploykit/ui';
import { RequirePlatformAdmin, userPanelItems } from './shell';
import { NavVisibilityCard } from './pages/admin/NavVisibilityCard';

/**
 * 平台管理控制台：一个 chunk，只有平台管理员会下载。
 *
 * 分成独立 chunk 的理由不是体积而是受众：管理台是运维面，产品普通用户
 * 一辈子不会打开它。把 9 个管理页挂在首页的下载路径上，等于让每个访客
 * 为一把自己打不开的门付流量。
 */

function adminPage(children: React.ReactNode) {
  return (
    <RequirePlatformAdmin>
      <AdminShell productPath="/app" loginPath="/login" userMenuItems={userPanelItems}>
        {children}
      </AdminShell>
    </RequirePlatformAdmin>
  );
}

export function AdminIndex() {
  return (
    <RequirePlatformAdmin>
      <Navigate to="/admin/overview" replace />
    </RequirePlatformAdmin>
  );
}

export function AdminOverview() {
  return adminPage(<OverviewPage />);
}

export function AdminUsers() {
  return adminPage(<UsersPage impersonatePath="/app" />);
}

export function AdminUserDetail() {
  return adminPage(<UserDetailPage />);
}

export function AdminWorkspaces() {
  return adminPage(<WorkspacesPage />);
}

export function AdminWorkspaceDetail() {
  return adminPage(<WorkspaceDetailPage />);
}

export function AdminOrders() {
  return adminPage(<OrdersPage />);
}

export function AdminWebhookDeliveries() {
  return adminPage(<WebhookDeliveriesPage />);
}

export function AdminAudit() {
  return adminPage(<AuditPage />);
}

export function AdminPlans() {
  return adminPage(<PlansPage />);
}

export function AdminSSO() {
  return adminPage(<SSOPage />);
}

export function AdminSettings() {
  // children 缝（shuijing 2026-10-25 批）：产品卡渲染在框架卡之后，
  // 共用同一页；菜单显隐是产品壳的事，框架页没有它的专属卡。
  return adminPage(
    <AdminSettingsPage>
      <NavVisibilityCard />
    </AdminSettingsPage>,
  );
}
