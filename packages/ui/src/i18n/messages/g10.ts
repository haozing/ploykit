/** g10 分片：公共组件二批——PasswordField / ReauthDialog / SecretModal /
 *  SidebarUserMenu / SiteBannerLayer / UserMenu / toast。键前缀 ui.<component>.*。
 *  注：UserMenu/SidebarUserMenu 经 kit-labels 覆盖体系（labels prop >
 *  KitLabelsProvider）的键（confirmSaved/confirmPending/accountSettings/logout/
 *  userMenuAria/logoutFailedToast）默认值仍在 labels/kit-labels.tsx，不在本分片。 */
export const en: Record<string, string> = {
  // ---- PasswordField ----
  'ui.password.show': 'Show password',
  'ui.password.hide': 'Hide password',

  // ---- ReauthDialog ----
  'ui.reauth.title': 'Password verification required',
  'ui.reauth.description':
    'This is a sensitive action. Confirm your password and it will be retried automatically. Verification stays valid for a period of time.',
  'ui.reauth.currentPassword': 'Current password',
  'ui.reauth.cancel': 'Cancel',
  'ui.reauth.verifying': 'Verifying…',
  'ui.reauth.verifyAndContinue': 'Verify and continue',
  'ui.reauth.verifiedToast': 'Verified — action retried',
  'ui.reauth.wrongPassword': 'Incorrect password. Please try again.',
  'ui.reauth.failedToast': 'Action failed. Please try again later.',

  // ---- SecretModal（含 ImpactConfirmation）----
  'ui.secret.createdTitle': '{name} created successfully',
  'ui.secret.description':
    'This secret is shown only once and cannot be viewed again after closing. Save it somewhere safe now.',
  'ui.secret.ariaOnce': 'Secret (shown only once)',
  'ui.secret.itemAria': 'Secret {index} of {total} (shown only once)',
  'ui.secret.copy': 'Copy',
  'ui.secret.copied': 'Copied',
  'ui.secret.copyAll': 'Copy all',
  'ui.secret.copiedAll': 'All copied',
  'ui.secret.copyFailed': 'Copy failed. Please copy manually.',
  'ui.secret.confirmSavedLabel': 'I have saved the secret somewhere safe',
  'ui.secret.impactsDescription': 'This action will have the following impacts:',
  'ui.secret.acceptImpacts': 'I understand and accept the impacts above',
  'ui.secret.cancel': 'Cancel',
  'ui.secret.confirmExecute': 'Confirm',

  // ---- SidebarUserMenu ----
  'ui.sidebarUser.signedOut': 'Not signed in',
  'ui.sidebarUser.adminConsole': 'Admin console',

  // ---- SiteBannerLayer ----
  'ui.siteBanner.maintenance':
    'Maintenance in progress: features may be briefly unavailable',

  // ---- UserMenu ----
  'ui.userMenu.accountSettings': 'Account settings',
  'ui.userMenu.logout': 'Sign out',
  'ui.userMenu.userMenuAria': 'User menu',
  'ui.userMenu.logoutFailedToast':
    'Sign-out failed. Please try again on the login page in a moment.',
  'ui.userMenu.signedOut': 'Not signed in',
  'ui.userMenu.adminConsole': 'Admin console',

  // ---- toast ----
  'ui.toast.containerAria': 'Notifications',
}

export const zh: Record<string, string> = {
  // ---- PasswordField ----
  'ui.password.show': '显示密码',
  'ui.password.hide': '隐藏密码',

  // ---- ReauthDialog ----
  'ui.reauth.title': '需要验证密码',
  'ui.reauth.description': '这是敏感操作，需要确认密码后自动重试。密码确认在一段时间内有效。',
  'ui.reauth.currentPassword': '当前密码',
  'ui.reauth.cancel': '取消',
  'ui.reauth.verifying': '验证中…',
  'ui.reauth.verifyAndContinue': '验证并继续',
  'ui.reauth.verifiedToast': '已验证，操作已重试',
  'ui.reauth.wrongPassword': '密码不正确，请重试',
  'ui.reauth.failedToast': '操作失败，请稍后重试',

  // ---- SecretModal（含 ImpactConfirmation）----
  'ui.secret.createdTitle': '{name} 创建成功',
  'ui.secret.description': '此密钥只显示一次，关闭后无法再次查看。请立即保存到安全的地方。',
  'ui.secret.ariaOnce': '密钥（只显示一次）',
  'ui.secret.itemAria': '密钥 {index}（共 {total} 项，只显示一次）',
  'ui.secret.copy': '复制',
  'ui.secret.copied': '已复制',
  'ui.secret.copyAll': '复制全部',
  'ui.secret.copiedAll': '已复制全部',
  'ui.secret.copyFailed': '复制失败，请手动复制',
  'ui.secret.confirmSavedLabel': '我已将密钥保存到安全的地方',
  'ui.secret.impactsDescription': '此操作将产生以下影响：',
  'ui.secret.acceptImpacts': '我理解并接受以上影响',
  'ui.secret.cancel': '取消',
  'ui.secret.confirmExecute': '确认执行',

  // ---- SidebarUserMenu ----
  'ui.sidebarUser.signedOut': '未登录',
  'ui.sidebarUser.adminConsole': '管理控制台',

  // ---- SiteBannerLayer ----
  'ui.siteBanner.maintenance': '维护中：系统维护中，功能可能出现短暂不可用',

  // ---- UserMenu ----
  'ui.userMenu.accountSettings': '账户设置',
  'ui.userMenu.logout': '退出登录',
  'ui.userMenu.userMenuAria': '用户菜单',
  'ui.userMenu.logoutFailedToast': '退出登录失败，请稍后在登录页重试',
  'ui.userMenu.signedOut': '未登录',
  'ui.userMenu.adminConsole': '管理控制台',

  // ---- toast ----
  'ui.toast.containerAria': '通知',
}
