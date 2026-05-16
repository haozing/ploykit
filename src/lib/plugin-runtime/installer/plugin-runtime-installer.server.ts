import { db } from '@/lib/db/client.server';
import { pluginInstallations } from '@/lib/db/schema/plugins';
import { pluginConfig, pluginSecrets } from '@/lib/db/schema/plugin-capabilities';
import {
  pluginArtifacts,
  pluginCollections,
  pluginRagChunks,
  pluginRecords,
} from '@/lib/db/schema/plugin-storage';
import { pluginJobRuns } from '@/lib/db/schema/reliability';
import { bus } from '@/lib/bus';
import { logger } from '@/lib/_core/logger';
import { pluginQueryService } from '@/lib/plugins/plugin-query.server';
import {
  registerPluginRuntimeEvents,
  unregisterPluginRuntimeEvents,
} from '@/lib/plugin-runtime/events';
import {
  registerPluginRuntimeHooks,
  unregisterPluginRuntimeHooks,
} from '@/lib/plugin-runtime/hooks';
import { registerPluginRuntimeJobs, unregisterPluginRuntimeJobs } from '@/lib/plugin-runtime/jobs';
import { slotManager } from '@/lib/ui/slots/slot-manager';
import type { PluginOperationResult } from '@/lib/plugins/plugin-types';
import {
  PluginAlreadyInstalledError,
  PluginInstallError,
  PluginLifecycleError,
  PluginNotFoundError,
  PluginNotInstalledError,
} from '@/lib/_core/errors';
import { runPluginLifecycle } from '../adapters';
import { getPluginRuntimeMapEntry } from '../loader';
import { pluginRuntimeRegistry } from '../registry';
import { assertNoPluginPublicAliasConflicts } from '../public-routes/public-route-conflicts.server';
import { eq } from 'drizzle-orm';
import { env } from '@/lib/_core/env';
import {
  createPluginStorageRuntime,
  DbPluginStorageRepository,
} from '../storage/db-storage.server';
import { listInternalServiceRequirements } from '../admin/internal-services.server';

async function deletePluginRuntimeState(pluginId: string): Promise<void> {
  await db.delete(pluginJobRuns).where(eq(pluginJobRuns.pluginId, pluginId));
  await db.delete(pluginRagChunks).where(eq(pluginRagChunks.pluginId, pluginId));
  await db.delete(pluginArtifacts).where(eq(pluginArtifacts.pluginId, pluginId));
  await db.delete(pluginConfig).where(eq(pluginConfig.pluginId, pluginId));
  await db.delete(pluginSecrets).where(eq(pluginSecrets.pluginId, pluginId));
  await db.delete(pluginRecords).where(eq(pluginRecords.pluginId, pluginId));
  await db.delete(pluginCollections).where(eq(pluginCollections.pluginId, pluginId));
}

async function listEnabledRuntimePluginIdsIncluding(pluginId: string): Promise<string[]> {
  const installations = await pluginQueryService.listInstalledPlugins();
  return [
    ...new Set([
      ...installations
        .filter((installation) => installation.enabled)
        .map((installation) => installation.pluginId),
      pluginId,
    ]),
  ];
}

export class PluginRuntimeInstallerService {
  async installPlugin(pluginId: string, userId?: string): Promise<PluginOperationResult> {
    try {
      logger.info({ pluginId, userId }, 'Installing plugin from runtime contract');

      const entry = getPluginRuntimeMapEntry(pluginId);
      if (!entry?.plugin && !entry?.runtimeContract) {
        throw new PluginNotFoundError(pluginId);
      }

      const contract = await pluginRuntimeRegistry.getOrLoad(pluginId, entry);

      const result = await db.transaction(async (tx) => {
        const [existing] = await tx
          .select()
          .from(pluginInstallations)
          .where(eq(pluginInstallations.pluginId, pluginId))
          .for('update')
          .limit(1);

        if (existing) {
          throw new PluginAlreadyInstalledError(pluginId, 'global');
        }

        const [installation] = await tx
          .insert(pluginInstallations)
          .values({
            pluginId,
            version: contract.version,
            enabled: false,
            installedBy: userId,
          })
          .returning();

        await createPluginStorageRuntime({
          pluginId,
          system: true,
          data: contract.data,
          repository: new DbPluginStorageRepository(tx),
        }).ensureCollections();

        return {
          success: true,
          installation: pluginQueryService.mapInstallation(installation),
        };
      });

      const lifecycle = await runPluginLifecycle({
        pluginId,
        lifecycle: 'install',
        userId,
        metadata: {
          version: contract.version,
          installationId: result.installation?.id,
        },
      });

      if (!lifecycle.success) {
        await db.delete(pluginInstallations).where(eq(pluginInstallations.pluginId, pluginId));
        await deletePluginRuntimeState(pluginId);
        throw new PluginInstallError(pluginId, lifecycle.error ?? 'Install lifecycle failed', {
          userId,
        });
      }

      await bus.event.emit(
        'plugin.installed',
        'plugin-runtime-installer',
        {
          pluginId,
          userId,
          version: contract.version,
          installationId: result.installation?.id,
        },
        {
          correlationId: result.installation?.id ?? pluginId,
          idempotencyKey: `plugin:${pluginId}:installed:${result.installation?.id ?? 'unknown'}`,
        }
      );

      return result;
    } catch (error) {
      logger.error({ pluginId, error }, 'Failed to install runtime plugin');

      if (
        error instanceof PluginNotFoundError ||
        error instanceof PluginAlreadyInstalledError ||
        error instanceof PluginInstallError
      ) {
        throw error;
      }

      throw new PluginInstallError(
        pluginId,
        error instanceof Error ? error.message : String(error),
        {
          userId,
        }
      );
    }
  }

