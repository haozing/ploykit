export interface HostAuthStatus {
  mode: 'runtime-store-signed-cookie';
  durable: boolean;
  userStore: 'runtime-store';
  rbac: 'role-permissions';
  secretConfigured: boolean;
}

export interface HostSecurityStatus {
  csrf: 'host-main-path';
  origin: 'host-main-path';
  rateLimit: 'host-main-path';
  routeCatalog: 'configured';
  headers: 'host-main-path';
}

export function getHostAuthStatus(durable = Boolean(process.env.DATABASE_URL ?? process.env.POSTGRES_URL)): HostAuthStatus {
  return {
    mode: 'runtime-store-signed-cookie',
    durable,
    userStore: 'runtime-store',
    rbac: 'role-permissions',
    secretConfigured: Boolean(process.env.PLOYKIT_AUTH_SECRET ?? process.env.PLOYKIT_MEDIA_SECRET),
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
