'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import {
  resolveHostClientTransitionHref,
  type HostClientTransitionArea,
} from '@host/lib/client-transition-links';

export function ClientTransitionLinks({ area }: { area: HostClientTransitionArea }) {
  const router = useRouter();

  useEffect(() => {
    function handleClick(event: MouseEvent) {
      if (!(event.target instanceof Element)) {
        return;
      }
      const anchor = event.target.closest<HTMLAnchorElement>('a[href]');
      if (!anchor) {
        return;
      }
      const frame = anchor.closest<HTMLElement>('[data-host-app-frame]');
      if (frame?.dataset.hostAppFrame !== area) {
        return;
      }

      const decision = resolveHostClientTransitionHref({
        area,
        href: anchor.getAttribute('href') ?? '',
        currentUrl: window.location.href,
        button: event.button,
        defaultPrevented: event.defaultPrevented,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        target: anchor.getAttribute('target'),
        download: anchor.hasAttribute('download'),
      });

      if (!decision.shouldNavigate || !decision.href) {
        return;
      }

      event.preventDefault();
      router.push(decision.href);
    }

    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, [area, router]);

  return <span data-host-client-transition-links={area} hidden aria-hidden="true" />;
}