  async enablePlugin(pluginId: string, userId?: string): Promise<PluginOperationResult> {
    try {
      logger.info({ pluginId, userId }, 'Enabling plugin from runtime contract');

      const installation = await pluginQueryService.getInstallation(pluginId);
      if (!installation) {
        throw new PluginNotInstalledError(pluginId, 'global');
      }

      if (installation.enabled) {
        await registerPluginRuntimeJobs(pluginId);
        await registerPluginRuntimeEvents(pluginId);
        await registerPluginRuntimeHooks(pluginId);
        await slotManager.registerFromContract(pluginId);
        await assertNoPluginPublicAliasConflicts({
          pluginIds: await listEnabledRuntimePluginIdsIncluding(pluginId),
        });
        return {
          success: true,
          installation,
        };
      }

      const serviceRequirements = await listInternalServiceRequirements({ pluginId });
      const missingServices = serviceRequirements.filter(
        (requirement) => requirement.bindingStatus !== 'bound'
      );
      const strictServices =
        env.NODE_ENV === 'production' || env.PLUGIN_INTERNAL_SERVICE_STRICT_MODE === 'true';
      if (strictServices && missingServices.length > 0) {
        throw new PluginLifecycleError(
          pluginId,
          'enable',
          `Internal service binding missing: ${missingServices
            .map((requirement) => requirement.serviceName)
            .join(', ')}`
        );
      }
      if (missingServices.length > 0) {
        logger.warn(
          {
            pluginId,
            services: missingServices.map((requirement) => requirement.serviceName),
          },
          'Plugin enabled with unbound internal services'
        );
      }

      const lifecycle = await runPluginLifecycle({
        pluginId,
        lifecycle: 'enable',
        userId,
        metadata: {
          version: installation.version,
          installationId: installation.id,
        },
      });

      if (!lifecycle.success) {
        throw new PluginLifecycleError(pluginId, 'enable', lifecycle.error ?? 'Enable failed');
      }

      let updated: typeof pluginInstallations.$inferSelect;

      try {
        await registerPluginRuntimeJobs(pluginId);
        await registerPluginRuntimeEvents(pluginId);
        await registerPluginRuntimeHooks(pluginId);
        await slotManager.registerFromContract(pluginId);
        await assertNoPluginPublicAliasConflicts({
          pluginIds: await listEnabledRuntimePluginIdsIncluding(pluginId),
        });

        [updated] = await db
          .update(pluginInstallations)
          .set({
            enabled: true,
            updatedAt: new Date(),
          })
          .where(eq(pluginInstallations.pluginId, pluginId))
          .returning();
      } catch (registrationOrUpdateError) {
        bus.onPluginDisabled(pluginId);
        unregisterPluginRuntimeJobs(pluginId);
        unregisterPluginRuntimeEvents(pluginId);
        unregisterPluginRuntimeHooks(pluginId);
        slotManager.unregister(pluginId);
        throw registrationOrUpdateError;
      }

      const mapped = pluginQueryService.mapInstallation(updated);

      await bus.event.emit(
        'plugin.enabled',
        'plugin-runtime-installer',
        {
          pluginId,
          version: mapped.version,
          installationId: mapped.id,
        },
        {
          correlationId: mapped.id,
          idempotencyKey: `plugin:${pluginId}:enabled:${mapped.id}`,
        }
      );

      return {
        success: true,
        installation: mapped,
      };
    } catch (error) {
      logger.error({ pluginId, error }, 'Failed to enable runtime plugin');

      if (error instanceof PluginNotInstalledError || error instanceof PluginLifecycleError) {
        throw error;
      }

      throw new PluginLifecycleError(
        pluginId,
        'enable',
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  async disablePlugin(pluginId: string, userId?: string): Promise<PluginOperationResult> {
    try {
      logger.info({ pluginId, userId }, 'Disabling plugin from runtime contract');

      const installation = await pluginQueryService.getInstallation(pluginId);
      if (!installation) {
        throw new PluginNotInstalledError(pluginId, 'global');
      }

      if (!installation.enabled) {
        unregisterPluginRuntimeJobs(pluginId);
        unregisterPluginRuntimeEvents(pluginId);
        unregisterPluginRuntimeHooks(pluginId);
        slotManager.unregister(pluginId);
        return {
          success: true,
          installation,
        };
      }

      const lifecycle = await runPluginLifecycle({
        pluginId,
        lifecycle: 'disable',
        userId,
        metadata: {
          version: installation.version,
          installationId: installation.id,
        },
      });

      if (!lifecycle.success) {
        logger.warn(
          { pluginId, error: lifecycle.error },
          'Disable lifecycle failed but continuing'
        );
      }

      bus.onPluginDisabled(pluginId);
      unregisterPluginRuntimeJobs(pluginId);
      unregisterPluginRuntimeEvents(pluginId);
      unregisterPluginRuntimeHooks(pluginId);
      slotManager.unregister(pluginId);

      const [updated] = await db
        .update(pluginInstallations)
        .set({
          enabled: false,
          updatedAt: new Date(),
        })
        .where(eq(pluginInstallations.pluginId, pluginId))
        .returning();

      const mapped = pluginQueryService.mapInstallation(updated);

      await bus.event.emit(
        'plugin.disabled',
        'plugin-runtime-installer',
        {
          pluginId,
          version: mapped.version,
          installationId: mapped.id,
        },
        {
          correlationId: mapped.id,
          idempotencyKey: `plugin:${pluginId}:disabled:${mapped.id}`,
        }
      );

      return {
        success: true,
        installation: mapped,
      };
    } catch (error) {
      logger.error({ pluginId, error }, 'Failed to disable runtime plugin');

      if (error instanceof PluginNotInstalledError || error instanceof PluginLifecycleError) {
        throw error;
      }

      throw new PluginLifecycleError(
        pluginId,
        'disable',
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  async uninstallPlugin(pluginId: string, userId?: string): Promise<PluginOperationResult> {
    try {
      logger.info({ pluginId, userId }, 'Uninstalling plugin from runtime contract');

      const installation = await pluginQueryService.getInstallation(pluginId);
      if (!installation) {
        throw new PluginNotInstalledError(pluginId, 'global');
      }

      if (installation.enabled) {
        await this.disablePlugin(pluginId, userId);
      }

      const lifecycle = await runPluginLifecycle({
        pluginId,
        lifecycle: 'uninstall',
        userId,
        metadata: {
          version: installation.version,
          installationId: installation.id,
        },
      });

      if (!lifecycle.success) {
        logger.warn(
          { pluginId, error: lifecycle.error },
          'Uninstall lifecycle failed but continuing'
        );
      }

      await deletePluginRuntimeState(pluginId);
      await db.delete(pluginInstallations).where(eq(pluginInstallations.pluginId, pluginId));
      pluginRuntimeRegistry.unregister(pluginId);

      await bus.event.emit(
        'plugin.uninstalled',
        'plugin-runtime-installer',
        {
          pluginId,
          version: installation.version,
          installationId: installation.id,
        },
        {
          correlationId: installation.id,
          idempotencyKey: `plugin:${pluginId}:uninstalled:${installation.id}`,
        }
      );

      return {
        success: true,
        installation,
      };
    } catch (error) {
      logger.error({ pluginId, error }, 'Failed to uninstall runtime plugin');

      if (error instanceof PluginNotInstalledError || error instanceof PluginLifecycleError) {
        throw error;
      }

      throw new PluginLifecycleError(
        pluginId,
        'uninstall',
        error instanceof Error ? error.message : String(error)
      );
    }
  }
}

export const pluginRuntimeInstallerService = new PluginRuntimeInstallerService();
