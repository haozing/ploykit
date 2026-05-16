export const PLATFORM_PRIMARY_CREDIT_METRIC = 'platform.credits';
export const PLATFORM_OUTPUT_QUALITY_CAPABILITY = 'platform.outputQuality';

const METRIC_LABELS: Record<string, string> = {
  'platform.users': 'Users',
  'platform.plugins': 'Plugins',
  'platform.roles': 'Roles',
  'platform.storageBytes': 'Storage',
  'platform.apiCalls': 'API Calls',
  [PLATFORM_PRIMARY_CREDIT_METRIC]: 'Credits',
};

const METRIC_UNITS: Record<string, string> = {
  'platform.users': 'users',
  'platform.plugins': 'plugins',
  'platform.roles': 'roles',
  'platform.storageBytes': 'bytes',
  'platform.apiCalls': 'calls/month',
  [PLATFORM_PRIMARY_CREDIT_METRIC]: 'credits/month',
};

export function formatBillingMetricName(key: string): string {
  return METRIC_LABELS[key] ?? formatCapabilityKey(key);
}

export function getBillingMetricUnit(key: string): string {
  return METRIC_UNITS[key] ?? '';
}

export function formatCapabilityKey(key: string): string {
  return key
    .split('.')
    .map((segment) => segment.replace(/([A-Z])/g, ' $1').replace(/^./, (str) => str.toUpperCase()))
    .join(' / ');
}
