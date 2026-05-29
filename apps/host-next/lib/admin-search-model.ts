import { localizedPath, type SupportedLanguage } from '@host/lib/i18n';
import { adminInlineText } from './admin-inline-i18n';
import type { HostCapability } from './rbac';

export type AdminSearchType = '' | 'user' | 'module' | 'run' | 'outbox' | 'file' | 'order';
export type AdminSearchResultRisk = 'low' | 'medium' | 'high';

export interface AdminSearchResult {
  type: AdminSearchType | string;
  id: string;
  label: string;
  description?: string;
  status?: string;
  updatedAt?: string;
  matchedFields?: string[];
  href?: string;
  capabilityRequired?: HostCapability;
  risk?: AdminSearchResultRisk;
  redacted?: boolean;
}

export interface AdminSearchTypeDefinition {
  value: Exclude<AdminSearchType, ''>;
  label: Record<SupportedLanguage, string>;
  detail: Record<SupportedLanguage, string>;
  capability: HostCapability;
  risk: AdminSearchResultRisk;
}

const searchTypes: readonly AdminSearchTypeDefinition[] = [
  {
    value: 'user',
    label: { zh: '用户', en: 'Users' },
    detail: {
      zh: '身份、账号状态、角色和验证证据',
      en: 'Identity, account status, role, and verification evidence',
    },
    capability: 'admin.users.manage',
    risk: 'medium',
  },
  {
    value: 'module',
    label: { zh: '模块', en: 'Modules' },
    detail: {
      zh: '产品模块能力、生命周期和发布证据',
      en: 'Product module capability, lifecycle, and release evidence',
    },
    capability: 'admin.operations.read',
    risk: 'low',
  },
  {
    value: 'run',
    label: { zh: '运行', en: 'Runs' },
    detail: {
      zh: '后台任务执行和重试证据',
      en: 'Background job execution and retry evidence',
    },
    capability: 'admin.operations.read',
    risk: 'medium',
  },
  {
    value: 'outbox',
    label: { zh: 'Webhook', en: 'Webhooks' },
    detail: {
      zh: 'Webhook 投递、重放和回执证据',
      en: 'Webhook delivery, replay, and receipt evidence',
    },
    capability: 'admin.webhooks.read',
    risk: 'medium',
  },
  {
    value: 'file',
    label: { zh: '文件', en: 'Files' },
    detail: {
      zh: '文件存储、归属、生命周期和隔离证据',
      en: 'File storage, owner, lifecycle, and quarantine evidence',
    },
    capability: 'files.read',
    risk: 'medium',
  },
  {
    value: 'order',
    label: { zh: '订单', en: 'Orders' },
    detail: {
      zh: '商业订单、结算和权益证据',
      en: 'Commercial order, settlement, and entitlement evidence',
    },
    capability: 'billing.read',
    risk: 'medium',
  },
] as const;

const objectFallback = {
  zh: '对象',
  en: 'Objects',
} as const;

export function getAdminSearchTypeOptions(
  lang: SupportedLanguage,
  options: { includeAll?: boolean } = {}
): readonly { value: AdminSearchType; label: string }[] {
  const items = searchTypes.map((item) => ({ value: item.value, label: item.label[lang] }));
  return options.includeAll
    ? [
        { value: '' as AdminSearchType, label: adminInlineText(lang, 'all_objects_80e82396') },
        ...items,
      ]
    : items;
}

export function getAdminSearchTypeLabel(lang: SupportedLanguage, type: string): string {
  return searchTypes.find((item) => item.value === type)?.label[lang] ?? objectFallback[lang];
}

export function getAdminSearchTypeDefinition(type: string): AdminSearchTypeDefinition | undefined {
  return searchTypes.find((item) => item.value === type);
}

export function getAdminSearchTypeCapability(type: string): HostCapability {
  return getAdminSearchTypeDefinition(type)?.capability ?? 'admin.access';
}

export function getAdminSearchTypeRisk(type: string): AdminSearchResultRisk {
  return getAdminSearchTypeDefinition(type)?.risk ?? 'low';
}

export function getAdminSearchResultDetail(
  lang: SupportedLanguage,
  result: AdminSearchResult
): string {
  if (result.description?.trim()) {
    return result.description.trim();
  }
  return (
    searchTypes.find((item) => item.value === result.type)?.detail[lang] ??
    adminInlineText(lang, 'admin_object_23cd6ea7')
  );
}

