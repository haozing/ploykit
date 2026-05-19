/**
 * Schema Index
 *
 * Re-exports all schema definitions from individual modules
 */

// Schema table exports
export * from './core';
export * from './plugins';
export * from './plugin-models';
export * from './plugin-storage';
export * from './plugin-capabilities';
export * from './plugin-platform';
export * from './product-scope';
export * from './rbac';
export * from './entitlement';
export * from './audit-logs';
export * from './billing-extensions';
export * from './files';
export * from './notifications';
export * from './webhook';
export * from './reliability';
export * from './system-settings';

// Type re-exports from individual modules
export type { userMetadata, userPreferences } from './core';

export type { LifecycleMetadata } from './plugins';

export type { PlanFeatures, PlanLimits, UserEntitlementUsageMetrics } from './entitlement';

export type { AuditLogMetadata } from './audit-logs';

// Import tables for schema object assembly
import {
  user,
  userProfiles,
  account,
  session,
  verification,
  userProfilesRelations,
  accountRelations,
  sessionRelations,
} from './core';

import {
  appBundleMembers,
  appBundleMembersRelations,
  appBundles,
  appBundlesRelations,
  appProducts,
  appProductsRelations,
  pluginInstallations,
  pluginSettings,
  pluginLifecycleLogs,
  pluginHostPageOverrides,
  pluginRuntimeSurfaces,
  pluginRuntimeSurfacesRelations,
  pluginSuiteMembers,
  pluginSuiteMembersRelations,
  pluginSuites,
  pluginSuitesRelations,
  pluginInstallationsRelations,
  pluginSettingsRelations,
  pluginLifecycleLogsRelations,
  pluginHostPageOverridesRelations,
} from './plugins';

import { pluginModels, pluginModelsRelations } from './plugin-models';

import {
  pluginArtifacts,
  pluginCollections,
  pluginRagChunks,
  pluginRecordUniqueKeys,
  pluginRecords,
} from './plugin-storage';

import { pluginConfig, pluginSecrets } from './plugin-capabilities';

import {
  hostSecrets,
  pluginApiKeys,
  pluginConnectorCallLogs,
  pluginConnectors,
  pluginFiles,
  pluginServiceConnections,
  pluginResourceBindings,
  pluginRateLimitBuckets,
  pluginRunLogs,
  pluginRunResults,
  pluginRuns,
  pluginRunSteps,
  pluginServiceConnectionLogs,
  workspaceInvitations,
  workspaceMembers,
  workspaces,
} from './plugin-platform';

import { productScopePreferences } from './product-scope';

import { roles, userroles, permissions, rolesRelations, userrolesRelations } from './rbac';

import {
  entitlementPlans,
  userEntitlements,
  usageHistory,
  entitlementPlansRelations,
  userEntitlementsRelations,
  usageHistoryRelations,
} from './entitlement';

import { auditLogs } from './audit-logs';

import { files, filesRelations } from './files';

import { notifications, notificationsRelations } from './notifications';

import { webhookLogs, webhookRetries } from './webhook';

import { orders, creditLogs, ordersRelations, creditLogsRelations } from './billing-extensions';
import {
  billingInvoices,
  billingInvoicesRelations,
  billingPaymentMethods,
  billingPaymentMethodsRelations,
  billingTaxProfiles,
  billingTaxProfilesRelations,
  creditAccounts,
  creditLedgerEntries,
  creditReconciliationRuns,
  digitalEntitlements,
  digitalEntitlementsRelations,
} from './billing-extensions';

import { edgeAccessLogs, eventOutbox, pluginJobRuns } from './reliability';

import { systemSettings } from './system-settings';

/**
 * Complete schema object for Drizzle ORM
 *
 * Used when initializing the database client
 */
export const schema = {
  // Core Tables
  user,
  userProfiles,
  account,
  session,
  verification,

  // Plugin Tables
  appProducts,
  pluginSuites,
  pluginSuiteMembers,
  appBundles,
  appBundleMembers,
  pluginInstallations,
  pluginSettings,
  pluginLifecycleLogs,
  pluginHostPageOverrides,
  pluginRuntimeSurfaces,
  pluginModels,
  pluginCollections,
  pluginRecords,
  pluginRecordUniqueKeys,
  pluginArtifacts,
  pluginRagChunks,
  pluginConfig,
  pluginSecrets,
  workspaces,
  workspaceMembers,
  workspaceInvitations,
  productScopePreferences,
  pluginRuns,
  pluginRunSteps,
  pluginRunLogs,
  pluginRunResults,
  pluginFiles,
  pluginConnectors,
  pluginConnectorCallLogs,
  hostSecrets,
  pluginServiceConnections,
  pluginResourceBindings,
  pluginServiceConnectionLogs,
  pluginApiKeys,
  pluginRateLimitBuckets,

  // RBAC Tables
  roles,
  userroles,
  permissions,

  // Entitlement Tables
  entitlementPlans,
  userEntitlements,
  usageHistory,

  // Billing Extensions Tables
  orders,
  billingInvoices,
  billingPaymentMethods,
  billingTaxProfiles,
  creditLogs,
  creditAccounts,
  creditLedgerEntries,
  creditReconciliationRuns,
  digitalEntitlements,

  // File Storage Tables
  files,

  // Notification Tables
  notifications,

  // Audit Logs Tables
  auditLogs,

  // Webhook Tables
  webhookLogs,
  webhookRetries,

  // Reliability Tables
  eventOutbox,
  pluginJobRuns,
  edgeAccessLogs,
  systemSettings,

  // Relations
  userProfilesRelations,
  accountRelations,
  sessionRelations,
  pluginInstallationsRelations,
  pluginSettingsRelations,
  pluginLifecycleLogsRelations,
  pluginHostPageOverridesRelations,
  appProductsRelations,
  pluginSuitesRelations,
  pluginSuiteMembersRelations,
  appBundlesRelations,
  appBundleMembersRelations,
  pluginRuntimeSurfacesRelations,
  pluginModelsRelations,
  rolesRelations,
  userrolesRelations,
  entitlementPlansRelations,
  userEntitlementsRelations,
  usageHistoryRelations,
  ordersRelations,
  billingInvoicesRelations,
  billingPaymentMethodsRelations,
  billingTaxProfilesRelations,
  creditLogsRelations,
  digitalEntitlementsRelations,
  filesRelations,
  notificationsRelations,
};

