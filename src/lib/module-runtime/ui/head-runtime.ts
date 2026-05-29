import type { ModuleSeoMetadata } from './seo-runtime';

export type ModuleHeadTag =
  | { tag: 'title'; content: string }
  | { tag: 'meta'; name: string; content: string }
  | { tag: 'meta'; property: string; content: string }
  | { tag: 'link'; rel: string; href: string };

export function createModuleHeadTags(metadata: ModuleSeoMetadata): ModuleHeadTag[] {
  const tags: ModuleHeadTag[] = [];

  if (metadata.title) {
    tags.push({ tag: 'title', content: metadata.title });
  }
  if (metadata.description) {
    tags.push({ tag: 'meta', name: 'description', content: metadata.description });
  }
  if (metadata.robots) {
    tags.push({ tag: 'meta', name: 'robots', content: metadata.robots });
  }
  if (metadata.canonical) {
    tags.push({ tag: 'link', rel: 'canonical', href: metadata.canonical });
  }
  if (metadata.openGraph?.title) {
    tags.push({ tag: 'meta', property: 'og:title', content: metadata.openGraph.title });
  }
  if (metadata.openGraph?.description) {
    tags.push({
      tag: 'meta',
      property: 'og:description',
      content: metadata.openGraph.description,
    });
  }
  if (metadata.openGraph?.image) {
    tags.push({ tag: 'meta', property: 'og:image', content: metadata.openGraph.image });
  }
  if (metadata.openGraph?.url) {
    tags.push({ tag: 'meta', property: 'og:url', content: metadata.openGraph.url });
  }

  return tags;
}
