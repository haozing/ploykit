/**
 * ============================================================================
 * Plugin List Component
 * ============================================================================
 *
 * Client component, responsible for:
 * - Fetching plugin list from API
 * - Handling enable/disable actions
 * - Displaying loading and error states
 * - Rendering plugin cards
 */

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { PluginCard } from './PluginCard';
import { AlertCircle, Loader2, RefreshCw } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useTranslations } from 'next-intl';
import { API_KEYS, fetcher, postFetcher, deleteFetcher } from '@/lib/swr';

/**
 * ============================================================================
 * Types
 * ============================================================================
 */
interface Plugin {
  id: string;
  name: string;
  version: string;
  description: string;
  author?: string;
  installed: boolean; // Installation status
  enabled?: boolean; // Optional field
  installedAt?: string; // Optional field
}

interface PluginsResponse {
  plugins: Plugin[];
}

/**
 * ============================================================================
 * PluginList Component
 * ============================================================================
 */
export function PluginList() {
  const t = useTranslations('dashboard.plugins.list');
  const router = useRouter();
  const [actionError, setActionError] = useState<string | null>(null);

  // Fetch plugins using SWR
  const {
    data,
    error: fetchError,
    isLoading: loading,
    mutate,
  } = useSWR<PluginsResponse>(API_KEYS.PLUGINS.LIST, fetcher);

  const plugins = data?.plugins || [];
  const error = actionError || (fetchError ? fetchError.message || t('errors.fetchFailed') : null);

  //
  // Enable plugin
  //
  async function handleEnable(pluginId: string) {
    try {
      setActionError(null);
      await postFetcher(API_KEYS.PLUGINS.ENABLE(pluginId), { arg: {} });
      await mutate();
      router.refresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : t('errors.enableFailed'));
    }
  }

  //
  // Disable plugin
  //
  async function handleDisable(pluginId: string) {
    try {
      setActionError(null);
      await postFetcher(API_KEYS.PLUGINS.DISABLE(pluginId), { arg: {} });
      await mutate();
      router.refresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : t('errors.disableFailed'));
    }
  }

  //
  // Uninstall plugin
  //
  async function handleUninstall(pluginId: string) {
    try {
      setActionError(null);
      await deleteFetcher(API_KEYS.PLUGINS.UNINSTALL(pluginId));
      await mutate();
      router.refresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : t('errors.uninstallFailed'));
    }
  }

  //
  // Install plugin
  //
  async function handleInstall(pluginId: string) {
    try {
      setActionError(null);
      await postFetcher(API_KEYS.PLUGINS.INSTALL(pluginId), { arg: {} });
      await mutate();
      router.refresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : t('errors.installFailed'));
    }
  }

  //
  // Loading state
  //
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        <span className="ml-2 text-muted-foreground">{t('loading')}</span>
      </div>
    );
  }

  //
  // Error state
  //
  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription className="flex items-center justify-between">
          <span>{error}</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setActionError(null);
              void mutate();
            }}
            className="ml-4"
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            {t('retry')}
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  //
  // Empty state
  //
  if (plugins.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-foreground text-lg">{t('empty.title')}</p>
        <p className="text-muted-foreground text-sm mt-2">{t('empty.description')}</p>
      </div>
    );
  }

  //
  // Plugin list
  //
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {plugins.map((plugin) => (
        <PluginCard
          key={plugin.id}
          plugin={plugin}
          onInstall={() => handleInstall(plugin.id)}
          onEnable={() => handleEnable(plugin.id)}
          onDisable={() => handleDisable(plugin.id)}
          onUninstall={() => handleUninstall(plugin.id)}
        />
      ))}
    </div>
  );
}
