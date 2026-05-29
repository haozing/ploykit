import type { NavIconKey } from '@host/components/layout/types';
import type { SupportedLanguage } from '@host/lib/i18n';
import type { HostCapability } from '@host/lib/rbac';
import type { ModuleHostSession } from '@/lib/module-runtime';
import { createAnonymousModuleHostSession } from '@/lib/module-runtime/host/session';
import { translateModuleMessage } from '@/lib/module-runtime/i18n';
import { getModuleHost } from './module-host';
import { adminHref } from './paths';

export type AdminConsoleAudience = 'business-operations' | 'technical-operations';

export interface AdminConsoleRoute {
  href: string;
  label: Record<SupportedLanguage, string>;
  detail: Record<SupportedLanguage, string>;
  group: Record<SupportedLanguage, string>;
  icon: NavIconKey;
  audience: AdminConsoleAudience;
  order: number;
  capabilities: readonly HostCapability[];
  primaryTask: Record<SupportedLanguage, string>;
  source: 'host';
}

export interface AdminConsoleNavItem {
  href: string;
  label: string;
  detail: string;
  group: string;
  icon: NavIconKey;
  source: 'host' | 'module';
  requires: {
    capabilities: readonly HostCapability[];
    moduleId?: string;
  };
}

const overviewGroup = {
  zh: '概览',
  en: 'Overview',
} as const;

const usersPermissionsGroup = {
  zh: '用户与权限',
  en: 'Users & Permissions',
} as const;

const billingGroup = {
  zh: '计费',
  en: 'Billing',
} as const;

const resourcesGroup = {
  zh: '资源',
  en: 'Resources',
} as const;

const integrationsGroup = {
  zh: '集成',
  en: 'Integrations',
} as const;

const runGroup = {
  zh: '运行',
  en: 'Run',
} as const;

const securityGroup = {
  zh: '安全',
  en: 'Security',
} as const;

const systemGroup = {
  zh: '系统',
  en: 'System',
} as const;

