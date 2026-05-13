import { ImageResponse } from 'next/og';
import { siteConfig } from '@/site.config';

export const alt = `${siteConfig.name} preview`;
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = 'image/png';

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: 72,
          color: '#111827',
          background: '#f8fafc',
          border: '24px solid #0ea5e9',
          fontFamily: 'Arial, sans-serif',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 24,
            fontSize: 40,
            fontWeight: 700,
          }}
        >
          <div
            style={{
              width: 72,
              height: 72,
              background: '#0ea5e9',
              color: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 12,
            }}
          >
            P
          </div>
          {siteConfig.name}
        </div>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 24,
          }}
        >
          <div
            style={{
              fontSize: 68,
              fontWeight: 800,
              lineHeight: 1.1,
              maxWidth: 900,
            }}
          >
            Plugin-first tool site platform
          </div>
          <div
            style={{
              fontSize: 30,
              color: '#334155',
              maxWidth: 820,
              lineHeight: 1.35,
            }}
          >
            Host capabilities for plugins, billing, files, SEO, jobs, and operations.
          </div>
        </div>
      </div>
    ),
    size
  );
}
