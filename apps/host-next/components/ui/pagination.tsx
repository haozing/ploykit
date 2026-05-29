import { ButtonLink } from './button';

export function Pagination({
  page,
  totalPages,
  previousHref,
  nextHref,
}: {
  page: number;
  totalPages: number;
  previousHref?: string;
  nextHref?: string;
}) {
  return (
    <nav className="flex items-center justify-end gap-3 text-sm text-muted-foreground" aria-label="Pagination">
      {previousHref ? (
        <ButtonLink href={previousHref} variant="ghost" size="small">
          上一页
        </ButtonLink>
      ) : null}
      <span>
        {page} / {Math.max(totalPages, 1)}
      </span>
      {nextHref ? (
        <ButtonLink href={nextHref} variant="ghost" size="small">
          下一页
        </ButtonLink>
      ) : null}
    </nav>
  );
}
