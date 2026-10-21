import { buildRouteTable } from './routes-table';
import { Login } from './routes-public';
import { RegisterPage } from './routes-register';

/**
 * 服务端路由表（entry-server → esbuild → QuickJS 沙箱）。
 *
 * 登录/注册在这里**同步导入**并标 `render: 'static'`，与客户端表（routes.tsx，
 * 懒加载）形成刻意的差异。两个理由：
 *
 * 1. 沙箱同步渲染：renderx 在 QuickJS 里同步调用 renderToString，不会 pump
 *    promise 队列。懒加载的页面在预渲染产物里只剩 Suspense 占位符
 *    `<!--$!-->`，等于空页面（断言 A2′ 会拦下构建）。
 * 2. 首屏不依赖 JS：这两页是获客漏斗入口，预渲染后 HTML 直接带完整表单，
 *    访客不必等整个客户端入口下载执行完才看见内容。
 *
 * 客户端不必付这个代价：它懒加载同样的组件，首包因此比"两页都同步导入"小
 * 约 34KB gzip。这正是把路由表做成工厂（而非两份表）的意义——形状差异只
 * 出现在本文件，其余 36 条路由仍然只有一处声明。
 */
export default buildRouteTable({
  login: { component: Login, render: 'static' },
  register: { component: RegisterPage, render: 'static' },
});
