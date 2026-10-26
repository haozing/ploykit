import { RegisterPage as RegisterPageBase } from '@ploykit/ui';
import { useSEO } from '@ploykit/hooks';

/**
 * 注册页单独成块：它是整站唯一带 zod 校验 schema 的公开页。
 *
 * **pageId 必须由 `displayName` 固定，不能靠函数名。** 理由有两条：
 *
 * 1. `routeTable()` 由组件身份推导 pageId，而服务端表产出的 pageId 会写进
 *    props 脚本的 `data-page-id`。两个入口必须得到同一个值，否则水合梯子的
 *    最后一级（按内嵌 pageId 兜底）对这条路由静默失效。
 * 2. 函数名在这里**不可靠**：本文件导出的 `RegisterPage` 与 @ploykit/ui 内部
 *    同名函数一起进 SSR bundle，esbuild 会把后一个改名（实测变成了
 *    `RegisterPage2`，pageId 随之漂成 `register-page2`）。`displayName` 是
 *    属性赋值，压缩器不会改它，是唯一稳定的锚点。
 */
export function RegisterPage() {
  useSEO({
    title: '创建账号 · MyProduct',
    description: '创建你的 MyProduct 账号',
    canonical: '/register',
    ogSiteName: 'MyProduct',
    ogLocale: 'zh_CN',
  });
  return <RegisterPageBase />;
}

// 客户端表用 lazyPage('RegisterPage', …)，两侧 pageId 靠这个属性对齐。
RegisterPage.displayName = 'RegisterPage';
