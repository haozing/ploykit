import { Shell } from './shell';
import { Dashboard } from './pages/Dashboard';
import { RealtimePage } from './pages/RealtimePage';
import { VideoStudioListPage } from './pages/VideoStudioListPage';
import { VideoStudioPage } from './pages/VideoStudioPage';
import { InviteAcceptPage, BillingSuccessPage } from '@ploykit/ui';
import { useParams } from '@ploykit/ui/router';

/**
 * /app 区、实时调试页、视频工作室与邀请/支付回执：产品日常动线，一个 chunk。
 *
 * 这些页面在入口 chunk 之外，只有真正进入 /app 才下载——公开面（落地页、
 * 登录、注册、博客）不为它们付字节。Dashboard / RealtimePage / VideoStudio*
 * 是本产品的页面（不在 @ploykit/ui 里），与组内页面同批加载。
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

/**
 * /studio 与 /studio/:id 的包装组件。:id 从 router context 取（useParams，
 * @ploykit/ui/router 适配器——包装组件活在 tanstackAssembler 的 InnerWrap
 * 路径之内，与 @ploykit/ui 的 detail 页同款做法）。
 */
export function VideoStudioListRoute() {
  return (
    <Shell breadcrumbTail="视频工作室">
      <VideoStudioListPage />
    </Shell>
  );
}

export function VideoStudioRoute() {
  const { id = '' } = useParams();
  return (
    <Shell breadcrumbTail="视频工作室">
      <VideoStudioPage projectId={id} />
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
