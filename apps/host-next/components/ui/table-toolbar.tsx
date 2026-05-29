import { Button, ButtonLink } from './button';
import { cn } from './cn';
import { Input, Select } from './form';
import { adminInlineText } from '@host/lib/admin-inline-i18n';
import type { SupportedLanguage } from '@host/lib/i18n';

export function TableToolbar({
  lang = 'zh',
  searchName = 'q',
  searchValue = '',
  searchPlaceholder,
  filterName = 'status',
  filterValue = '',
  filterLabel,
  filterOptions = [],
  resetHref,
  embedded = false,
}: {
  lang?: SupportedLanguage;
  searchName?: string;
  searchValue?: string;
  searchPlaceholder?: string;
  filterName?: string;
  filterValue?: string;
  filterLabel?: string;
  filterOptions?: readonly { value: string; label: string }[];
  resetHref?: string;
  embedded?: boolean;
}) {
  const hasActiveQuery = searchValue.length > 0 || filterValue.length > 0;
  const effectiveSearchPlaceholder = searchPlaceholder ?? adminInlineText(lang, 'Search');
  const effectiveFilterLabel = filterLabel ?? adminInlineText(lang, 'Status');
  return (
    <form
      method="get"
      className={cn(
        'flex flex-col gap-3 sm:flex-row sm:items-end',
        embedded
          ? 'border-b border-admin-border bg-admin-bg/35 px-4 py-3 sm:px-5'
          : 'rounded-admin-md border border-admin-border bg-admin-surface p-4 shadow-sm shadow-slate-950/5'
      )}
    >
      <label className="grid flex-1 gap-2 text-sm font-medium text-admin-text">
        <span className="text-xs font-semibold uppercase text-admin-text-subtle">
          {adminInlineText(lang, 'Search')}
        </span>
        <Input
          type="search"
          name={searchName}
          defaultValue={searchValue}
          placeholder={effectiveSearchPlaceholder}
          aria-label={effectiveSearchPlaceholder}
        />
      </label>
      {filterOptions.length > 0 ? (
        <label className="grid gap-2 text-sm font-medium text-admin-text sm:w-56">
          <span className="text-xs font-semibold uppercase text-admin-text-subtle">{effectiveFilterLabel}</span>
          <Select name={filterName} defaultValue={filterValue} aria-label={effectiveFilterLabel}>
            <option value="">{adminInlineText(lang, 'All')}</option>
            {filterOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </label>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" size="small">
          {adminInlineText(lang, 'Filter')}
        </Button>
        {hasActiveQuery && resetHref ? (
          <ButtonLink href={resetHref} variant="ghost" size="small">
            {adminInlineText(lang, 'Clear')}
          </ButtonLink>
        ) : null}
      </div>
    </form>
  );
}
