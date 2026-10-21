import { useEffect, useState } from 'react';
import { Navigate } from '@tanstack/react-router';
import {
  NotificationPreferencesPage,
  ProfileSettingsPage,
  SecuritySettingsPage,
  TokensPage,
  MembersPage,
  RolePermissionsPage,
  WorkspaceGeneralPage,
  WorkspaceAuditPage,
  UsagePage,
  WebhooksPage,
  BillingPage,
  SchedulesPage,
} from '@ploykit/ui';
import type { NotificationTypeMeta } from '@ploykit/ui';
import { useSiteConfig } from '@ploykit/hooks';
import { api } from '@ploykit/client';
import { AccountLayout, SettingsLayout } from './shell';

/**
 * 账户与工作区设置区：一个 chunk。
 *
 * 账户四件套（个人资料/安全/令牌/通知偏好）与工作区八件套都是配置面——只
 * 有已登录用户会走到，和公开面没有重叠。合成一组而不是每页一个 chunk：
 * 设置页之间切换极频繁（侧栏就是为这个设计的），逐页拆只会让每次点击多付
 * 一次网络往返。
 */

export function Notifications() {
  const [types, setTypes] = useState<NotificationTypeMeta[] | undefined>(
    undefined,
  );
  const configQ = useSiteConfig();
  const emailChannelNote =
    configQ.data?.mail_mode === 'dev'
      ? '当前环境未接真实邮件发送（仅记录日志）；配置 SMTP 后此开关才会产生真实邮件'
      : undefined;
  useEffect(() => {
    let alive = true;
    api
      .get<{ items?: NotificationTypeMeta[] }>('/api/notification-types')
      .then((d) => {
        if (alive) setTypes(d?.items ?? []);
      })
      .catch(() => {
        /* 目录不可用：退回偏好行兜底 */
      });
    return () => {
      alive = false;
    };
  }, []);
  return (
    <NotificationPreferencesPage
      types={types}
      emailChannelNote={emailChannelNote}
    />
  );
}

export function AccountIndex() {
  return <Navigate to="/account/profile" replace />;
}

export function AccountProfile() {
  return (
    <AccountLayout>
      <ProfileSettingsPage />
    </AccountLayout>
  );
}

export function AccountSecurity() {
  return (
    <AccountLayout>
      <SecuritySettingsPage />
    </AccountLayout>
  );
}

export function AccountTokens() {
  return (
    <AccountLayout>
      <TokensPage />
    </AccountLayout>
  );
}

export function AccountNotifications() {
  return (
    <AccountLayout>
      <Notifications />
    </AccountLayout>
  );
}

export function SettingsIndex() {
  return <Navigate to="/settings/workspace/general" replace />;
}

export function WorkspaceGeneral() {
  return (
    <SettingsLayout>
      <WorkspaceGeneralPage />
    </SettingsLayout>
  );
}

export function WorkspaceMembers() {
  return (
    <SettingsLayout>
      <MembersPage />
    </SettingsLayout>
  );
}

export function WorkspaceRoles() {
  return (
    <SettingsLayout>
      <RolePermissionsPage />
    </SettingsLayout>
  );
}

export function WorkspaceAudit() {
  return (
    <SettingsLayout>
      <WorkspaceAuditPage />
    </SettingsLayout>
  );
}

export function WorkspaceUsage() {
  return (
    <SettingsLayout>
      <UsagePage />
    </SettingsLayout>
  );
}

export function WorkspaceBilling() {
  return (
    <SettingsLayout>
      <BillingPage />
    </SettingsLayout>
  );
}

export function WorkspaceWebhooks() {
  return (
    <SettingsLayout>
      <WebhooksPage />
    </SettingsLayout>
  );
}

export function WorkspaceSchedules() {
  return (
    <SettingsLayout>
      <SchedulesPage />
    </SettingsLayout>
  );
}
