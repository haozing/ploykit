import { authView } from './auth-view';

export default function ResetPasswordPage(props: { lang?: string; token?: string; error?: string }) {
  return authView({
    mode: 'reset-password',
    action: '/api/auth/password-reset/confirm',
    lang: props.lang,
    token: props.token,
    error: props.error,
  });
}
