import { authView } from './auth-view';

export default function RegisterPage(props: { lang?: string; error?: string }) {
  return authView({
    mode: 'register',
    action: '/api/auth/register',
    lang: props.lang,
    error: props.error,
  });
}