export function getAdminSearchResultHref(
  lang: SupportedLanguage,
  result: AdminSearchResult
): string {
  if (result.href?.trim()) {
    return result.href.trim();
  }
  const id = encodeURIComponent(result.id);
  switch (result.type) {
    case 'user':
      return localizedPath(lang, `/admin/users/${id}`);
    case 'module':
      return localizedPath(lang, `/admin/modules/${id}`);
    case 'run':
      return localizedPath(lang, `/admin/runs/${id}`);
    case 'outbox':
      return localizedPath(lang, `/admin/webhooks/${id}`);
    case 'file':
      return localizedPath(lang, `/admin/files/${id}`);
    case 'order':
      return `${localizedPath(lang, '/admin/revenue')}?q=${id}`;
    default:
      return `${localizedPath(lang, '/admin/search')}?q=${id}`;
  }
}

export function getAdminSearchQuickCommands(lang: SupportedLanguage): readonly {
  label: string;
  href: string;
  detail: string;
}[] {
  return [
    {
      label: adminInlineText(lang, 'users_b4199bc0'),
      href: localizedPath(lang, '/admin/users'),
      detail: adminInlineText(lang, 'accounts_status_and_lifecycle_1f0bf6fe'),
    },
    {
      label: adminInlineText(lang, 'roles_fe337bda'),
      href: localizedPath(lang, '/admin/rbac'),
      detail: adminInlineText(lang, 'roles_permissions_and_access_scope_6045d921'),
    },
    {
      label: adminInlineText(lang, 'modules_f7409f8e'),
      href: localizedPath(lang, '/admin/modules'),
      detail: adminInlineText(lang, 'install_lifecycle_and_runtime_state_eb3f3b3d'),
    },
    {
      label: adminInlineText(lang, 'runs_ece48ed8'),
      href: localizedPath(lang, '/admin/runs'),
      detail: adminInlineText(lang, 'jobs_execution_and_retries_6c5d2cf3'),
    },
    {
      label: adminInlineText(lang, 'files_a7510f89'),
      href: localizedPath(lang, '/admin/files'),
      detail: adminInlineText(lang, 'file_directory_and_storage_governance_f89e1fd4'),
    },
    {
      label: adminInlineText(lang, 'billing_ed164131'),
      href: localizedPath(lang, '/admin/billing'),
      detail: adminInlineText(lang, 'orders_credits_and_subscriptions_964aaaca'),
    },
    {
      label: adminInlineText(lang, 'audit_3b13ee05'),
      href: localizedPath(lang, '/admin/audit'),
      detail: adminInlineText(lang, 'trace_export_and_evidence_91971a71'),
    },
    {
      label: adminInlineText(lang, 'settings_2ae0756a'),
      href: localizedPath(lang, '/admin/settings'),
      detail: adminInlineText(lang, 'product_settings_and_operational_switches_04e04ed9'),
    },
  ];
}

export function getAdminSearchUiCopy(lang: SupportedLanguage) {
  return {
    trigger: adminInlineText(lang, 'search_users_modules_runs_afdf55f2'),
    openLabel: adminInlineText(lang, 'open_global_search_ebb446c0'),
    closeLabel: adminInlineText(lang, 'close_global_search_f598b929'),
    title: adminInlineText(lang, 'global_search_a2f4b906'),
    description: adminInlineText(
      lang,
      'search_objects_jump_to_domains_and_keep_recent_looku_5cbbf017'
    ),
    placeholder: adminInlineText(lang, 'search_users_modules_files_orders_runs_1cb93ef1'),
    queryLabel: adminInlineText(lang, 'global_search_query_9b3365b8'),
    typeLabel: adminInlineText(lang, 'search_type_3a24c841'),
    submit: adminInlineText(lang, 'search_1875a46d'),
    recent: adminInlineText(lang, 'recent_searches_13d3dfcb'),
    clear: adminInlineText(lang, 'clear_stored_a9a3e08d'),
    paletteTitle: adminInlineText(lang, 'global_command_palette_12256d61'),
    paletteDescription: adminInlineText(
      lang,
      'search_recent_items_jump_to_admin_domains_or_run_a_f_c1f9757a'
    ),
    recentQuick: adminInlineText(lang, 'recent_and_quick_searches_f1433f66'),
    currentPrefix: adminInlineText(lang, 'current_96fd588b'),
    matches: adminInlineText(lang, 'matching_objects_63250a66'),
    quick: adminInlineText(lang, 'quick_jumps_f81fd51d'),
    noMatch: (type: string) =>
      adminInlineText(lang, 'no_value_match_this_query_press_enter_to_open_the_fu_360dbb8b', {
        value1: type ? getAdminSearchTypeLabel(lang, type).toLowerCase() : 'objects',
      }),
  };
}
