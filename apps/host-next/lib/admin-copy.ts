import { createHostTranslator, readHostMessageValue, type TranslateOptions } from './host-i18n';
import type { SupportedLanguage } from './i18n';

type CopyFn<TArgs extends readonly unknown[]> = (...args: TArgs) => string;

export interface AdminOverviewCopy {
  title: string;
  subtitle: string;
  risks: {
    dataTitle: string;
    dataDetail: string;
    dataAction: string;
    needsReview: string;
    deliveryTitle: string;
    deliveryDetail: CopyFn<[count: number]>;
    deliveryAction: string;
    blocked: string;
    webhookTitle: string;
    webhookDetail: CopyFn<[count: number]>;
    webhookAction: string;
    accessTitle: string;
    accessDetail: CopyFn<[count: number]>;
    accessAction: string;
    readyTitle: string;
    readyDetail: string;
    readyAction: string;
    healthy: string;
  };
  activity: {
    user: string;
    notStarted: string;
  };
  counters: {
    catalog: string;
    moduleStates: string;
    outbox: string;
    records: string;
    audit: string;
    deliveries: string;
    notificationLogs: string;
  };
  services: {
    database: string;
    memoryMode: string;
    durable: string;
    localOnly: string;
    runtimeReconcile: string;
    queued: CopyFn<[count: number]>;
    dead: CopyFn<[count: number]>;
    manual: string;
    authentication: string;
    active: CopyFn<[active: number, total: number]>;
    admins: CopyFn<[count: number]>;
    apiGateway: string;
    blocked: CopyFn<[count: number]>;
    routing: string;
    outboxStore: string;
    webhookReceipts: string;
    receipts: CopyFn<[count: number]>;
    failed: CopyFn<[count: number]>;
  };
  stat: {
    totalUsers: string;
    activeNew: CopyFn<[active: number, fresh: number]>;
    activeUsers: string;
    suspendedUsers: string;
    suspendedHelper: CopyFn<[count: number]>;
    roleCoverage: string;
    roleCoverageHelper: CopyFn<[roles: number, capabilities: number]>;
    needsReview: string;
    healthy: string;
  };
  today: {
    title: string;
    description: string;
    activeUsers: string;
    notifications: string;
    roles: string;
    adminUsers: string;
  };
}

export interface AdminSettingsCopy {
  title: string;
  subtitle: string;
}

export interface AdminDevConsoleCopy {
  title: string;
  subtitle: string;
  openModule: string;
}

export interface AdminModulesCopy {
  title: string;
  subtitle: string;
}

export interface AdminModuleDetailCopy {
  detailTitle: string;
  subtitle: string;
  missingTitle: string;
  missingBody: string;
  productShapeTitle: string;
  productShapeDescription: string;
  productShapeEmptyTitle: string;
  productShapeEmptyBody: string;
}

export interface AdminUsersCopy {
  title: string;
  subtitle: string;
  totalUsers: string;
  visible: CopyFn<[count: number]>;
  active: string;
  activeHelper: CopyFn<[percent: number]>;
  suspended: string;
  suspendedHelper: string;
  admins: string;
  adminsHelper: string;
  reviewTitle: string;
  reviewDescription: string;
  suspendedTitle: string;
  suspendedDescription: CopyFn<[count: number]>;
  reviewUsers: string;
  pendingTitle: string;
  pendingDescription: CopyFn<[count: number]>;
  filterPending: string;
  directoryTitle: string;
  directoryDescription: string;
  searchPlaceholder: string;
  filterLabel: string;
  columns: string[];
  openDetail: string;
  empty: string;
  mobileOpen: string;
}

export interface AdminUserDetailCopy {
  title: string;
  subtitle: string;
  role: string;
  status: string;
  workspace: string;
  sessions: string;
  currentState: string;
  auditRecords: CopyFn<[count: number]>;
  actionsTitle: string;
  actionsDescription: string;
  accountStatus: string;
  accountStatusHint: string;
  reason: string;
  updateStatus: string;
  updateStatusConfirm: CopyFn<[email?: string]>;
  hostRole: string;
  hostRoleHint: string;
  updateRole: string;
  updateRoleConfirm: CopyFn<[email?: string]>;
  passwordReset: string;
  passwordResetHint: string;
  sendReset: string;
  sendResetConfirm: CopyFn<[email?: string]>;
  diagnosticsTitle: string;
  diagnosticsDescription: string;
  activeSessions: string;
  activeSessionsDescription: string;
  sessionColumns: string[];
  revoke: string;
  revokeConfirm: CopyFn<[email: string | undefined, id: string]>;
  noSessions: string;
  auditTitle: string;
  auditDescription: string;
  noAudit: string;
  metadata: string;
  metadataDescription: string;
  drawerTitle: string;
  copyId: string;
  reviewRule: string;
  reviewRuleBody: string;
  missingTitle: string;
  missingBody: string;
  back: string;
}

