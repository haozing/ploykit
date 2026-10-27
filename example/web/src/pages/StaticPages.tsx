import { useSEO } from '@ploykit/hooks';

/**
 * 静态营销/内容页：定价、文档、关于。
 *
 * 三页保持 `render: 'static'`（构建期预渲染，SEO 首字节不依赖浏览器），但
 * 2026-10-27 GA4 全站统计批撤掉了原先的 `hydrate: 'none'`——页面本身仍是
 * 纯声明式内容，唯一新增的客户端行为是 providers.tsx 的 GA4Boot 注入
 * gtag.js（管理台 ga4_measurement_id 配置后生效）。这是刻意取舍：全站
 * 统计的价值 > 三页各省一份共享入口 JS。
 *
 * 通用判据不变（与 docs/rendering.md §2.1 一致）：关掉 JavaScript 打开这
 * 一页，用户该做的事还能做完 ⇒ 就该是 `hydrate: 'none'`。本页组是判据的
 * 已知例外——"该做的事"里现在包含了"被统计"。
 */

const SHELL = 'mx-auto max-w-3xl px-6 py-16';

/** 内容页的跨页导航。三者互为入口，否则用户到了 /pricing 就出不去。 */
const SITE_NAV = [
  { to: '/', label: '首页' },
  { to: '/pricing', label: '定价' },
  { to: '/docs', label: '文档' },
  { to: '/about', label: '关于' },
];

function PageTitle({ children }: { children: React.ReactNode }) {
  return <h1 className="text-4xl font-bold tracking-tight text-foreground">{children}</h1>;
}

/** 内容页页脚：全站导航 + 版权。渲染成真 <a href>（零 JS 页面靠它导航）。 */
function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-border pt-6 text-sm text-muted-foreground">
      <nav className="flex flex-wrap items-center gap-x-5 gap-y-2">
        {SITE_NAV.map((l) => (
          <a key={l.to} href={l.to} className="hover:text-foreground hover:underline">
            {l.label}
          </a>
        ))}
      </nav>
      <p className="mt-4">© 2026 MyProduct. All rights reserved.</p>
    </footer>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="text-xl font-semibold text-foreground">{title}</h2>
      <div className="mt-3 space-y-3 text-base leading-7 text-muted-foreground">{children}</div>
    </section>
  );
}

/** /pricing —— 定价页。纯静态，零 JS。 */
export function Pricing() {
  useSEO({
    title: '定价 · MyProduct',
    description: 'MyProduct 的定价方案：免费版与专业版的功能对比与价格。',
    canonical: '/pricing',
    ogSiteName: 'MyProduct',
    ogLocale: 'zh_CN',
  });
  const plans = [
    {
      name: '免费版',
      price: '¥0',
      period: '/月',
      features: ['1 个工作区', '最多 5 名成员', '每月 50 个任务', '社区支持'],
      cta: '免费开始',
      highlight: true,
    },
    {
      name: '专业版',
      price: '¥99',
      period: '/月',
      features: ['无限工作区', '无限成员', '无限任务', '优先支持'],
      cta: '联系我们',
      highlight: false,
    },
  ];
  return (
    <main className={SHELL}>
      <PageTitle>定价</PageTitle>
      <p className="mt-3 text-lg text-muted-foreground">
        从免费开始，随时升级。价格按工作区计算，不按人头。
      </p>
      <div className="mt-10 grid gap-6 sm:grid-cols-2">
        {plans.map((p) => (
          <div
            key={p.name}
            className={
              'rounded-xl border p-6 ' +
              (p.highlight ? 'border-primary' : 'border-border')
            }
          >
            <h2 className="text-lg font-semibold text-foreground">{p.name}</h2>
            <p className="mt-2 text-3xl font-bold text-foreground">
              {p.price}
              <span className="text-sm font-normal text-muted-foreground">{p.period}</span>
            </p>
            <ul className="mt-5 space-y-2 text-sm text-muted-foreground">
              {p.features.map((f) => (
                <li key={f}>✓ {f}</li>
              ))}
            </ul>
            <a
              href={p.highlight ? '/register' : '/about'}
              className="mt-6 block rounded-lg border border-input py-2.5 text-center font-medium text-foreground hover:bg-muted"
            >
              {p.cta}
            </a>
          </div>
        ))}
      </div>
      <Section title="常见问题">
        <p>
          <strong className="text-foreground">可以随时取消吗？</strong>{' '}
          可以。取消后当前计费周期内仍可使用，周期结束自动降级到免费版。
        </p>
        <p>
          <strong className="text-foreground">价格会变吗？</strong>{' '}
          已订阅周期内不会。价格调整只影响新订阅。
        </p>
      </Section>
      <SiteFooter />
    </main>
  );
}

