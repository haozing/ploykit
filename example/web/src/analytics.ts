/**
 * GA4 统计注入（docs/visitor-analytics.md Route 1 的产品侧接线）。
 *
 * 为什么不放进 useSEO 的 Head / 壳 head：renderx 的标签围栏（template.go
 * denyTags）刻意拒绝 head 指令里的 script——那是服务端多源拼接面，开了就
 * 等于任何源头被污染都能往每页塞可执行内容。产品统计脚本属于浏览器侧的
 * 事，在 React 树里用 DOM 注入即可，框架零改动。
 *
 * Measurement ID 来自公开 /config（ga4_measurement_id，管理台「系统 →
 * 扩展配置」或 env GA4_MEASUREMENT_ID 配置）。ID 本身是公开标识（配了就
 * 会出现在每个页面的加载请求里），不是凭据。
 *
 * SPA 路由切换的 page_view 不需要额外代码：GA4 的增强衡量默认监听
 * history API，TanStack Router 的导航正好走这条路。注意脚本信标看不到
 * 爬虫（不跑 JS），那部分流量看服务端 ploykit_traffic_requests 指标。
 */

/** 模块级单次闸门：SPA 导航/查询刷新反复触发 effect，gtag 只注入一次。 */
let booted = false;

export function bootGA4(measurementId: string) {
  if (typeof window === 'undefined' || booted || !measurementId) return;
  booted = true;

  const w = window as any;
  w.dataLayer = w.dataLayer || [];
  w.gtag = function (...args: unknown[]) {
    w.dataLayer.push(args);
  };
  w.gtag('js', new Date());
  w.gtag('config', measurementId);

  const s = document.createElement('script');
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
  document.head.appendChild(s);
}
