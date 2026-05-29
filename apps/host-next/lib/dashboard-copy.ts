import { createHostTranslator, readHostMessageValue } from './host-i18n';
import type { SupportedLanguage } from './i18n';

type CopyFn<TArgs extends readonly unknown[]> = (...args: TArgs) => string;
type InlineValues = Record<string, string | number | boolean | null | undefined>;

export interface DashboardCopy {
  landing: {
    title: string;
    subtitle: string;
    profile: string;
    workspace: string;
    billing: string;
    tools: string;
    baseEntitlement: string;
    taskColumns: string[];
    notificationColumns: string[];
    orderColumns: string[];
    noTasks: string;
    noNotifications: string;
  };
  workspaces: {
    title: string;
    subtitle: string;
    switchWorkspace: string;
    createWorkspace: string;
    name: string;
    switch: string;
    create: string;
    use: string;
    members: string;
    invite: string;
    email: string;
    role: string;
    sendInvite: string;
    revoke: string;
    revokeConfirm: CopyFn<[email: string]>;
    aliases: string;
    bindDomain: string;
    save: string;
    workspaceColumns: string[];
    memberColumns: string[];
    inviteColumns: string[];
    aliasColumns: string[];
  };
  simple: {
    emptyTitle: string;
    emptyBody: string;
  };
  profile: {
    title: string;
    subtitle: string;
    basic: string;
    displayName: string;
    avatarUrl: string;
    language: string;
    chinese: string;
    timezone: string;
    saveProfile: string;
    password: string;
    currentPassword: string;
    newPassword: string;
    changePassword: string;
    changePasswordConfirm: string;
    notificationPrefs: string;
    inApp: string;
    emailDelivery: string;
    billingEvents: string;
    fileEvents: string;
    workspaceAdminEvents: string;
    savePrefs: string;
    sessionColumns: string[];
    noSessions: string;
    revoke: string;
    revokeSessionConfirm: CopyFn<[id: string]>;
  };
  billing: {
    title: string;
    subtitle: string;
    checkoutNote: string;
    skuColumns: string[];
    subscriptionColumns: string[];
    invoiceColumns: string[];
    paymentColumns: string[];
    taxProfile: string;
    taxNote: string;
    company: string;
    save: string;
    entitlementColumns: string[];
  };
  orders: {
    title: string;
    subtitle: string;
    columns: string[];
  };
  files: {
    title: string;
    subtitle: string;
    uploadFile: string;
    upload: string;
    searchPlaceholder: string;
    columns: string[];
    open: string;
    download: string;
    pending: string;
    archive: string;
    delete: string;
    archiveConfirm: CopyFn<[name: string]>;
    deleteConfirm: CopyFn<[name: string]>;
  };
  credits: {
    title: string;
    subtitle: string;
    columns: string[];
  };
  tasks: {
    title: string;
    subtitle: string;
    columns: string[];
  };
  taskDetail: {
    title: string;
    subtitle: string;
    fieldColumns: string[];
    fields: string[];
    missingTitle: string;
    missingBody: string;
  };
  notifications: {
    title: string;
    subtitle: string;
    readAll: string;
    readAllBody: string;
    readAllConfirm: string;
    markRead: string;
    columns: string[];
    markOneConfirm: CopyFn<[title: string]>;
  };
  notificationSettings: {
    title: string;
    subtitle: string;
    save: string;
  };
  common: {
    noRecords: string;
    filterResult: CopyFn<[visible: number, total: number]>;
  };
}

function readArray(lang: SupportedLanguage, key: string): string[] {
  return readHostMessageValue<string[]>(lang, key);
}

function interpolateInline(message: string, values?: InlineValues): string {
  if (!values) {
    return message;
  }
  return message.replace(/\{([a-zA-Z0-9_.-]+)\}/g, (match, key: string) => {
    const value = values[key];
    return value === undefined || value === null ? match : String(value);
  });
}

export function dashboardInlineText(
  lang: SupportedLanguage,
  key: string,
  values?: InlineValues
): string {
  const catalog = readHostMessageValue<Record<string, string>>(lang, 'dashboard.inline');
  const message = catalog[key] ?? key;
  return interpolateInline(message, values);
}

