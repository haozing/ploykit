import { authView } from './auth-view';

export default function ForgotPasswordPage(props: { lang?: string; error?: string }) {
  return authView({
    mode: 'forgot-password',
    action: '/api/auth/password-reset/request',
    lang: props.lang,
    error: props.error,
  });
}
