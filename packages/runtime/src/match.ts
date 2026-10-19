import type { PageSpec } from './routes'

// Router-agnostic route-pattern matcher used by hydration as the DEFAULT
// pathname → pageId resolver. It understands exactly the pattern syntax that
// `routeTable` / `PageSpec.path` carries (and therefore what react-router and
// TanStack Router path strings also spell): static segments, `:param`
// segments, and a trailing `*` catch-all.
//
// Semantics:
// - Paths and patterns are split on '/', empty segments are ignored, so
//   trailing slashes are tolerated (`/blog/hello/` === `/blog/hello`) and
//   repeated slashes collapse.
// - `:param` matches exactly one non-empty segment (segments are non-empty by
//   construction after filtering). The captured value is not used here; this
//   matcher only answers "which page owns this payload".
// - `*` matches one-or-more remaining segments. It must be the final pattern
//   segment; `/*` matches every path except `/`. A non-final `*` is not
//   recognized as a catch-all and is handled as a literal segment (malformed
//   patterns therefore fail closed).
// - Matching is case-sensitive and literal; no decodeURI is applied and no
//   regex is built from the path, so parameter values may contain anything
//   except '/' (dots, percent escapes, unicode, ...).
// - Most-specific wins, compared in order: (1) more static (literal) segments,
//   (2) more pattern segments, (3) non-catch-all over catch-all. Exact ties
//   resolve to the earliest declared page, which makes the result deterministic.

/** Returns the pageId of the most specific page whose pattern matches pathname, or null. */
export function matchPageByPath(
  pathname: string,
  pages: ReadonlyArray<PageSpec>,
): string | null {
  const pathSegments = splitSegments(pathname)
  let bestPageId: string | null = null
  let bestSegments: string[] = []
  let bestStaticCount = -1

  for (const page of pages) {
    const patternSegments = splitSegments(page.path)
    if (!matchesPattern(patternSegments, pathSegments)) continue

    const staticCount = countStaticSegments(patternSegments)
    if (bestPageId === null || isMoreSpecific(patternSegments, staticCount, bestSegments, bestStaticCount)) {
      bestPageId = page.pageId
      bestSegments = patternSegments
      bestStaticCount = staticCount
    }
  }

  return bestPageId
}

function splitSegments(value: string): string[] {
  return value.split('/').filter((segment) => segment.length > 0)
}

function isParamSegment(segment: string): boolean {
  return segment.length > 1 && segment[0] === ':'
}

function countStaticSegments(segments: string[]): number {
  let count = 0
  for (const segment of segments) {
    if (segment !== '*' && !isParamSegment(segment)) count++
  }
  return count
}

function isCatchAll(segments: string[]): boolean {
  return segments.length > 0 && segments[segments.length - 1] === '*'
}

function matchesPattern(pattern: string[], path: string[]): boolean {
  if (isCatchAll(pattern)) {
    // `*` consumes one-or-more remaining segments, so the path must be at
    // least as long as the pattern. A non-final `*` is not recognized as a
    // catch-all and falls through to the exact-length branch below, where it
    // only matches a literal '*' segment (fail closed for malformed patterns).
    if (path.length < pattern.length) return false
    const params = pattern.length - 1
    for (let i = 0; i < params; i++) {
      if (!segmentMatches(pattern[i]!, path[i]!)) return false
    }
    return true
  }
  if (path.length !== pattern.length) return false
  for (let i = 0; i < pattern.length; i++) {
    if (!segmentMatches(pattern[i]!, path[i]!)) return false
  }
  return true
}

function segmentMatches(pattern: string, path: string): boolean {
  if (isParamSegment(pattern)) return true
  return pattern === path
}

// `a` is more specific than `b`: more static segments, then more segments,
// then a non-catch-all over a catch-all. Strict comparisons only — equality
// leaves the earlier-declared page in place.
function isMoreSpecific(
  aSegments: string[],
  aStaticCount: number,
  bSegments: string[],
  bStaticCount: number,
): boolean {
  if (aStaticCount !== bStaticCount) return aStaticCount > bStaticCount
  if (aSegments.length !== bSegments.length) return aSegments.length > bSegments.length
  return !isCatchAll(aSegments) && isCatchAll(bSegments)
}