export interface AdminRbacCopy {
  title: string;
  subtitle: string;
  roles: string;
  systemRoles: CopyFn<[count: number]>;
  capabilities: string;
  assigned: CopyFn<[count: number]>;
  modulePermissions: string;
  customRoles: string;
  productAccess: string;
  roleManagementTitle: string;
  roleManagementDescription: string;
  roleColumns: string[];
  systemRole: string;
  customRole: string;
  coverageEvidenceTitle: string;
  coverageEvidenceDescription: string;
  panelTitle: string;
  panelDescription: string;
  systemRolesLabel: string;
  hostAssignments: string;
  moduleAssignments: string;
  roleSnapshot: string;
  roleSnapshotDescription: CopyFn<[total: number, system: number]>;
  roleSnapshotMeta: CopyFn<[host: number, module: number]>;
  hostInventory: string;
  hostInventoryDescription: CopyFn<[count: number]>;
  currentMatrix: string;
  moduleInventory: string;
  moduleInventoryDescription: CopyFn<[count: number]>;
  empty: string;
  hostCoverage: string;
  moduleCoverage: string;
}

export interface AdminServiceConnectionsCopy {
  title: string;
  subtitle: string;
}

export interface AdminRunsCopy {
  title: string;
  subtitle: string;
  openRun: string;
}

export interface AdminRunDetailCopy {
  title: string;
  subtitle: string;
  missingTitle: string;
  missingBody: string;
}

export interface AdminWebhooksCopy {
  title: string;
  subtitle: string;
}

export interface AdminWebhookDetailCopy {
  title: string;
  subtitle: string;
  missingTitle: string;
  missingBody: string;
}

export interface AdminBillingCopy {
  title: string;
  subtitle: string;
  creditReservationsDescription: string;
  redeemCodeLifecycleDescription: string;
  redemptionRecord: string;
  attemptRecord: string;
  machineApiKeysDescription: string;
  riskFactsDescription: string;
}

export interface AdminRevenueCopy {
  title: string;
  subtitle: string;
}

export interface AdminEntitlementsCopy {
  title: string;
  subtitle: string;
}

export interface AdminUsageCopy {
  title: string;
  subtitle: string;
}

export interface AdminAnalyticsCopy {
  title: string;
  subtitle: string;
}

export interface AdminFilesCopy {
  title: string;
  subtitle: string;
}

export interface AdminFileDetailCopy {
  title: string;
  subtitle: string;
  missingTitle: string;
  missingBody: string;
}

export interface AdminAuditCopy {
  title: string;
  subtitle: string;
  exportCsv: string;
  exportJson: string;
}

export interface AdminSearchCopy {
  title: string;
  subtitle: string;
}

function makeTranslator(lang: SupportedLanguage, namespace: string) {
  return createHostTranslator(lang, namespace);
}

function translateNumberedMessage(
  t: ReturnType<typeof makeTranslator>,
  key: string,
  options?: TranslateOptions
): string {
  return t(key, options);
}

function readCopyValue<T>(lang: SupportedLanguage, key: string): T {
  return readHostMessageValue<T>(lang, key);
}

