import { lazyPage } from '@ploykit/runtime';
import { buildRouteTable } from './routes-table';

/**
 * 客户端路由表。
 *
 * 与 routes.server.tsx 的唯一差异是登录/注册两页的**形状**：这里懒加载，服务端
 * 那里同步导入。原因见 routes-table.tsx 顶部的工厂说明——沙箱不能等 promise，
 * 而客户端不该把这两页塞进首包。
 *
 * 两条入口是各自独立的 bundle（Vite 出客户端、esbuild 出 SSR），所以同一个
 * 工厂配不同的参数不会互相污染。
 */
export default buildRouteTable({
  login: {
    component: lazyPage('Login', () =>
      import('./routes-public').then((m) => ({ default: m.Login })),
    ),
  },
  register: {
    // 组件名与服务端表一致（`RegisterPage`），否则两侧推导出不同 pageId，
    // 内嵌 pageId 兜底会静默失效（见 routes-register.tsx）。
    component: lazyPage('RegisterPage', () =>
      import('./routes-register').then((m) => ({ default: m.RegisterPage })),
    ),
  },
});
