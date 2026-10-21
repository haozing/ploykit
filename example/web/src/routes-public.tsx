import { LoginPage } from '@ploykit/ui';
import type { OAuthProviderOption } from '@ploykit/ui';
import { useSEO, useSiteConfig } from '@ploykit/hooks';

/**
 * 登录页（同步导入，静态预渲染）。
 *
 * 它是获客漏斗的入口，此前以 469 字节空壳返回——访客对着白屏等整个入口
 * chunk 下载执行完才看见表单。预渲染后 HTML 直接带完整表单，首屏不依赖 JS。
 *
 * 本文件只放 Login。低频的找回/重置/验证页在 routes-auth-misc.tsx：若它们与
 * Login 同处一个模块，routes.tsx 对该模块的静态导入会连带把它们拉进首包——
 * Rollup 对"同时被静态与动态导入的模块"不会拆块，整块留在入口。
 */

const OAUTH_LABELS: Record<string, string> = {
  github: 'GitHub',
  google: 'Google',
};

export function Login() {
  useSEO({ title: '登录 · MyProduct', description: '登录你的账号', canonical: '/login' });
  const { data: cfg } = useSiteConfig();
  const oauthProviders: OAuthProviderOption[] = (
    cfg?.oauth_providers ?? []
  ).map((id) => ({
    id,
    label: OAUTH_LABELS[id] ?? id,
  }));
  // flow 默认已是 email-first（前置条件：这条路由是 render:'static' 预渲染，
  // 而 tabs 子模块是动态 import——沙箱不 pump promise，tabs 形态会渲染成
  // Suspense 占位符。email-first 是同步渲染的，与预渲染兼容）。
  return <LoginPage oauthProviders={oauthProviders} />;
}
