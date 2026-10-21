import { Shell } from './shell';
import { Dashboard } from './pages/Dashboard';
import { RealtimePage } from './pages/RealtimePage';
import { InviteAcceptPage, BillingSuccessPage } from '@ploykit/ui';

/**
 * /app 区、实时调试页与邀请/支付回执：产品日常动线，一个 chunk。
 *
 * 这些页面在入口 chunk 之外，只有真正进入 /app 才下载——公开面（落地页、
 * 登录、注册、博客）不为它们付字节。Dashboard / RealtimePage 是本产品的
 * 页面（不在 @ploykit/ui 里），与组内页面同批加载。
 */

export function AppPage() {
  return (
    <Shell breadcrumbTail="概览">
      <Dashboard />
    </Shell>
  );
}

export function RealtimeRoute() {
  return (
    <Shell breadcrumbTail="实时连接（调试）">
      <RealtimePage />
    </Shell>
  );
}

export function InvitationsPage() {
  return (
    <Shell>
      <InviteAcceptPage />
    </Shell>
  );
}

export function BillingSuccessRoute() {
  return (
    <Shell>
      <BillingSuccessPage />
    </Shell>
  );
}
