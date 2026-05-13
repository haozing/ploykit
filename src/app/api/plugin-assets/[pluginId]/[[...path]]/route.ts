import { NextRequest, NextResponse } from 'next/server';
import { PluginError } from '@ploykit/plugin-sdk';
import { withErrorHandling } from '@/lib/middleware';
import { getPluginRuntimeMapEntry } from '@/lib/plugin-runtime/loader';
import { pluginRuntimeRegistry } from '@/lib/plugin-runtime/registry';
import { readPluginAsset } from '@/lib/plugin-runtime/assets';

interface RouteContext {
  params: Promise<{
    pluginId: string;
    path?: string[];
  }>;
}

async function handlePluginAsset(_request: NextRequest, context: RouteContext): Promise<Response> {
  try {
    const { pluginId, path: pathSegments } = await context.params;
    const assetPath = (pathSegments ?? []).join('/');

    if (!assetPath) {
      throw new PluginError({
        code: 'PLUGIN_ASSET_PATH_REQUIRED',
        message: 'Plugin asset path is required.',
        statusCode: 404,
      });
    }

    const entry = getPluginRuntimeMapEntry(pluginId);
    const contract = await pluginRuntimeRegistry.getOrLoad(pluginId, entry);
    if (!entry) {
      throw new PluginError({
        code: 'PLUGIN_RUNTIME_NOT_FOUND',
        message: `Plugin "${pluginId}" is not present in the runtime plugin map.`,
        statusCode: 404,
        fix: 'Run npm run plugins:scan after adding the plugin.',
        details: { pluginId },
      });
    }
    const asset = await readPluginAsset(contract, entry, assetPath);

    return new NextResponse(asset.body, {
      headers: {
        'Content-Type': asset.contentType,
        'Content-Length': String(asset.size),
        'Cache-Control': asset.cacheControl,
        'X-Content-Type-Options': 'nosniff',
        'Cross-Origin-Resource-Policy': 'same-origin',
      },
    });
  } catch (error) {
    if (error instanceof PluginError) {
      return NextResponse.json(error.toJSON(), { status: error.statusCode });
    }
    throw error;
  }
}

export const GET = withErrorHandling(handlePluginAsset);
