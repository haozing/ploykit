export interface HostAuthStatus {
  mode: 'runtime-store-signed-cookie';
  durable: boolean;
  userStore: 'runtime-store';
  rbac: 'role-permissions';
  secretConfigured: boolean;
  keyRing: 'configured' | 'volatile-dev';
}

export interface HostSecurityStatus {
  csrf: 'host-main-path';
  origin: 'host-main-path';
  rateLimit: 'host-main-path';
  routeCatalog: 'configured';
  headers: 'host-main-path';
}

function hasHostAuthKeyRingConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.PLOYKIT_AUTH_KEY_REFS?.trim() || env.PLOYKIT_AUTH_SECRET_REF?.trim());
}

export function getHostAuthStatus(durable = Boolean(process.env.DATABASE_URL ?? process.env.POSTGRES_URL)): HostAuthStatus {
  const keyRingConfigured = hasHostAuthKeyRingConfigured();
  return {
    mode: 'runtime-store-signed-cookie',
    durable,
    userStore: 'runtime-store',
    rbac: 'role-permissions',
    secretConfigured: keyRingConfigured,
    keyRing: keyRingConfigured ? 'configured' : 'volatile-dev',
  };
}

export function getHostSecurityStatus(): HostSecurityStatus {
  return {
    csrf: 'host-main-path',
    origin: 'host-main-path',
    rateLimit: 'host-main-path',
    routeCatalog: 'configured',
    headers: 'host-main-path',
  };
}