export function getAdminOverviewCopy(lang: SupportedLanguage): AdminOverviewCopy {
  const t = makeTranslator(lang, 'admin.overview');
  return {
    title: t('title'),
    subtitle: t('subtitle'),
    risks: {
      dataTitle: t('risks.dataTitle'),
      dataDetail: t('risks.dataDetail'),
      dataAction: t('risks.dataAction'),
      needsReview: t('risks.needsReview'),
      deliveryTitle: t('risks.deliveryTitle'),
      deliveryDetail: (count) =>
        translateNumberedMessage(t, 'risks.deliveryDetail', { values: { count } }),
      deliveryAction: t('risks.deliveryAction'),
      blocked: t('risks.blocked'),
      webhookTitle: t('risks.webhookTitle'),
      webhookDetail: (count) =>
        translateNumberedMessage(t, 'risks.webhookDetail', { values: { count } }),
      webhookAction: t('risks.webhookAction'),
      accessTitle: t('risks.accessTitle'),
      accessDetail: (count) =>
        translateNumberedMessage(t, 'risks.accessDetail', { values: { count } }),
      accessAction: t('risks.accessAction'),
      readyTitle: t('risks.readyTitle'),
      readyDetail: t('risks.readyDetail'),
      readyAction: t('risks.readyAction'),
      healthy: t('risks.healthy'),
    },
    activity: {
      user: t('activity.user'),
      notStarted: t('activity.notStarted'),
    },
    counters: {
      catalog: t('counters.catalog'),
      moduleStates: t('counters.moduleStates'),
      outbox: t('counters.outbox'),
      records: t('counters.records'),
      audit: t('counters.audit'),
      deliveries: t('counters.deliveries'),
      notificationLogs: t('counters.notificationLogs'),
    },
    services: {
      database: t('services.database'),
      memoryMode: t('services.memoryMode'),
      durable: t('services.durable'),
      localOnly: t('services.localOnly'),
      runtimeReconcile: t('services.runtimeReconcile'),
      queued: (count) => t('services.queued', { values: { count } }),
      dead: (count) => t('services.dead', { values: { count } }),
      manual: t('services.manual'),
      authentication: t('services.authentication'),
      active: (active, total) => t('services.active', { values: { active, total } }),
      admins: (count) => t('services.admins', { values: { count } }),
      apiGateway: t('services.apiGateway'),
      blocked: (count) => t('services.blocked', { values: { count } }),
      routing: t('services.routing'),
      outboxStore: t('services.outboxStore'),
      webhookReceipts: t('services.webhookReceipts'),
      receipts: (count) => t('services.receipts', { values: { count } }),
      failed: (count) => t('services.failed', { values: { count } }),
    },
    stat: {
      totalUsers: t('stat.totalUsers'),
      activeNew: (active, fresh) => t('stat.activeNew', { values: { active, fresh } }),
      activeUsers: t('stat.activeUsers'),
      suspendedUsers: t('stat.suspendedUsers'),
      suspendedHelper: (count) => t('stat.suspendedHelper', { values: { count } }),
      roleCoverage: t('stat.roleCoverage'),
      roleCoverageHelper: (roles, capabilities) =>
        t('stat.roleCoverageHelper', { values: { roles, capabilities } }),
      needsReview: t('stat.needsReview'),
      healthy: t('stat.healthy'),
    },
    today: {
      title: t('today.title'),
      description: t('today.description'),
      activeUsers: t('today.activeUsers'),
      notifications: t('today.notifications'),
      roles: t('today.roles'),
      adminUsers: t('today.adminUsers'),
    },
  };
}

export function getAdminSettingsCopy(lang: SupportedLanguage): AdminSettingsCopy {
  const t = makeTranslator(lang, 'admin.settings');
  return {
    title: t('title'),
    subtitle: t('subtitle'),
  };
}

export function getAdminDevConsoleCopy(lang: SupportedLanguage): AdminDevConsoleCopy {
  const t = makeTranslator(lang, 'admin.devConsole');
  return {
    title: t('title'),
    subtitle: t('subtitle'),
    openModule: t('openModule'),
  };
}

export function getAdminModulesCopy(lang: SupportedLanguage): AdminModulesCopy {
  const t = makeTranslator(lang, 'admin.modules');
  return {
    title: t('title'),
    subtitle: t('subtitle'),
  };
}

export function getAdminModuleDetailCopy(lang: SupportedLanguage): AdminModuleDetailCopy {
  const t = makeTranslator(lang, 'admin.modules.detail');
  return {
    detailTitle: t('detailTitle'),
    subtitle: t('subtitle'),
    missingTitle: t('missingTitle'),
    missingBody: t('missingBody'),
    productShapeTitle: t('productShapeTitle'),
    productShapeDescription: t('productShapeDescription'),
    productShapeEmptyTitle: t('productShapeEmptyTitle'),
    productShapeEmptyBody: t('productShapeEmptyBody'),
  };
}

export function getAdminUsersCopy(lang: SupportedLanguage): AdminUsersCopy {
  const t = makeTranslator(lang, 'admin.identity.users');
  return {
    title: t('title'),
    subtitle: t('subtitle'),
    totalUsers: t('totalUsers'),
    visible: (count) => t('visible', { values: { count } }),
    active: t('active'),
    activeHelper: (percent) => t('activeHelper', { values: { percent } }),
    suspended: t('suspended'),
    suspendedHelper: t('suspendedHelper'),
    admins: t('admins'),
    adminsHelper: t('adminsHelper'),
    reviewTitle: t('reviewTitle'),
    reviewDescription: t('reviewDescription'),
    suspendedTitle: t('suspendedTitle'),
    suspendedDescription: (count) => t('suspendedDescription', { values: { count } }),
    reviewUsers: t('reviewUsers'),
    pendingTitle: t('pendingTitle'),
    pendingDescription: (count) => t('pendingDescription', { values: { count } }),
    filterPending: t('filterPending'),
    directoryTitle: t('directoryTitle'),
    directoryDescription: t('directoryDescription'),
    searchPlaceholder: t('searchPlaceholder'),
    filterLabel: t('filterLabel'),
    columns: readCopyValue<string[]>(lang, 'admin.identity.users.columns'),
    openDetail: t('openDetail'),
    empty: t('empty'),
    mobileOpen: t('mobileOpen'),
  };
}

