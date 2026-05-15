import { notFound } from 'next/navigation';
import { PluginProvider } from '@ploykit/plugin-sdk/react';
import { logger } from '@/lib/_core/logger';
import type { PluginPageRuntimeResult } from '@/lib/plugin-runtime/adapters';
import { listPluginRuntimeAssets } from '@/lib/plugin-runtime/assets';
import type { PluginRuntimePageProps } from '@ploykit/plugin-sdk';
import type { ComponentType } from 'react';

interface PluginRuntimePageRendererProps {
  result: PluginPageRuntimeResult;
}

export async function PluginRuntimePageRenderer({ result }: PluginRuntimePageRendererProps) {
  let loadedModule: { default?: ComponentType<PluginRuntimePageProps> };

  try {
    loadedModule = (await result.module.load()) as {
      default?: ComponentType<PluginRuntimePageProps>;
    };
  } catch (error) {
    logger.error(
      {
        pluginId: result.contract.id,
        componentPath: result.module.componentPath,
        requestPath: result.requestPath,
        error,
      },
      'Failed to render plugin runtime page'
    );
    notFound();
  }

  const PluginPage = loadedModule.default;

  if (!PluginPage) {
    logger.error(
      {
        pluginId: result.contract.id,
        componentPath: result.module.componentPath,
        requestPath: result.requestPath,
      },
      'Plugin runtime page component not found'
    );
    notFound();
  }

  const pageProps: PluginRuntimePageProps = {
    pluginId: result.contract.id,
    localPath: result.localPath,
    requestPath: result.requestPath,
    params: result.params,
    query: result.query,
    assets: Object.fromEntries(
      listPluginRuntimeAssets(result.contract).map((asset) => [asset.path, asset.url])
    ),
    route: {
      path: result.route.path,
      auth: result.route.auth,
      layout: result.route.layout,
      permissions: result.route.permissions,
      commercial: result.route.commercial,
      publicAliases: result.route.publicAliases,
      tool: result.route.tool,
    },
  };

  return (
    <PluginProvider pluginId={result.contract.id}>
      <PluginPage {...pageProps} />
    </PluginProvider>
  );
}