export const ADMIN_CONSOLE_ROUTES: readonly AdminConsoleRoute[] = [
  {
    href: '/admin',
    label: { zh: '运营概览', en: 'Operations Overview' },
    detail: { zh: '用户、收入和风险', en: 'Users, revenue, and risk' },
    group: overviewGroup,
    icon: 'layoutDashboard',
    audience: 'business-operations',
    order: 10,
    capabilities: ['admin.access'],
    primaryTask: {
      zh: '查看当天需要运营处理的用户、收入和风险事项。',
      en: 'Review user, revenue, and risk items that need attention today.',
    },
    source: 'host',
  },
  {
    href: '/admin/users',
    label: { zh: '用户', en: 'Users' },
    detail: { zh: '账号、状态和生命周期', en: 'Accounts, status, and lifecycle' },
    group: usersPermissionsGroup,
    icon: 'users',
    audience: 'business-operations',
    order: 30,
    capabilities: ['admin.users.manage'],
    primaryTask: {
      zh: '查找用户、处理账号状态、查看用户生命周期。',
      en: 'Find users, manage account status, and inspect lifecycle state.',
    },
    source: 'host',
  },
  {
    href: '/admin/rbac',
    label: { zh: '角色', en: 'Roles' },
    detail: { zh: '角色、权限和访问范围', en: 'Roles, permissions, and access scope' },
    group: usersPermissionsGroup,
    icon: 'shieldCheck',
    audience: 'business-operations',
    order: 31,
    capabilities: ['admin.rbac.read'],
    primaryTask: {
      zh: '按角色管理访问范围，并审查权限配置。',
      en: 'Manage access by role and audit permission coverage.',
    },
    source: 'host',
  },
  {
    href: '/admin/entitlements',
    label: { zh: '权益', en: 'Entitlements' },
    detail: { zh: '套餐权益和人工授予', en: 'Plans, grants, and overrides' },
    group: usersPermissionsGroup,
    icon: 'badgeDollarSign',
    audience: 'business-operations',
    order: 32,
    capabilities: ['billing.read', 'billing.write'],
    primaryTask: {
      zh: '确认用户可用权益，处理人工授予和撤销。',
      en: 'Confirm available entitlements and handle manual grants or revokes.',
    },
    source: 'host',
  },
  {
    href: '/admin/revenue',
    label: { zh: '收入', en: 'Revenue' },
    detail: { zh: '订单账本和对账', en: 'Order ledger and reconciliation' },
    group: billingGroup,
    icon: 'circleDollarSign',
    audience: 'business-operations',
    order: 40,
    capabilities: ['billing.read'],
    primaryTask: {
      zh: '核对订单、收入状态和需要跟进的付款事件。',
      en: 'Review orders, revenue state, and payment events that need follow-up.',
    },
    source: 'host',
  },
  {
    href: '/admin/billing',
    label: { zh: '账单', en: 'Billing' },
    detail: { zh: '订单、点数和订阅', en: 'Orders, credits, and subscriptions' },
    group: billingGroup,
    icon: 'creditCard',
    audience: 'business-operations',
    order: 41,
    capabilities: ['billing.read'],
    primaryTask: {
      zh: '处理客户账单、点数、订阅和税务资料。',
      en: 'Handle customer billing, credits, subscriptions, and tax profiles.',
    },
    source: 'host',
  },
  {
    href: '/admin/files',
    label: { zh: '文件', en: 'Files' },
    detail: { zh: '文件目录和存储治理', en: 'File directory and storage governance' },
    group: resourcesGroup,
    icon: 'folderOpen',
    audience: 'business-operations',
    order: 50,
    capabilities: ['files.read'],
    primaryTask: {
      zh: '查找文件、审查归属、处理保留和隔离。',
      en: 'Find files, review ownership, and manage retention or quarantine.',
    },
    source: 'host',
  },
  {
    href: '/admin/analytics',
    label: { zh: '分析', en: 'Analytics' },
    detail: { zh: '增长指标和运营趋势', en: 'Growth metrics and operating trends' },
    group: overviewGroup,
    icon: 'barChart3',
    audience: 'business-operations',
    order: 11,
    capabilities: ['admin.operations.read'],
    primaryTask: {
      zh: '观察增长、活跃度、漏斗和运营健康趋势。',
      en: 'Observe growth, engagement, funnel, and operating health trends.',
    },
    source: 'host',
  },
  {
    href: '/admin/settings',
    label: { zh: '设置', en: 'Settings' },
    detail: { zh: '产品配置和运维开关', en: 'Product settings and operational switches' },
    group: systemGroup,
    icon: 'settings',
    audience: 'business-operations',
    order: 80,
    capabilities: ['admin.settings.read'],
    primaryTask: {
      zh: '维护产品配置，并在需要时进入运维诊断。',
      en: 'Maintain product settings and enter diagnostics when needed.',
    },
    source: 'host',
  },
  {
    href: '/admin/service-connections',
    label: { zh: '服务连接', en: 'Connections' },
    detail: { zh: '供应商、密钥和调用', en: 'Providers, secrets, and calls' },
    group: integrationsGroup,
    icon: 'cable',
    audience: 'technical-operations',
    order: 60,
    capabilities: ['admin.serviceConnections.read'],
    primaryTask: {
      zh: '维护第三方供应商连接、密钥轮换和调用排障。',
      en: 'Maintain provider connections, secret rotation, and call diagnostics.',
    },
    source: 'host',
  },
  {
    href: '/admin/modules',
    label: { zh: '模块运行', en: 'Modules' },
    detail: { zh: '安装、启停和运行状态', en: 'Install, lifecycle, and runtime state' },
    group: runGroup,
    icon: 'package',
    audience: 'technical-operations',
    order: 70,
    capabilities: ['admin.operations.read'],
    primaryTask: {
      zh: '检查模块安装、启停、运行状态和发布风险。',
      en: 'Inspect module installs, lifecycle, runtime state, and release risk.',
    },
    source: 'host',
  },
  {
    href: '/admin/module-dev-console',
    label: { zh: '开发控制台', en: 'Dev Console' },
    detail: { zh: 'Doctor、修复和发布门禁', en: 'Doctor, fixes, and release gates' },
    group: runGroup,
    icon: 'squareTerminal',
    audience: 'technical-operations',
    order: 72,
    capabilities: ['admin.devConsole.read'],
    primaryTask: {
      zh: '运行模块 Doctor、查看诊断、准备修复和发布。',
      en: 'Run module Doctor, inspect diagnostics, and prepare fixes or releases.',
    },
    source: 'host',
  },
  {
    href: '/admin/runs',
    label: { zh: '任务运行', en: 'Runs' },
    detail: { zh: '作业、执行和失败重试', en: 'Jobs, execution, and retries' },
    group: runGroup,
    icon: 'activity',
    audience: 'technical-operations',
    order: 71,
    capabilities: ['admin.operations.read'],
    primaryTask: {
      zh: '排查后台作业、执行队列、失败和重试。',
      en: 'Investigate background jobs, execution queues, failures, and retries.',
    },
    source: 'host',
  },
  {
    href: '/admin/webhooks',
    label: { zh: 'Webhook', en: 'Webhooks' },
    detail: { zh: '回执、重放和签名', en: 'Receipts, replay, and signatures' },
    group: integrationsGroup,
    icon: 'cable',
    audience: 'technical-operations',
    order: 61,
    capabilities: ['admin.webhooks.read'],
    primaryTask: {
      zh: '排查 Webhook 接收、签名校验、重放和死信。',
      en: 'Investigate webhook receipts, signature checks, replay, and dead letters.',
    },
    source: 'host',
  },
  {
    href: '/admin/usage',
    label: { zh: '用量计量', en: 'Usage' },
    detail: { zh: '计量、额度和异常', en: 'Meters, quotas, and anomalies' },
    group: billingGroup,
    icon: 'gauge',
    audience: 'technical-operations',
    order: 42,
    capabilities: ['admin.operations.read'],
    primaryTask: {
      zh: '核对计量账本、额度扣减和异常用量。',
      en: 'Review meter ledgers, quota debits, and usage anomalies.',
    },
    source: 'host',
  },
  {
    href: '/admin/audit',
    label: { zh: '审计', en: 'Audit' },
    detail: { zh: '轨迹、导出和证据', en: 'Trace, export, and evidence' },
    group: securityGroup,
    icon: 'fileText',
    audience: 'technical-operations',
    order: 75,
    capabilities: ['admin.operations.read'],
    primaryTask: {
      zh: '检索审计轨迹、导出证据、定位敏感操作。',
      en: 'Search audit trails, export evidence, and locate sensitive actions.',
    },
    source: 'host',
  },
  {
    href: '/admin/search',
    label: { zh: '高级搜索', en: 'Advanced Search' },
    detail: { zh: '跨对象检索和跳转', en: 'Cross-object lookup and jump' },
    group: overviewGroup,
    icon: 'search',
    audience: 'technical-operations',
    order: 12,
    capabilities: ['admin.access'],
    primaryTask: {
      zh: '跨用户、订单、文件、模块和运维对象检索。',
      en: 'Search across users, orders, files, modules, and technical objects.',
    },
    source: 'host',
  },
] as const;

