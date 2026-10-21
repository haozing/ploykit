import {
  ForgotPasswordPage,
  ResetPasswordPage,
  VerifyEmailPage,
} from '@ploykit/ui';

/**
 * 低频公开页：找回密码、重置密码、邮箱验证。
 *
 * 懒加载。对同一个访客它们都是"来一次就走"，留在首包只会让每条路由（包括
 * 博客页——陌生人多从搜索引擎进来）多背一份表单代码。登录页不在这里，因为
 * 它要预渲染进首屏（见 routes-public.tsx 的说明）。
 */
export const ForgotPassword = ForgotPasswordPage;
export const ResetPassword = ResetPasswordPage;
export const VerifyEmail = VerifyEmailPage;
