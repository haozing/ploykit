export type EventClass = 'critical' | 'standard' | 'best-effort';

export interface EventClassRule {
  pattern: string;
  eventClass: EventClass;
  reason: string;
}

export const EVENT_CLASS_RULES: readonly EventClassRule[] = [
  {
    pattern: 'billing.*',
    eventClass: 'critical',
    reason: 'Billing, order, invoice, payment, and subscription events affect entitlement state.',
  },
  {
    pattern: 'webhook.*',
    eventClass: 'critical',
    reason: 'Webhook receipt and processing events must be recoverable.',
  },
  {
    pattern: 'plugin.installed',
    eventClass: 'critical',
    reason: 'Plugin lifecycle changes are platform state changes.',
  },
  {
    pattern: 'plugin.enabled',
    eventClass: 'critical',
    reason: 'Plugin lifecycle changes are platform state changes.',
  },
  {
    pattern: 'plugin.disabled',
    eventClass: 'critical',
    reason: 'Plugin lifecycle changes are platform state changes.',
  },
  {
    pattern: 'plugin.uninstalled',
    eventClass: 'critical',
    reason: 'Plugin lifecycle changes are platform state changes.',
  },
  {
    pattern: 'audit.*',
    eventClass: 'critical',
    reason: 'Audit trail events must not be silently dropped.',
  },
  {
    pattern: 'usage.*',
    eventClass: 'critical',
    reason: 'Metered usage affects quota and billing.',
  },
  {
    pattern: 'debug.*',
    eventClass: 'best-effort',
    reason: 'Debug events should never affect production critical paths.',
  },
];

function ruleMatches(pattern: string, event: string): boolean {
  if (pattern.endsWith('.*')) {
    return event.startsWith(pattern.slice(0, -1));
  }

  return pattern === event;
}

export function getEventClass(event: string): EventClass {
  return (
    EVENT_CLASS_RULES.find((rule) => ruleMatches(rule.pattern, event))?.eventClass ?? 'standard'
  );
}

export function getEventClassRule(event: string): EventClassRule | undefined {
  return EVENT_CLASS_RULES.find((rule) => ruleMatches(rule.pattern, event));
}

export function describeEventClassification(): {
  defaultClass: EventClass;
  rules: readonly EventClassRule[];
} {
  return {
    defaultClass: 'standard',
    rules: EVENT_CLASS_RULES,
  };
}