// Public model type re-exports
export type {
  Account,
  NewAccount,
  Session,
  NewSession,
  Verification,
  NewVerification,
  userProfile,
  NewuserProfile,
} from './core';

export type {
  AppBundle,
  AppBundleMember,
  AppProduct,
  NewAppBundle,
  NewAppBundleMember,
  NewAppProduct,
  NewPluginRuntimeSurface,
  NewPluginSuite,
  NewPluginSuiteMember,
  PluginInstallation,
  NewPluginInstallation,
  PluginRuntimeSurface,
  PluginSetting,
  NewPluginSetting,
  PluginSuite,
  PluginSuiteMember,
  PluginLifecycleLog,
  NewPluginLifecycleLog,
  PluginHostPageOverride,
  NewPluginHostPageOverride,
} from './plugins';

export type {
  PluginCollection,
  NewPluginCollection,
  PluginRecord,
  NewPluginRecord,
  PluginRecordUniqueKey,
  NewPluginRecordUniqueKey,
  PluginArtifact,
  NewPluginArtifact,
  PluginRagChunk,
  NewPluginRagChunk,
} from './plugin-storage';

export type {
  PluginConfigRecord,
  NewPluginConfigRecord,
  PluginSecretRecord,
  NewPluginSecretRecord,
} from './plugin-capabilities';

export type {
  Workspace,
  NewWorkspace,
  WorkspaceMember,
  NewWorkspaceMember,
  WorkspaceInvitation,
  NewWorkspaceInvitation,
  PluginRun,
  NewPluginRun,
  PluginRunLog,
  NewPluginRunLog,
  PluginRunResult,
  NewPluginRunResult,
  PluginFile,
  NewPluginFile,
  PluginConnector,
  NewPluginConnector,
  PluginConnectorCallLog,
  NewPluginConnectorCallLog,
  HostSecret,
  NewHostSecret,
  PluginServiceConnection,
  NewPluginServiceConnection,
  PluginResourceBinding,
  NewPluginResourceBinding,
  PluginServiceConnectionLog,
  NewPluginServiceConnectionLog,
  PluginApiKey,
  NewPluginApiKey,
  PluginRateLimitBucket,
  NewPluginRateLimitBucket,
} from './plugin-platform';

export type { ProductScopePreference, NewProductScopePreference } from './product-scope';

export type {
  role,
  Newrole,
  userrole,
  Newuserrole,
  PermissionRecord,
  NewPermissionRecord,
} from './rbac';

export type {
  EntitlementPlan,
  NewEntitlementPlan,
  UserEntitlement,
  NewUserEntitlement,
  UsageHistoryRecord,
  NewUsageHistoryRecord,
} from './entitlement';

export type { AuditLog, NewAuditLog } from './audit-logs';

export type { WebhookLog, NewWebhookLog, WebhookRetry, NewWebhookRetry } from './webhook';

export type {
  Order,
  NewOrder,
  BillingInvoice,
  NewBillingInvoice,
  BillingPaymentMethod,
  NewBillingPaymentMethod,
  BillingTaxProfile,
  NewBillingTaxProfile,
  CreditLog,
  NewCreditLog,
  CreditAccount,
  NewCreditAccount,
  CreditLedgerEntry,
  NewCreditLedgerEntry,
  CreditReconciliationRun,
  NewCreditReconciliationRun,
  DigitalEntitlement,
  NewDigitalEntitlement,
} from './billing-extensions';

export type {
  EventOutboxEntry,
  NewEventOutboxEntry,
  PluginJobRunEntry,
  NewPluginJobRunEntry,
  EdgeAccessLogEntry,
  NewEdgeAccessLogEntry,
} from './reliability';

export type { SystemSetting, NewSystemSetting } from './system-settings';
