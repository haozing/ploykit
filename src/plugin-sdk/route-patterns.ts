const DYNAMIC_SEGMENT_RE = /^:[A-Za-z0-9_]+$|^\[[A-Za-z0-9_-]+\]$/;
const CATCH_ALL_SEGMENT_RE = /^\[\.\.\.[A-Za-z0-9_-]+\]$/;

export type PluginRoutePatternConflictReason = 'exact' | 'dynamic' | 'catch_all';

export interface PluginRoutePatternConflict {
  firstPath: string;
  secondPath: string;
  samplePath: string;
  reason: PluginRoutePatternConflictReason;
}

export function normalizePluginRoutePath(routePath: string): string {
  const normalized = `/${routePath.trim()}`
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/\/$/, '');

  return normalized === '' ? '/' : normalized;
}

export function isPluginRouteDynamicSegment(segment: string): boolean {
  return DYNAMIC_SEGMENT_RE.test(segment);
}

export function isPluginRouteCatchAllSegment(segment: string): boolean {
  return CATCH_ALL_SEGMENT_RE.test(segment);
}

function splitRouteSegments(routePath: string): string[] {
  const normalized = normalizePluginRoutePath(routePath);
  return normalized === '/' ? [] : normalized.slice(1).split('/');
}

function isDynamicLikeSegment(segment: string): boolean {
  return isPluginRouteDynamicSegment(segment) || isPluginRouteCatchAllSegment(segment);
}

function sampleSegment(first: string, second: string): string | null {
  const firstDynamic = isDynamicLikeSegment(first);
  const secondDynamic = isDynamicLikeSegment(second);

  if (!firstDynamic && !secondDynamic) {
    return first === second ? first : null;
  }

  if (!firstDynamic) {
    return first;
  }

  if (!secondDynamic) {
    return second;
  }

  return 'value';
}

function sampleSegments(segments: readonly string[]): string[] {
  return segments.map((segment, index) =>
    isDynamicLikeSegment(segment) ? `value${index === 0 ? '' : index + 1}` : segment
  );
}

function toSamplePath(segments: readonly string[]): string {
  return segments.length === 0 ? '/' : `/${segments.join('/')}`;
}

export function findPluginRoutePatternConflict(
  firstPath: string,
  secondPath: string
): PluginRoutePatternConflict | null {
  const firstNormalized = normalizePluginRoutePath(firstPath);
  const secondNormalized = normalizePluginRoutePath(secondPath);

  if (firstNormalized === secondNormalized) {
    return {
      firstPath: firstNormalized,
      secondPath: secondNormalized,
      samplePath: firstNormalized,
      reason: 'exact',
    };
  }

  const firstSegments = splitRouteSegments(firstNormalized);
  const secondSegments = splitRouteSegments(secondNormalized);
  const sample: string[] = [];
  const sharedLength = Math.min(firstSegments.length, secondSegments.length);

  for (let index = 0; index < sharedLength; index += 1) {
    const firstSegment = firstSegments[index];
    const secondSegment = secondSegments[index];
    const firstCatchAll = isPluginRouteCatchAllSegment(firstSegment);
    const secondCatchAll = isPluginRouteCatchAllSegment(secondSegment);

    if (firstCatchAll || secondCatchAll) {
      const remaining = firstCatchAll ? secondSegments.slice(index) : firstSegments.slice(index);
      return {
        firstPath: firstNormalized,
        secondPath: secondNormalized,
        samplePath: toSamplePath([
          ...sample,
          ...sampleSegments(remaining.length ? remaining : ['value']),
        ]),
        reason: 'catch_all',
      };
    }

    const segment = sampleSegment(firstSegment, secondSegment);
    if (!segment) {
      return null;
    }

    sample.push(segment);
  }

  if (firstSegments.length !== secondSegments.length) {
    return null;
  }

  return {
    firstPath: firstNormalized,
    secondPath: secondNormalized,
    samplePath: toSamplePath(sample),
    reason: 'dynamic',
  };
}
