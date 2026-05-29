import { AuthPage } from '@host/components/auth/AuthPages';
import { generatePresentedHostMetadata, renderPresentedHostPage } from '@host/lib/host-page-rendering';
import { readHostMessageValue } from '@host/lib/host-i18n';
import { readLanguageParam, type LanguageRouteParams } from '@host/lib/route-params';

interface LoginPageProps {
  params: Promise<LanguageRouteParams>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

interface LoginNoticeCopy {
  registered: string;
  verified: string;
  resetSent: string;
  resetDone: string;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function LoginPage({ params, searchParams }: LoginPageProps) {
  const lang = await readLanguageParam(params);
  const query = searchParams ? await searchParams : {};
  const noticeCopy = readHostMessageValue<LoginNoticeCopy>(lang, 'auth.notices');
  const notice =
    first(query.registered) === '1'
      ? noticeCopy.registered
      : first(query.verified) === '1'
        ? noticeCopy.verified
        : first(query.reset) === 'sent'
          ? noticeCopy.resetSent
          : first(query.reset) === 'done'
            ? noticeCopy.resetDone
            : undefined;
  const nextPath = first(query.next);
  const error = first(query.error);
  return renderPresentedHostPage({
    pageId: 'auth.login',
    defaultPage: (
      <AuthPage lang={lang} mode="login" nextPath={nextPath} error={error} notice={notice} />
    ),
    componentProps: {
      nextPath,
      error,
      notice,
    },
    lang,
  });
}

export async function generateMetadata({ params }: { params: Promise<LanguageRouteParams> }) {
  const lang = await readLanguageParam(params);
  return generatePresentedHostMetadata({ pageId: 'auth.login', lang });
}