export const defaultAdminNavItems: readonly AdminConsoleNavItem[] = getAdminNavItems('en');

export function getAdminNavItems(lang: SupportedLanguage): readonly AdminConsoleNavItem[] {
  return [...ADMIN_CONSOLE_ROUTES]
    .sort((left, right) => left.order - right.order)
    .map((route) => ({
      href: route.href,
      label: route.label[lang],
      detail: route.detail[lang],
      group: route.group[lang],
      icon: route.icon,
      source: route.source,
      requires: {
        capabilities: route.capabilities,
      },
    }));
}

function moduleAdminNavigationLabel(
  host: Awaited<ReturnType<typeof getModuleHost>>,
  item: ReturnType<Awaited<ReturnType<typeof getModuleHost>>['resolveNavigation']>[number],
  lang: SupportedLanguage
): string {
  if (item.item.labelKey) {
    return translateModuleMessage(host.runtime, item.moduleId, lang, item.item.labelKey);
  }

  return item.item.fallbackLabel || host.getContract(item.moduleId)?.name || item.moduleId;
}

function moduleAdminNavigationGroupLabel(
  host: Awaited<ReturnType<typeof getModuleHost>>,
  item: ReturnType<Awaited<ReturnType<typeof getModuleHost>>['resolveNavigation']>[number],
  lang: SupportedLanguage
): string {
  if (item.item.groupKey) {
    return translateModuleMessage(host.runtime, item.moduleId, lang, item.item.groupKey);
  }

  return item.item.fallbackGroup ?? moduleAdminNavigationGroup(lang);
}

function moduleAdminNavigationGroup(lang: SupportedLanguage): string {
  return lang === 'zh' ? '模块后台' : 'Module Admin';
}

export async function resolveAdminNavItems(
  lang: SupportedLanguage,
  session: ModuleHostSession = createAnonymousModuleHostSession()
): Promise<readonly AdminConsoleNavItem[]> {
  const hostItems = [...getAdminNavItems(lang)];
  const host = await getModuleHost();
  const known = new Set(hostItems.map((item) => item.href));
  const moduleItems = host
    .resolveNavigation('admin.sidebar', { session })
    .slice()
    .sort((left, right) => (left.item.weight ?? 100) - (right.item.weight ?? 100))
    .map((item): AdminConsoleNavItem => {
      const contract = host.getContract(item.moduleId);
      return {
        href: adminHref(item.item.path),
        label: moduleAdminNavigationLabel(host, item, lang),
        detail: contract?.description ?? item.moduleId,
        group: moduleAdminNavigationGroupLabel(host, item, lang),
        icon: (item.item.icon as NavIconKey | undefined) ?? 'package',
        source: 'module',
        requires: {
          capabilities: ['admin.access'],
          moduleId: item.moduleId,
        },
      };
    })
    .filter((item) => {
      if (known.has(item.href)) {
        return false;
      }
      known.add(item.href);
      return true;
    });

  return [...hostItems, ...moduleItems];
}

export function getAdminConsoleRouteByHref(href: string): AdminConsoleRoute | undefined {
  return ADMIN_CONSOLE_ROUTES.find((route) => route.href === href);
}
