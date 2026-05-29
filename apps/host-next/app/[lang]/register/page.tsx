import { AuthPage } from '@host/components/auth/AuthPages';
import { readLanguageParam, type LanguageRouteParams } from '@host/lib/route-params';
import { generatePresentedHostMetadata, renderPresentedHostPage } from '@host/lib/host-page-rendering';

interface RegisterPageProps {
  params: Promise<LanguageRouteParams>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function RegisterPage({ params, searchParams }: RegisterPageProps) {
  const lang = await readLanguageParam(params);
  const query = searchParams ? await searchParams : {};
  const error = first(query.error);
  return renderPresentedHostPage({
    pageId: 'auth.register',
    defaultPage: <AuthPage lang={lang} mode="register" error={error} />,
    componentProps: { error },
    lang,
  });
}

export async function generateMetadata({ params }: { params: Promise<LanguageRouteParams> }) {
  const lang = await readLanguageParam(params);
  return generatePresentedHostMetadata({ pageId: 'auth.register', lang });
}
