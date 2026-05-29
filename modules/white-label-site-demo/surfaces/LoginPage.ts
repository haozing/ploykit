import { authView } from './auth-view';

export default function LoginPage(props: { lang?: string; nextPath?: string; error?: string; notice?: string }) {
  return authView({
    mode: 'login',
    action: '/api/auth/login',
    lang: props.lang,
    nextPath: props.nextPath,
    error: props.error,
    notice: props.notice,
  });
}
