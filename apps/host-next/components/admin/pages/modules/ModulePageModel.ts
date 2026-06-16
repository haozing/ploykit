import { adminInlineText } from '@host/lib/admin-inline-i18n';
import { type SupportedLanguage } from '@host/lib/i18n';
import type { AdminOperationsViewSnapshot } from '@host/lib/admin-module-operations';

export type AdminModuleListItem = AdminOperationsViewSnapshot['modules'][number];

export const moduleProductAreaDetails: Record<string, string> = {
  Commerce: 'Billing, checkout, entitlement, SKU, order, and revenue-facing product capability.',
  'Public site':
    'Public routes, marketing/content pages, SEO aliases, and unauthenticated product surfaces.',
  'AI workspace': 'AI, RAG, indexing, retrieval, and assistant-facing workflow capability.',
  Automation: 'Background jobs, webhooks, events, queues, and integration workflow capability.',
  'Data operations':
    'Structured data tables, documents, CRUD surfaces, and operator data workflows.',
  'Back office': 'Admin or dashboard pages that extend the product operations console.',
  Platform: 'General host extension or foundation capability.',
};

export function getModuleProductArea(module: AdminModuleListItem) {
  const id = module.id.toLowerCase();
  if (id.includes('billing') || id.includes('shop') || id.includes('commerce')) {
    return 'Commerce';
  }
  if (id.includes('cms') || id.includes('site') || module.capabilities.siteRoutes > 0) {
    return 'Public site';
  }
  if (id.includes('ai') || id.includes('rag')) {
    return 'AI workspace';
  }
  if (module.capabilities.jobs > 0 || module.capabilities.webhooks > 0) {
    return 'Automation';
  }
  if (module.capabilities.dataTables > 0 || module.capabilities.dataDocuments > 0) {
    return 'Data operations';
  }
  if (module.capabilities.adminRoutes > 0 || module.capabilities.dashboardRoutes > 0) {
    return 'Back office';
  }
  return 'Platform';
}

export function getModuleCategory(module: AdminModuleListItem) {
  if (module.required) {
    return 'Required foundation';
  }
  if (
    module.runtimeState === 'blocked' ||
    module.runtimeState === 'error' ||
    module.health.errors > 0
  ) {
    return 'Needs operator review';
  }
  if (module.status === 'enabled') {
    return 'Enabled product module';
  }
  if (!module.installed) {
    return 'Available catalog item';
  }
  return 'Installed module';
}

export function getModuleCapabilityPhrases(module: AdminModuleListItem) {
  const phrases = [
    module.capabilities.siteRoutes > 0
      ? `Public site surface x ${module.capabilities.siteRoutes}`
      : null,
    module.capabilities.dashboardRoutes > 0
      ? `Workspace dashboard route x ${module.capabilities.dashboardRoutes}`
      : null,
    module.capabilities.adminRoutes > 0
      ? `Admin operations route x ${module.capabilities.adminRoutes}`
      : null,
    module.capabilities.apiRoutes > 0
      ? `Module API endpoint x ${module.capabilities.apiRoutes}`
      : null,
    module.capabilities.actions > 0 ? `Operator action x ${module.capabilities.actions}` : null,
    module.capabilities.jobs > 0 ? `Background workflow x ${module.capabilities.jobs}` : null,
    module.capabilities.events > 0 ? `Event integration x ${module.capabilities.events}` : null,
    module.capabilities.webhooks > 0
      ? `Webhook entrypoint x ${module.capabilities.webhooks}`
      : null,
    module.capabilities.dataTables > 0 || module.capabilities.dataDocuments > 0
      ? `Data model x ${module.capabilities.dataTables + module.capabilities.dataDocuments}`
      : null,
    module.permissions.length > 0 ? `Permission boundary x ${module.permissions.length}` : null,
  ].filter((item): item is string => Boolean(item));
  return phrases.length > 0 ? phrases : ['Metadata-only extension'];
}

export function getModuleReleaseImpact(lang: SupportedLanguage, module: AdminModuleListItem) {
  if (
    module.runtimeState === 'blocked' ||
    module.runtimeState === 'error' ||
    module.health.errors > 0
  ) {
    return {
      label: adminInlineText(lang, 'blocks_release_57547c33'),
      detail: adminInlineText(
        lang,
        'fix_lifecycle_resource_binding_or_doctor_errors_befo_b7176e93'
      ),
      status: 'blocked',
      tone: 'danger' as const,
    };
  }
  if (module.health.warnings > 0) {
    return {
      label: adminInlineText(lang, 'needs_review_e7a3a9f7'),
      detail: adminInlineText(
        lang,
        'warnings_should_be_resolved_or_accepted_before_produ_da84cf4e'
      ),
      status: 'review',
      tone: 'warning' as const,
    };
  }
  if (module.required) {
    return {
      label: adminInlineText(lang, 'foundation_9a1d6e6c'),
      detail: adminInlineText(
        lang,
        'required_module_treat_lifecycle_changes_as_product_i_15c2b333'
      ),
      status: 'guarded',
      tone: 'info' as const,
    };
  }
  if (module.status === 'enabled') {
    return {
      label: adminInlineText(lang, 'no_blocking_evidence_c879beea'),
      detail: adminInlineText(
        lang,
        'enabled_and_clear_in_current_runtime_health_evidence_8a3f05b2'
      ),
      status: 'ready',
      tone: 'success' as const,
    };
  }
  return {
    label: adminInlineText(lang, 'not_in_release_path_c82db65f'),
    detail: adminInlineText(lang, 'install_or_enable_only_when_this_product_area_is_nee_07e0154a'),
    status: 'optional',
    tone: 'neutral' as const,
  };
}

export function getModuleOperatorNextAction(lang: SupportedLanguage, module: AdminModuleListItem) {
  if (!module.installed || module.status === 'not_installed') {
    return adminInlineText(lang, 'install_before_using_contributed_pages_or_apis_d688f7ad');
  }
  if (module.runtimeState === 'blocked') {
    return adminInlineText(lang, 'review_missing_resources_and_lifecycle_state_f7287c70');
  }
  if (module.runtimeState === 'error' || module.health.errors > 0) {
    return adminInlineText(lang, 'open_diagnostics_and_fix_doctor_errors_2c0e0899');
  }
  if (module.health.warnings > 0) {
    return adminInlineText(lang, 'review_warnings_before_rc_evidence_b91e8fcb');
  }
  if (module.status === 'enabled') {
    return adminInlineText(lang, 'monitor_runtime_activity_and_release_impact_b7c0f12c');
  }
  if (module.status === 'maintenance') {
    return adminInlineText(lang, 'keep_traffic_paused_until_maintenance_evidence_is_cl_5a01f8e7');
  }
  return adminInlineText(lang, 'enable_when_this_product_capability_is_ready_92ed0027');
}
