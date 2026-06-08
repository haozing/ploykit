import type { Metadata } from 'next';
import DashboardModulePage, {
  generateMetadata as generateDashboardModuleMetadata,
} from '../../../(dashboard)/dashboard/[[...modulePath]]/page';

interface LocalizedDashboardModulePageProps {
  params: Promise<{
    lang: string;
    modulePath: string[];
  }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

async function dashboardModuleParams(params: LocalizedDashboardModulePageProps['params']) {
  const { modulePath } = await params;
  return { modulePath };
}

export async function generateMetadata({
  params,
}: LocalizedDashboardModulePageProps): Promise<Metadata> {
  return generateDashboardModuleMetadata({
    params: dashboardModuleParams(params),
  });
}

export default function LocalizedDashboardModulePage({
  params,
  searchParams,
}: LocalizedDashboardModulePageProps) {
  return DashboardModulePage({
    params: dashboardModuleParams(params),
    searchParams,
  });
}
