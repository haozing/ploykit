import Link from 'next/link';
import { cn } from './cn';

export function Tabs({
  tabs,
  active,
}: {
  tabs: readonly { id: string; label: string; href?: string }[];
  active?: string;
}) {
  const activeId = active ?? tabs[0]?.id;
  return (
    <div className="flex flex-wrap gap-2 border-b border-border" role="tablist">
      {tabs.map((tab) => {
        const selected = activeId === tab.id;
        const className = cn(
          'inline-flex min-h-9 items-center border-b-2 px-3 py-2 text-sm font-semibold transition',
          selected
            ? 'border-primary text-foreground'
            : 'border-transparent text-muted-foreground hover:text-foreground'
        );
        return tab.href ? (
          <Link
            key={tab.id}
            href={tab.href}
            className={className}
            role="tab"
            aria-selected={selected}
          >
            {tab.label}
          </Link>
        ) : (
          <button
            key={tab.id}
            type="button"
            className={className}
            role="tab"
            aria-selected={selected}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
