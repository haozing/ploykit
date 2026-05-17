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
        <svg
          width="72"
          height="72"
          viewBox="0 0 96 96"
          aria-label="PloyKit mark"
          style={{
            width: 72,
            height: 72,
          }}
        >
          <rect x="8" y="8" width="80" height="80" rx="18" fill="#0f172a" />
          <path
            d="M28 66V30h22c9 0 16 6 16 15s-7 15-16 15H39v6H28Zm11-16h10c4 0 7-2 7-5s-3-5-7-5H39v10Z"
            fill="#f8fafc"
          />
          <circle cx="69" cy="26" r="6" fill="#14b8a6" />
          <circle cx="74" cy="70" r="6" fill="#f59e0b" />
          <path d="M64 31l-9 9M60 57l10 9" stroke="#e2e8f0" strokeWidth="4" strokeLinecap="round" />
        </svg>
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
    </div>,
    size
  );
}