export function getAdminUserDetailCopy(lang: SupportedLanguage): AdminUserDetailCopy {
  const t = makeTranslator(lang, 'admin.identity.userDetail');
  const target = (email?: string) => email ?? t('defaultUserTarget');
  return {
    title: t('title'),
    subtitle: t('subtitle'),
    role: t('role'),
    status: t('status'),
    workspace: t('workspace'),
    sessions: t('sessions'),
    currentState: t('currentState'),
    auditRecords: (count) => t('auditRecords', { values: { count } }),
    actionsTitle: t('actionsTitle'),
    actionsDescription: t('actionsDescription'),
    accountStatus: t('accountStatus'),
    accountStatusHint: t('accountStatusHint'),
    reason: t('reason'),
    updateStatus: t('updateStatus'),
    updateStatusConfirm: (email) => t('updateStatusConfirm', { values: { target: target(email) } }),
    hostRole: t('hostRole'),
    hostRoleHint: t('hostRoleHint'),
    updateRole: t('updateRole'),
    updateRoleConfirm: (email) => t('updateRoleConfirm', { values: { target: target(email) } }),
    passwordReset: t('passwordReset'),
    passwordResetHint: t('passwordResetHint'),
    sendReset: t('sendReset'),
    sendResetConfirm: (email) => t('sendResetConfirm', { values: { target: target(email) } }),
    diagnosticsTitle: t('diagnosticsTitle'),
    diagnosticsDescription: t('diagnosticsDescription'),
    activeSessions: t('activeSessions'),
    activeSessionsDescription: t('activeSessionsDescription'),
    sessionColumns: readCopyValue<string[]>(lang, 'admin.identity.userDetail.sessionColumns'),
    revoke: t('revoke'),
    revokeConfirm: (email, id) => t('revokeConfirm', { values: { target: target(email), id } }),
    noSessions: t('noSessions'),
    auditTitle: t('auditTitle'),
    auditDescription: t('auditDescription'),
    noAudit: t('noAudit'),
    metadata: t('metadata'),
    metadataDescription: t('metadataDescription'),
    drawerTitle: t('drawerTitle'),
    copyId: t('copyId'),
    reviewRule: t('reviewRule'),
    reviewRuleBody: t('reviewRuleBody'),
    missingTitle: t('missingTitle'),
    missingBody: t('missingBody'),
    back: t('back'),
  };
}

export function getAdminRbacCopy(lang: SupportedLanguage): AdminRbacCopy {
  const t = makeTranslator(lang, 'admin.identity.rbac');
  return {
    title: t('title'),
    subtitle: t('subtitle'),
    roles: t('roles'),
    systemRoles: (count) => t('systemRoles', { values: { count } }),
    capabilities: t('capabilities'),
    assigned: (count) => t('assigned', { values: { count } }),
    modulePermissions: t('modulePermissions'),
    customRoles: t('customRoles'),
    productAccess: t('productAccess'),
    roleManagementTitle: t('roleManagementTitle'),
    roleManagementDescription: t('roleManagementDescription'),
    roleColumns: readCopyValue<string[]>(lang, 'admin.identity.rbac.roleColumns'),
    systemRole: t('systemRole'),
    customRole: t('customRole'),
    coverageEvidenceTitle: t('coverageEvidenceTitle'),
    coverageEvidenceDescription: t('coverageEvidenceDescription'),
    panelTitle: t('panelTitle'),
    panelDescription: t('panelDescription'),
    systemRolesLabel: t('systemRolesLabel'),
    hostAssignments: t('hostAssignments'),
    moduleAssignments: t('moduleAssignments'),
    roleSnapshot: t('roleSnapshot'),
    roleSnapshotDescription: (total, system) =>
      t('roleSnapshotDescription', { values: { total, system, custom: total - system } }),
    roleSnapshotMeta: (host, module) => t('roleSnapshotMeta', { values: { host, module } }),
    hostInventory: t('hostInventory'),
    hostInventoryDescription: (count) => t('hostInventoryDescription', { values: { count } }),
    currentMatrix: t('currentMatrix'),
    moduleInventory: t('moduleInventory'),
    moduleInventoryDescription: (count) => t('moduleInventoryDescription', { values: { count } }),
    empty: t('empty'),
    hostCoverage: t('hostCoverage'),
    moduleCoverage: t('moduleCoverage'),
  };
}

