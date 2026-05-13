/**
 * Plugin Head Tags Component
 *
 * Key component: Triggers onRenderHead hook and renders plugin-injected head tags
 *
 * Features:
 * - Server Component (executes server-side)
 * - Automatically triggers HookBus.trigger('onRenderHead')
 * - Collects all plugin head tags
 * - Sorts by priority
 * - Renders in <head>
 */

import { collectPluginHeadTags, type HeadTag } from '@/lib/bus/hook-helpers.server';
import Script from 'next/script';

/**
 * Plugin Head Tags Component
 *
 * This component is a Server Component that executes during server-side rendering to:
 * 1. Trigger onRenderHead hook
 * 2. Collect all tags returned by plugins
 * 3. Render them in page <head>
 *
 * @example
 * ```tsx
 * // In layout.tsx
 * <head>
 *   <PluginHeadTags />
 * </head>
 * ```
 */
export async function PluginHeadTags() {
  // Fetch tags (separate data fetching from rendering)
  let sortedTags: HeadTag[] = [];

  try {
    // Trigger hooks and apply per-plugin policy before rendering.
    sortedTags = await collectPluginHeadTags();
  } catch (error) {
    // On failure, don't affect page rendering
    console.error('[PluginHeadTags] Failed to render plugin head tags:', error);
  }

  // Render tags (outside try/catch as per React 19 guidelines)
  if (sortedTags.length === 0) {
    return null;
  }

  return (
    <>
      {sortedTags.map((tag, index) => (
        <HeadTagRenderer key={`plugin-head-${index}`} tag={tag} />
      ))}
    </>
  );
}

/**
 * Head Tag Renderer
 *
 * Renders corresponding HTML element based on tag type
 */
function HeadTagRenderer({ tag }: { tag: HeadTag }) {
  switch (tag.tag) {
    case 'meta':
      return <meta {...tag.attrs} />;

    case 'link':
      return <link {...tag.attrs} />;

    case 'script':
      // Use Next.js Script component for optimal performance
      if (tag.attrs?.src) {
        const validStrategies = [
          'beforeInteractive',
          'afterInteractive',
          'lazyOnload',
          'worker',
        ] as const;
        const strategy = validStrategies.includes(
          tag.attrs.strategy as (typeof validStrategies)[number]
        )
          ? (tag.attrs.strategy as (typeof validStrategies)[number])
          : 'afterInteractive';
        return (
          <Script
            src={tag.attrs.src}
            strategy={strategy}
            {...(tag.attrs.async === 'true' && { async: true })}
            {...(tag.attrs.defer === 'true' && { defer: true })}
          />
        );
      }
      // Inline script
      if (tag.content) {
        return <script {...tag.attrs} dangerouslySetInnerHTML={{ __html: tag.content }} />;
      }
      return null;

    case 'style':
      if (tag.content) {
        return <style {...tag.attrs} dangerouslySetInnerHTML={{ __html: tag.content }} />;
      }
      return null;

    case 'title':
      // Note: title should be set via metadata, this is only a fallback
      return tag.content ? <title>{tag.content}</title> : null;

    default:
      console.warn(`[PluginHeadTags] Unknown tag type: ${tag.tag}`);
      return null;
  }
}

/**
 * Export type for plugin use
 */
export type { HeadTag } from '@/lib/bus/hook-helpers.server';
