import type { MetadataRoute } from 'next';
import { getProductWebManifest } from '@host/lib/presentation/seo-presentation';

export default function manifest(): MetadataRoute.Manifest {
  return getProductWebManifest();
}
