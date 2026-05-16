export type LabLocale = 'en' | 'zh';

export function resolveLabLocale(locale: string | undefined): LabLocale {
  return locale?.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

export const labMessages = {
  en: {
    marker: {
      homeBefore: 'HOST_CAPABILITY_LAB_HOME_HERO_BEFORE',
      homeAfter: 'HOST_CAPABILITY_LAB_HOME_HERO_AFTER',
      pricingBefore: 'HOST_CAPABILITY_LAB_PRICING_MAIN_BEFORE',
      pricingAfter: 'HOST_CAPABILITY_LAB_PRICING_MAIN_AFTER',
      override: 'HOST_CAPABILITY_LAB_OVERRIDE_RENDERED',
    },
    slots: {
      homeBeforeTitle: 'Plugin slot before the home hero',
      homeBeforeBody:
        'A plugin can add host-governed content before the homepage hero without owning the page.',
      homeAfterTitle: 'Plugin slot after the home hero',
      homeAfterBody:
        'The host keeps routing, layout, locale, navigation, and footer while the plugin contributes this block.',
      pricingBeforeTitle: 'Plugin pricing notice',
      pricingBeforeBody:
        'This block is inserted before the pricing page body through hostPages.slots.',
      pricingAfterTitle: 'Plugin pricing follow-up',
      pricingAfterBody:
        'This block is inserted after the pricing cards without replacing the host page.',
    },
    labPage: {
      eyebrow: 'Host Capability Lab',
      title: 'Real plugin capability probe',
      body:
        'This page is rendered as a plugin route with the host site shell. The probe below writes, updates, queries, transacts, and deletes records through ctx.storage.',
      cards: {
        routeLabel: 'Plugin route',
        shellLabel: 'Host shell',
        shellValue: 'Header and footer enabled',
        storageLabel: 'Storage boundary',
        storageValue: 'Plugin scoped collection',
      },
    },
    about: {
      eyebrow: 'Host page override',
      title: 'About page replaced by a plugin',
      body:
        'This content is not a plugin-owned route. It is mounted into the host about page through hostPages.overrides, while the host shell keeps the site header, footer, language switcher, user menu, canonical metadata, and sitemap policy under host control.',
      evidence: 'Runtime evidence',
      plugin: 'Plugin',
      overridePath: 'Override path',
      shellContract: 'Shell contract',
      shellValue: 'Host header and host footer',
      seoI18n: 'SEO/i18n',
      seoI18nValue: 'Localized SEO metadata from the plugin contract',
    },
    storage: {
      title: 'ctx.storage live probe',
      body:
        'Verifies collection schema, database-filtered query operators, transaction, and soft delete in the real plugin runtime.',
      runAgain: 'Run again',
      running: 'Running...',
      apiOk: 'API OK',
      readByIdOk: 'readById OK',
      deleteOk: 'delete OK',
      transactionOk: 'transaction OK',
      statusFilter: 'Status filter',
      nullFilter: 'Null filter',
      inFilter: 'In filter',
      jsonContains: 'JSON contains',
      latestRecords: 'Latest ready records',
      queryMode: 'Query mode',
      seed: 'seed',
      user: 'user',
      statusLabels: {
        queued: 'queued',
        ready: 'ready',
        archived: 'archived',
      },
      recordTitles: {
        browser: 'Browser probe',
        transaction: 'Transaction probe',
        delete: 'Delete probe',
      },
    },
  },
  zh: {
    marker: {
      homeBefore: 'HOST_CAPABILITY_LAB_HOME_HERO_BEFORE',
      homeAfter: 'HOST_CAPABILITY_LAB_HOME_HERO_AFTER',
      pricingBefore: 'HOST_CAPABILITY_LAB_PRICING_MAIN_BEFORE',
      pricingAfter: 'HOST_CAPABILITY_LAB_PRICING_MAIN_AFTER',
      override: 'HOST_CAPABILITY_LAB_OVERRIDE_RENDERED',
    },
    slots: {
      homeBeforeTitle: '首页 Hero 前插件插槽',
      homeBeforeBody: '插件可以在不接管首页的情况下，把宿主治理的内容插入到首页 Hero 前。',
      homeAfterTitle: '首页 Hero 后插件插槽',
      homeAfterBody: '宿主继续负责路由、布局、语言、导航和页脚，插件只贡献这一块内容。',
      pricingBeforeTitle: '定价页插件提示',
      pricingBeforeBody: '这一块通过 hostPages.slots 插入到定价页主体内容之前。',
      pricingAfterTitle: '定价页插件补充',
      pricingAfterBody: '这一块插入到定价卡片之后，不会替换宿主页面本身。',
    },
    labPage: {
      eyebrow: '宿主能力实验室',
      title: '真实插件能力探针',
      body:
        '这个页面作为插件路由渲染，但复用宿主站点外壳。下面的探针会通过 ctx.storage 写入、更新、查询、事务处理并删除记录。',
      cards: {
        routeLabel: '插件路由',
        shellLabel: '宿主外壳',
        shellValue: '已启用头部和页脚',
        storageLabel: '存储边界',
        storageValue: '插件作用域集合',
      },
    },
    about: {
      eyebrow: '宿主页覆盖',
      title: '关于页已由插件替换',
      body:
        '这不是插件自己的路由，而是通过 hostPages.overrides 挂载到宿主关于页。宿主外壳仍然控制站点头部、页脚、语言切换、用户菜单、canonical 元数据和 sitemap 策略。',
      evidence: '运行时证据',
      plugin: '插件',
      overridePath: '覆盖路径',
      shellContract: '外壳约定',
      shellValue: '宿主头部 + 宿主页脚',
      seoI18n: 'SEO / 多语言',
      seoI18nValue: '插件合同提供本地化 SEO 元数据',
    },
    storage: {
      title: 'ctx.storage 真实探针',
      body: '验证真实插件运行时里的集合 schema、数据库过滤查询、事务和软删除能力。',
      runAgain: '重新运行',
      running: '运行中...',
      apiOk: 'API 正常',
      readByIdOk: 'readById 正常',
      deleteOk: '删除正常',
      transactionOk: '事务正常',
      statusFilter: '状态过滤',
      nullFilter: '空值过滤',
      inFilter: 'IN 过滤',
      jsonContains: 'JSON 包含',
      latestRecords: '最新 ready 记录',
      queryMode: '查询模式',
      seed: '种子',
      user: '用户',
      statusLabels: {
        queued: '排队中',
        ready: '就绪',
        archived: '已归档',
      },
      recordTitles: {
        browser: '浏览器探针',
        transaction: '事务探针',
        delete: '删除探针',
      },
    },
  },
} as const;