/** /docs —— 文档入口页。纯静态，零 JS。 */
export function Docs() {
  useSEO({
    title: '文档 · MyProduct',
    description: 'MyProduct 的快速上手、工作区管理、任务与通知指南。',
    canonical: '/docs',
    ogSiteName: 'MyProduct',
    ogLocale: 'zh_CN',
  });
  return (
    <main className={SHELL}>
      <PageTitle>文档</PageTitle>
      <p className="mt-3 text-lg text-muted-foreground">
        从创建工作区到团队协作，按主题查阅。
      </p>
      <Section title="快速开始">
        <ol className="list-decimal space-y-2 pl-5">
          <li>
            在 <a href="/register" className="text-primary hover:underline">注册页</a>{' '}
            创建账号（或使用第三方登录）。
          </li>
          <li>第一个工作区会自动创建，你也可以再建更多。</li>
          <li>邀请成员：进入「工作区 → 成员」，用邮箱邀请或分享加入码。</li>
          <li>在工作区里创建任务、指派负责人、设定优先级与截止日期。</li>
        </ol>
      </Section>
      <Section title="工作区与权限">
        <p>
          每个工作区有独立成员列表与角色。角色决定能看见哪些设置项：成员只能查看，
          管理员可以邀请与修改配置，所有者还可以转让工作区。
        </p>
        <p>
          权限按细粒度权限键控制，侧栏只显示你当前角色可用的入口——看不到的项不是
          被隐藏，是你确实没有权限。
        </p>
      </Section>
      <Section title="通知">
        <p>
          通知分站内与邮件两个通道，可按类型单独开关。邮件通道未配置 SMTP 时降级为
          仅记录日志（开发环境行为），配置后立即生效。
        </p>
      </Section>
      <Section title="数据导出与删除">
        <p>
          账号与工作区数据可在「设置 → 个人资料」导出。删除账号会清空会话与个人数据，
          工作区内的共享内容按所有权归属处理。
        </p>
      </Section>
      <SiteFooter />
    </main>
  );
}

/** /about —— 关于页。纯静态，零 JS。 */
export function About() {
  useSEO({
    title: '关于 · MyProduct',
    description: 'MyProduct 是什么、为谁而做，以及联系方式。',
    canonical: '/about',
    ogSiteName: 'MyProduct',
    ogLocale: 'zh_CN',
  });
  return (
    <main className={SHELL}>
      <PageTitle>关于 MyProduct</PageTitle>
      <p className="mt-3 text-lg text-muted-foreground">
        一站式任务管理与团队协作工具。
      </p>
      <Section title="我们在做什么">
        <p>
          小团队的麻烦很少是"没有工具"，而是工具太分散：任务在一处、讨论在另一处、
          每个人的进度只有自己知道。MyProduct 把这些收在一处——工作区、任务、成员与
          通知同在一个界面里，不需要在十几个标签页之间搬运上下文。
        </p>
      </Section>
      <Section title="设计原则">
        <p>
          <strong className="text-foreground">默认少而清楚。</strong>{' '}
          能用一行说明的事不做成向导；侧栏只显示你有权限用的东西。
        </p>
        <p>
          <strong className="text-foreground">数据留在你的工作区。</strong>{' '}
          每个工作区的数据互相隔离，权限按角色与细粒度权限键双重控制。
        </p>
        <p>
          <strong className="text-foreground">快。</strong>{' '}
          公开页面（首页、定价、文档、博客）以零 JavaScript 交付，纯内容就是纯内容。
        </p>
      </Section>
      <Section title="联系我们">
        <p>
          产品问题、合作、或想告诉我们哪里不顺：
          <a href="/register" className="text-primary hover:underline"> 注册后在工作区内联系</a>
          ，也可以发邮件到 hello@example.com。
        </p>
      </Section>
      <SiteFooter />
    </main>
  );
}