export function getDashboardCopy(lang: SupportedLanguage): DashboardCopy {
  const t = createHostTranslator(lang, 'dashboard');

  return {
    landing: {
      title: t('landing.title'),
      subtitle: t('landing.subtitle'),
      profile: t('landing.profile'),
      workspace: t('landing.workspace'),
      billing: t('landing.billing'),
      tools: t('landing.tools'),
      baseEntitlement: t('landing.baseEntitlement'),
      taskColumns: readArray(lang, 'dashboard.landing.taskColumns'),
      notificationColumns: readArray(lang, 'dashboard.landing.notificationColumns'),
      orderColumns: readArray(lang, 'dashboard.landing.orderColumns'),
      noTasks: t('landing.noTasks'),
      noNotifications: t('landing.noNotifications'),
    },
    workspaces: {
      title: t('workspaces.title'),
      subtitle: t('workspaces.subtitle'),
      switchWorkspace: t('workspaces.switchWorkspace'),
      createWorkspace: t('workspaces.createWorkspace'),
      name: t('workspaces.name'),
      switch: t('workspaces.switch'),
      create: t('workspaces.create'),
      use: t('workspaces.use'),
      members: t('workspaces.members'),
      invite: t('workspaces.invite'),
      email: t('workspaces.email'),
      role: t('workspaces.role'),
      sendInvite: t('workspaces.sendInvite'),
      revoke: t('workspaces.revoke'),
      revokeConfirm: (email) => t('workspaces.revokeConfirm', { values: { email } }),
      aliases: t('workspaces.aliases'),
      bindDomain: t('workspaces.bindDomain'),
      save: t('workspaces.save'),
      workspaceColumns: readArray(lang, 'dashboard.workspaces.workspaceColumns'),
      memberColumns: readArray(lang, 'dashboard.workspaces.memberColumns'),
      inviteColumns: readArray(lang, 'dashboard.workspaces.inviteColumns'),
      aliasColumns: readArray(lang, 'dashboard.workspaces.aliasColumns'),
    },
    simple: {
      emptyTitle: t('simple.emptyTitle'),
      emptyBody: t('simple.emptyBody'),
    },
    profile: {
      title: t('profile.title'),
      subtitle: t('profile.subtitle'),
      basic: t('profile.basic'),
      displayName: t('profile.displayName'),
      avatarUrl: t('profile.avatarUrl'),
      language: t('profile.language'),
      chinese: t('profile.chinese'),
      timezone: t('profile.timezone'),
      saveProfile: t('profile.saveProfile'),
      password: t('profile.password'),
      currentPassword: t('profile.currentPassword'),
      newPassword: t('profile.newPassword'),
      changePassword: t('profile.changePassword'),
      changePasswordConfirm: t('profile.changePasswordConfirm'),
      notificationPrefs: t('profile.notificationPrefs'),
      inApp: t('profile.inApp'),
      emailDelivery: t('profile.emailDelivery'),
      billingEvents: t('profile.billingEvents'),
      fileEvents: t('profile.fileEvents'),
      workspaceAdminEvents: t('profile.workspaceAdminEvents'),
      savePrefs: t('profile.savePrefs'),
      sessionColumns: readArray(lang, 'dashboard.profile.sessionColumns'),
      noSessions: t('profile.noSessions'),
      revoke: t('profile.revoke'),
      revokeSessionConfirm: (id) => t('profile.revokeSessionConfirm', { values: { id } }),
    },
    billing: {
      title: t('billing.title'),
      subtitle: t('billing.subtitle'),
      checkoutNote: t('billing.checkoutNote'),
      skuColumns: readArray(lang, 'dashboard.billing.skuColumns'),
      subscriptionColumns: readArray(lang, 'dashboard.billing.subscriptionColumns'),
      invoiceColumns: readArray(lang, 'dashboard.billing.invoiceColumns'),
      paymentColumns: readArray(lang, 'dashboard.billing.paymentColumns'),
      taxProfile: t('billing.taxProfile'),
      taxNote: t('billing.taxNote'),
      company: t('billing.company'),
      save: t('billing.save'),
      entitlementColumns: readArray(lang, 'dashboard.billing.entitlementColumns'),
    },
    orders: {
      title: t('orders.title'),
      subtitle: t('orders.subtitle'),
      columns: readArray(lang, 'dashboard.orders.columns'),
    },
    files: {
      title: t('files.title'),
      subtitle: t('files.subtitle'),
      uploadFile: t('files.uploadFile'),
      upload: t('files.upload'),
      searchPlaceholder: t('files.searchPlaceholder'),
      columns: readArray(lang, 'dashboard.files.columns'),
      open: t('files.open'),
      download: t('files.download'),
      pending: t('files.pending'),
      archive: t('files.archive'),
      delete: t('files.delete'),
      archiveConfirm: (name) => t('files.archiveConfirm', { values: { name } }),
      deleteConfirm: (name) => t('files.deleteConfirm', { values: { name } }),
    },
    credits: {
      title: t('credits.title'),
      subtitle: t('credits.subtitle'),
      columns: readArray(lang, 'dashboard.credits.columns'),
    },
    tasks: {
      title: t('tasks.title'),
      subtitle: t('tasks.subtitle'),
      columns: readArray(lang, 'dashboard.tasks.columns'),
    },
    taskDetail: {
      title: t('taskDetail.title'),
      subtitle: t('taskDetail.subtitle'),
      fieldColumns: readArray(lang, 'dashboard.taskDetail.fieldColumns'),
      fields: readArray(lang, 'dashboard.taskDetail.fields'),
      missingTitle: t('taskDetail.missingTitle'),
      missingBody: t('taskDetail.missingBody'),
    },
    notifications: {
      title: t('notifications.title'),
      subtitle: t('notifications.subtitle'),
      readAll: t('notifications.readAll'),
      readAllBody: t('notifications.readAllBody'),
      readAllConfirm: t('notifications.readAllConfirm'),
      markRead: t('notifications.markRead'),
      columns: readArray(lang, 'dashboard.notifications.columns'),
      markOneConfirm: (title) => t('notifications.markOneConfirm', { values: { title } }),
    },
    notificationSettings: {
      title: t('notificationSettings.title'),
      subtitle: t('notificationSettings.subtitle'),
      save: t('notificationSettings.save'),
    },
    common: {
      noRecords: t('common.noRecords'),
      filterResult: (visible, total) => t('common.filterResult', { values: { visible, total } }),
    },
  };
}
