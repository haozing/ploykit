/** g9 分片：公共组件一批（confirm / cron / errorBoundary / impersonation / notificationBell / onboarding）。 */
export const en: Record<string, string> = {
  // ui.confirm.* —— ConfirmDialogBody 默认按钮（confirmText/cancelText prop 优先）
  'ui.confirm.confirm': 'Confirm',
  'ui.confirm.cancel': 'Cancel',

  // ui.cron.* —— CronInput 标签/提示/预览 + describeCron 人类可读档位
  'ui.cron.expressionLabel': 'Cron expression',
  'ui.cron.fieldsHint': 'Five fields: minute hour day month weekday',
  'ui.cron.timezoneLabel': 'Timezone',
  'ui.cron.previewing': 'Loading preview…',
  'ui.cron.previewNext': 'Preview next {count} runs',
  'ui.cron.previewError': 'Preview failed. Check the expression and try again.',
  'ui.cron.everyMinute': 'Every minute',
  'ui.cron.hourlyAt': 'Every hour (at minute {minute})',
  'ui.cron.dailyAt': 'Every day at {time}',
  'ui.cron.weeklyAt': 'Every {day} at {time}',
  'ui.cron.dow.0': 'Sunday',
  'ui.cron.dow.1': 'Monday',
  'ui.cron.dow.2': 'Tuesday',
  'ui.cron.dow.3': 'Wednesday',
  'ui.cron.dow.4': 'Thursday',
  'ui.cron.dow.5': 'Friday',
  'ui.cron.dow.6': 'Saturday',
  'ui.cron.dow.7': 'Sunday',

  // ui.errorBoundary.* —— ErrorBoundary 默认错误态（class 组件，模块级 t）
  'ui.errorBoundary.title': 'Something went wrong',
  'ui.errorBoundary.retry': 'Retry',

  // ui.impersonation.* —— ImpersonationBanner 默认横幅（label prop 优先）
  'ui.impersonation.banner': 'You are in an admin impersonation session',

  // ui.notificationBell.* —— NotificationBell 面板
  'ui.notificationBell.notifications': 'Notifications',
  'ui.notificationBell.listAria': 'Notification list',
  'ui.notificationBell.markAllRead': 'Mark all as read',
  'ui.notificationBell.loading': 'Loading…',
  'ui.notificationBell.empty': 'No notifications',

  // ui.onboarding.* —— OnboardingChecklist 默认标题/进度/aria（title prop 优先）
  'ui.onboarding.defaultTitle': 'Getting started',
  'ui.onboarding.createWorkspace': 'Create your first workspace',
  'ui.onboarding.allDone': 'All done. Enjoy the ride!',
  'ui.onboarding.progressCount': '{done}/{total} completed',
  'ui.onboarding.dismissAria': 'Dismiss getting started checklist',
  'ui.onboarding.complete': 'Complete',
  'ui.onboarding.progress': 'Progress',
}

export const zh: Record<string, string> = {
  'ui.confirm.confirm': '确认',
  'ui.confirm.cancel': '取消',

  'ui.cron.expressionLabel': 'Cron 表达式',
  'ui.cron.fieldsHint': '五字段：分 时 日 月 周',
  'ui.cron.timezoneLabel': '时区',
  'ui.cron.previewing': '预览中…',
  'ui.cron.previewNext': '预览下次 {count} 次',
  'ui.cron.previewError': '预览失败，请检查表达式后重试',
  'ui.cron.everyMinute': '每分钟',
  'ui.cron.hourlyAt': '每小时（第 {minute} 分）',
  'ui.cron.dailyAt': '每天 {time}',
  'ui.cron.weeklyAt': '每{day} {time}',
  'ui.cron.dow.0': '周日',
  'ui.cron.dow.1': '周一',
  'ui.cron.dow.2': '周二',
  'ui.cron.dow.3': '周三',
  'ui.cron.dow.4': '周四',
  'ui.cron.dow.5': '周五',
  'ui.cron.dow.6': '周六',
  'ui.cron.dow.7': '周日',

  'ui.errorBoundary.title': '出错了',
  'ui.errorBoundary.retry': '重试',

  'ui.impersonation.banner': '您正处于管理员模拟会话',

  'ui.notificationBell.notifications': '通知',
  'ui.notificationBell.listAria': '通知列表',
  'ui.notificationBell.markAllRead': '全部已读',
  'ui.notificationBell.loading': '加载中…',
  'ui.notificationBell.empty': '暂无通知',

  'ui.onboarding.defaultTitle': '开始使用',
  'ui.onboarding.createWorkspace': '创建第一个工作区',
  'ui.onboarding.allDone': '全部完成，开始你的旅程吧！',
  'ui.onboarding.progressCount': '已完成 {done}/{total} 项',
  'ui.onboarding.dismissAria': '关闭引导清单',
  'ui.onboarding.complete': '完成',
  'ui.onboarding.progress': '进度',
}
