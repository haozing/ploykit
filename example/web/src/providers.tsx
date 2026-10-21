import { useEffect, type ReactNode } from 'react';
import { useLocation } from '@tanstack/react-router';
import { useWorkspace } from '@ploykit/hooks';
import { AppProviders as PloykitAppProviders } from '@ploykit/ui';
import { setWsWorkspace } from './ws';

/**
 * 根级 Provider 链：每个页面都要，包括公开面。
 *
 * 与 shell.tsx 分开是本文件存在的全部理由——shell 里的 AppShell/侧栏/通知
 * 铃只有登录后页面需要，但 Provider 链必须挂在 router 最外层。两者同处一个
 * 模块，打包器就只能把整个产品壳（侧栏 + 全部图标 + 通知组件）塞进首包，
 * 连落地页和登录页都要下载它们。
 */

const PAGE_TITLES: Array<[RegExp, string]> = [
  [/^\/admin\/users\/./, '用户详情 · 管理控制台'],
  [/^\/admin\/users/, '用户 · 管理控制台'],
  [/^\/admin\/workspaces\/./, '工作区详情 · 管理控制台'],
  [/^\/admin\/workspaces/, '工作区 · 管理控制台'],
  [/^\/admin\/orders/, '订单 · 管理控制台'],
  [/^\/admin\/plans/, '套餐 · 管理控制台'],
  [/^\/admin\/webhook-deliveries/, 'Webhooks · 管理控制台'],
  [/^\/admin\/audit/, '审计 · 管理控制台'],
  [/^\/admin\/sso/, 'SSO · 管理控制台'],
  [/^\/admin\/settings/, '系统 · 管理控制台'],
  [/^\/admin\/overview/, '概览 · 管理控制台'],
  [/^\/admin/, '管理控制台'],
  [/^\/account\/profile/, '个人资料 · 设置'],
  [/^\/account\/security/, '安全 · 设置'],
  [/^\/account\/tokens/, '访问令牌 · 设置'],
  [/^\/account\/notifications/, '通知偏好 · 设置'],
  [/^\/account/, '设置'],
  [/^\/settings\/workspace\/general/, '概况 · 工作区设置'],
  [/^\/settings\/workspace\/members/, '成员 · 工作区设置'],
  [/^\/settings\/workspace\/audit/, '审计 · 工作区设置'],
  [/^\/settings\/workspace\/usage/, '用量 · 工作区设置'],
  [/^\/settings\/workspace\/billing/, '计费 · 工作区设置'],
  [/^\/settings\/workspace\/webhooks/, 'Webhooks · 工作区设置'],
  [/^\/settings\/workspace\/schedules/, '调度 · 工作区设置'],
  [/^\/settings/, '工作区设置'],
  [/^\/billing\/success/, '支付确认'],
  [/^\/app/, '概览 · MyProduct'],
  [/^\/dev\/realtime/, '实时连接（调试） · MyProduct'],
  [/^\/invitations/, '我的邀请 · MyProduct'],
  [/^\/login$/, '登录 · MyProduct'],
  [/^\/register$/, '创建账号 · MyProduct'],
  [/^\/forgot-password$/, '找回密码 · MyProduct'],
  [/^\/reset-password$/, '设置新密码 · MyProduct'],
  [/^\/verify-email$/, '邮箱验证 · MyProduct'],
];

function DocumentTitle() {
  const { pathname } = useLocation();
  useEffect(() => {
    const hit = PAGE_TITLES.find(([re]) => re.test(pathname));
    if (hit) document.title = hit[1];
  }, [pathname]);
  return null;
}

function WsSync() {
  const { current } = useWorkspace();
  useEffect(() => {
    setWsWorkspace(current?.id ?? null);
  }, [current?.id]);
  return null;
}

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <PloykitAppProviders>
      <WsSync />
      {/* B-orders-7：路由级标题（TanStack 迁移后经 assembler 的 wrapInRouter
          挂在 Router 上下文之内——useLocation 依赖 router context）。 */}
      <DocumentTitle />
      {children}
    </PloykitAppProviders>
  );
}
