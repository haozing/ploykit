import Link from 'next/link';
import type { ComponentType, ReactNode } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { cn } from './cn';

type StatTone = 'neutral' | 'blue' | 'amber' | 'green' | 'red';

const iconClass: Record<StatTone, string> = {
  neutral: 'bg-admin-surface-muted text-admin-text-muted ring-admin-border',
  blue: 'bg-admin-primary-soft text-admin-primary ring-admin-primary/15',
  amber: 'bg-admin-warning/10 text-admin-warning ring-admin-warning/15',
  green: 'bg-admin-success/10 text-admin-success ring-admin-success/15',
  red: 'bg-admin-danger/10 text-admin-danger ring-admin-danger/15',
};

const trendClass: Record<StatTone, string> = {
  neutral: 'text-admin-text-muted',
  blue: 'text-admin-primary',
  amber: 'text-admin-warning',
  green: 'text-admin-success',
  red: 'text-admin-danger',
};

const sparklineClass: Record<StatTone, string> = {
  neutral: 'text-admin-text-subtle',
  blue: 'text-admin-primary/80',
  amber: 'text-admin-warning/80',
  green: 'text-admin-success/80',
  red: 'text-admin-danger/80',
};

function buildSparklinePath(values: readonly number[], width: number, height: number): string {
  if (values.length === 0) {
    return '';
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const points = values.map((value, index) => {
    const x = values.length === 1 ? width / 2 : (index / (values.length - 1)) * width;
    const y = height - 2 - ((value - min) / range) * (height - 4);
    return { x, y };
  });
  if (points.length === 1) {
    return `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  }
  return points.reduce((path, point, index) => {
    if (index === 0) {
      return `M ${point.x.toFixed(1)} ${point.y.toFixed(1)}`;
    }
    const previous = points[index - 1];
    const controlX = (previous.x + point.x) / 2;
    return `${path} Q ${controlX.toFixed(1)} ${previous.y.toFixed(1)} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`;
  }, '');
}

export interface StatCardProps {
  label: string;
  value: string;
  tone?: StatTone;
  helper?: ReactNode;
  trend?: ReactNode;
  sparkline?: readonly number[];
  href?: string;
  icon?: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
  className?: string;
}

export function StatCard({
  label,
  value,
  tone = 'neutral',
  helper,
  trend,
  sparkline,
  href,
  icon: Icon,
  className,
}: StatCardProps) {
  const content = (
    <article
      className={cn(
        'group relative min-h-[96px] overflow-hidden rounded-admin-md border border-admin-border bg-admin-surface p-3 text-admin-text shadow-admin-card transition duration-150 sm:min-h-[120px] sm:p-5',
        href && 'hover:border-admin-primary/25 hover:shadow-admin-popover',
        className
      )}
    >
      <div className={cn('min-w-0', trend && 'pr-14 sm:pr-0', sparkline && 'sm:pr-28')}>
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          {Icon ? (
            <span className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-md ring-1 sm:h-10 sm:w-10', iconClass[tone])}>
              <Icon className="h-3.5 w-3.5 sm:h-4 sm:w-4" aria-hidden />
            </span>
          ) : null}
          <span className="min-w-0 text-[13px] font-semibold leading-4 tracking-normal text-admin-text sm:text-sm sm:leading-5">
            {label}
          </span>
        </div>
        <strong className="mt-1.5 block truncate text-[24px] font-bold leading-8 tracking-normal text-admin-text sm:mt-3 sm:text-[28px]">
          {value}
        </strong>
        {helper ? (
          <span
            className={cn(
              'mt-1.5 block min-w-0 text-xs leading-4 text-admin-text-muted sm:mt-3 sm:truncate sm:leading-5',
              sparkline && 'max-w-[calc(100%-3.25rem)] sm:max-w-none'
            )}
          >
            {helper}
          </span>
        ) : null}
      </div>
      {trend ? (
        <span
          className={cn(
            'absolute right-3 top-3 max-w-16 truncate rounded-full bg-admin-bg px-2 py-0.5 text-[11px] font-semibold leading-5 ring-1 ring-admin-border sm:right-5 sm:top-5 sm:max-w-24',
            trendClass[tone]
          )}
        >
          {trend}
        </span>
      ) : null}
      {sparkline && sparkline.length > 0 ? (
        <svg
          viewBox="0 0 96 32"
          className={cn('pointer-events-none absolute bottom-3 right-3 h-5 w-12 opacity-80 sm:bottom-5 sm:right-5 sm:h-8 sm:w-24', sparklineClass[tone])}
          aria-hidden
          preserveAspectRatio="none"
        >
          <path
            d={buildSparklinePath(sparkline, 96, 32)}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : null}
      {href && !sparkline ? (
        <ArrowUpRight
          className="absolute bottom-3 right-3 h-3.5 w-3.5 text-admin-text-muted opacity-0 transition group-hover:opacity-100"
          aria-hidden
        />
      ) : null}
    </article>
  );

  return href ? (
    <Link href={href} className="block focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary">
      {content}
    </Link>
  ) : (
    content
  );
}

export const MetricCard = StatCard;
