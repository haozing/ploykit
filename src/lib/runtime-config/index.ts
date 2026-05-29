export type RuntimeAuthProvider = 'none' | 'host' | 'oidc';

export interface RuntimeConfig {
  databaseUrl: string;
  hostUrl: string;
  authProvider: RuntimeAuthProvider;
  runtimeFlags: Record<string, boolean>;
}

export interface RuntimeConfigDiagnostic {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  path: string;
  fix?: string;
}

export interface LoadRuntimeConfigResult {
  ok: boolean;
  config?: RuntimeConfig;
  diagnostics: RuntimeConfigDiagnostic[];
}

function diagnostic(
  code: string,
  message: string,
  path: string,
  fix?: string
): RuntimeConfigDiagnostic {
  return { severity: 'error', code, message, path, fix };
}

function parseFlags(value: string | undefined): Record<string, boolean> {
  if (!value) {
    return {};
  }

  return Object.fromEntries(
    value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const [key, rawValue = 'true'] = entry.split('=');
        return [key, rawValue !== 'false' && rawValue !== '0'];
      })
  );
}

function isAuthProvider(value: string): value is RuntimeAuthProvider {
  return value === 'none' || value === 'host' || value === 'oidc';
}

export function loadRuntimeConfig(
  env: Record<string, string | undefined> = process.env
): LoadRuntimeConfigResult {
  const diagnostics: RuntimeConfigDiagnostic[] = [];
  const databaseUrl = env.DATABASE_URL ?? env.POSTGRES_URL;
  const hostUrl = env.PLOYKIT_HOST_URL;
  const authProvider = env.PLOYKIT_AUTH_PROVIDER;

  if (!databaseUrl) {
    diagnostics.push(
      diagnostic(
        'RUNTIME_CONFIG_DATABASE_URL_REQUIRED',
        'DATABASE_URL is required.',
        'DATABASE_URL',
        'Set DATABASE_URL or POSTGRES_URL to the Postgres connection string.'
      )
    );
  }

  if (!hostUrl) {
    diagnostics.push(
      diagnostic(
        'RUNTIME_CONFIG_HOST_URL_REQUIRED',
        'PLOYKIT_HOST_URL is required.',
        'PLOYKIT_HOST_URL',
        'Set PLOYKIT_HOST_URL to the canonical host URL.'
      )
    );
  }

  if (!authProvider || !isAuthProvider(authProvider)) {
    diagnostics.push(
      diagnostic(
        'RUNTIME_CONFIG_AUTH_PROVIDER_INVALID',
        'PLOYKIT_AUTH_PROVIDER must be one of none, host, or oidc.',
        'PLOYKIT_AUTH_PROVIDER',
        'Set PLOYKIT_AUTH_PROVIDER=host for product auth integration.'
      )
    );
  }

  if (diagnostics.length > 0) {
    return { ok: false, diagnostics };
  }

  return {
    ok: true,
    config: {
      databaseUrl: databaseUrl as string,
      hostUrl: hostUrl as string,
      authProvider: authProvider as RuntimeAuthProvider,
      runtimeFlags: parseFlags(env.PLOYKIT_RUNTIME_FLAGS),
    },
    diagnostics,
  };
}

export function requireRuntimeConfig(
  env: Record<string, string | undefined> = process.env
): RuntimeConfig {
  const result = loadRuntimeConfig(env);
  if (!result.ok || !result.config) {
    throw new Error(
      `RUNTIME_CONFIG_INVALID: ${result.diagnostics
        .map((item) => `${item.path}: ${item.message}`)
        .join('; ')}`
    );
  }
  return result.config;
}