export function getAdminServiceConnectionsCopy(lang: SupportedLanguage): AdminServiceConnectionsCopy {
  const t = makeTranslator(lang, 'admin.operations.serviceConnections');
  return {
    title: t('title'),
    subtitle: t('subtitle'),
  };
}

export function getAdminRunsCopy(lang: SupportedLanguage): AdminRunsCopy {
  const t = makeTranslator(lang, 'admin.operations.runs');
  return {
    title: t('title'),
    subtitle: t('subtitle'),
    openRun: t('openRun'),
  };
}

export function getAdminRunDetailCopy(lang: SupportedLanguage): AdminRunDetailCopy {
  const t = makeTranslator(lang, 'admin.operations.runDetail');
  return {
    title: t('title'),
    subtitle: t('subtitle'),
    missingTitle: t('missingTitle'),
    missingBody: t('missingBody'),
  };
}

export function getAdminWebhooksCopy(lang: SupportedLanguage): AdminWebhooksCopy {
  const t = makeTranslator(lang, 'admin.operations.webhooks');
  return {
    title: t('title'),
    subtitle: t('subtitle'),
  };
}

export function getAdminWebhookDetailCopy(lang: SupportedLanguage): AdminWebhookDetailCopy {
  const t = makeTranslator(lang, 'admin.operations.webhookDetail');
  return {
    title: t('title'),
    subtitle: t('subtitle'),
    missingTitle: t('missingTitle'),
    missingBody: t('missingBody'),
  };
}

export function getAdminBillingCopy(lang: SupportedLanguage): AdminBillingCopy {
  const t = makeTranslator(lang, 'admin.commerce.billing');
  return {
    title: t('title'),
    subtitle: t('subtitle'),
    creditReservationsDescription: t('creditReservationsDescription'),
    redeemCodeLifecycleDescription: t('redeemCodeLifecycleDescription'),
    redemptionRecord: t('redemptionRecord'),
    attemptRecord: t('attemptRecord'),
    machineApiKeysDescription: t('machineApiKeysDescription'),
    riskFactsDescription: t('riskFactsDescription'),
  };
}

export function getAdminRevenueCopy(lang: SupportedLanguage): AdminRevenueCopy {
  const t = makeTranslator(lang, 'admin.commerce.revenue');
  return {
    title: t('title'),
    subtitle: t('subtitle'),
  };
}

export function getAdminEntitlementsCopy(lang: SupportedLanguage): AdminEntitlementsCopy {
  const t = makeTranslator(lang, 'admin.commerce.entitlements');
  return {
    title: t('title'),
    subtitle: t('subtitle'),
  };
}

export function getAdminUsageCopy(lang: SupportedLanguage): AdminUsageCopy {
  const t = makeTranslator(lang, 'admin.data.usage');
  return {
    title: t('title'),
    subtitle: t('subtitle'),
  };
}

export function getAdminAnalyticsCopy(lang: SupportedLanguage): AdminAnalyticsCopy {
  const t = makeTranslator(lang, 'admin.data.analytics');
  return {
    title: t('title'),
    subtitle: t('subtitle'),
  };
}

export function getAdminFilesCopy(lang: SupportedLanguage): AdminFilesCopy {
  const t = makeTranslator(lang, 'admin.data.files');
  return {
    title: t('title'),
    subtitle: t('subtitle'),
  };
}

export function getAdminFileDetailCopy(lang: SupportedLanguage): AdminFileDetailCopy {
  const t = makeTranslator(lang, 'admin.data.fileDetail');
  return {
    title: t('title'),
    subtitle: t('subtitle'),
    missingTitle: t('missingTitle'),
    missingBody: t('missingBody'),
  };
}

export function getAdminAuditCopy(lang: SupportedLanguage): AdminAuditCopy {
  const t = makeTranslator(lang, 'admin.governance.audit');
  return {
    title: t('title'),
    subtitle: t('subtitle'),
    exportCsv: t('exportCsv'),
    exportJson: t('exportJson'),
  };
}

export function getAdminSearchCopy(lang: SupportedLanguage): AdminSearchCopy {
  const t = makeTranslator(lang, 'admin.governance.search');
  return {
    title: t('title'),
    subtitle: t('subtitle'),
  };
}
