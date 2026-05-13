/**
 * Plugin Card Component
 *
 * Displays plugin metadata, status, and lifecycle actions.
 */

'use client';

import { useState } from 'react';
import { PluginStatusBadge } from './PluginStatusBadge';
import { Loader2, Trash2 } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useTranslations } from 'next-intl';

/**
 * ════════════════════════════════════════════════════════════
 * Types
 * ════════════════════════════════════════════════════════════
 */
interface PluginCardProps {
  plugin: {
    id: string;
    name: string;
    version: string;
    description: string;
    author?: string;
    installed: boolean;
    enabled?: boolean;
  };
  onInstall: () => Promise<void>;
  onEnable: () => Promise<void>;
  onDisable: () => Promise<void>;
  onUninstall: () => Promise<void>;
}

/**
 * ════════════════════════════════════════════════════════════
 * PluginCard Component
 * ════════════════════════════════════════════════════════════
 */
export function PluginCard({
  plugin,
  onInstall,
  onEnable,
  onDisable,
  onUninstall,
}: PluginCardProps) {
  const t = useTranslations('dashboard.plugins.card');
  const [loading, setLoading] = useState(false);
  const [uninstalling, setUninstalling] = useState(false);

  //
  // Install
  //
  async function handleInstall() {
    setLoading(true);
    try {
      await onInstall();
    } finally {
      setLoading(false);
    }
  }

  //
  async function handleToggle() {
    setLoading(true);
    try {
      if (plugin.enabled) {
        await onDisable();
      } else {
        await onEnable();
      }
    } finally {
      setLoading(false);
    }
  }

  //
  // Uninstall
  //
  async function handleUninstall() {
    setUninstalling(true);
    try {
      await onUninstall();
    } finally {
      setUninstalling(false);
    }
  }

  return (
    <article
      aria-label={`${plugin.name} plugin`}
      className="border border-border/40 rounded-lg p-6 shadow-sm hover:shadow-md transition-shadow bg-card"
    >
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1">
          <h3 className="text-xl font-semibold text-foreground">{plugin.name}</h3>
          <p className="text-sm text-muted-foreground mt-1">
            v{plugin.version}
            {plugin.author && ` - ${plugin.author}`}
          </p>
        </div>
        <PluginStatusBadge installed={plugin.installed} enabled={plugin.enabled} />
      </div>

      <p className="text-muted-foreground mb-6 text-sm leading-relaxed">{plugin.description}</p>

      <div className="flex gap-2">
        {!plugin.installed ? (
          //
          // Not installed: Show install button
          //
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <button
                disabled={loading || uninstalling}
                className={`
                  flex items-center justify-center gap-2
                  px-4 py-2 rounded-md text-sm font-medium
                  transition-colors flex-1
                  bg-primary hover:bg-primary/90 text-primary-foreground
                  ${loading || uninstalling ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
                `}
              >
                {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                {loading ? t('installing') : t('install')}
              </button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t('installDialog.title')}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t('installDialog.description', { name: plugin.name })}
                  <ul className="list-disc list-inside mt-2 space-y-1">
                    <li>{t('installDialog.steps.createTables')}</li>
                    <li>{t('installDialog.steps.initConfig')}</li>
                    <li>{t('installDialog.steps.runScript')}</li>
                  </ul>
                  <p className="mt-2">{t('installDialog.afterInstall')}</p>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
                <AlertDialogAction onClick={handleInstall}>{t('confirmInstall')}</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : (
          //
          // Installed: Show enable/disable and uninstall buttons
          //
          <>
            {/* Enable/Disable button with confirmation dialog */}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <button
                  disabled={loading || uninstalling}
                  className={`
                    flex items-center justify-center gap-2
                    px-4 py-2 rounded-md text-sm font-medium
                    transition-colors flex-1
                    ${
                      plugin.enabled
                        ? 'bg-muted hover:bg-muted/80 text-foreground'
                        : 'bg-primary hover:bg-primary/90 text-primary-foreground'
                    }
                    ${loading || uninstalling ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
                  `}
                >
                  {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                  {loading ? t('processing') : plugin.enabled ? t('disable') : t('enable')}
                </button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {plugin.enabled ? t('disableDialog.title') : t('enableDialog.title')}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {plugin.enabled
                      ? t('disableDialog.description', { name: plugin.name })
                      : t('enableDialog.description', { name: plugin.name })}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
                  <AlertDialogAction onClick={handleToggle}>{t('confirm')}</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            {/* Uninstall button (only available when disabled) */}
            {!plugin.enabled && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <button
                    disabled={loading || uninstalling}
                    className={`
                      flex items-center justify-center gap-2
                      px-4 py-2 rounded-md text-sm font-medium
                      transition-colors
                      bg-destructive hover:bg-destructive/90 text-destructive-foreground
                      ${loading || uninstalling ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
                    `}
                    title={t('uninstall')}
                  >
                    {uninstalling ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Trash2 className="w-4 h-4" />
                    )}
                  </button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle className="text-destructive">
                      {t('uninstallDialog.title')}
                    </AlertDialogTitle>
                    <AlertDialogDescription className="space-y-2">
                      <p className="font-semibold">
                        {t('uninstallDialog.pluginName', {
                          name: plugin.name,
                        })}
                      </p>
                      <p>{t('uninstallDialog.warning')}</p>
                      <p className="text-destructive font-semibold">
                        {t('uninstallDialog.irreversible')}
                      </p>
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={handleUninstall}
                      className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
                    >
                      {t('confirmUninstall')}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </>
        )}
      </div>
    </article>
  );
}
