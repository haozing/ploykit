import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { parse } from 'dotenv';

const DEFAULT_DOCKER_DB_ENV: Record<string, string> = {
  NODE_ENV: 'development',
  NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
  BETTER_AUTH_URL: 'http://localhost:3000',
  BETTER_AUTH_SECRET: 'local-docker-dev-secret-change-me-32-chars',
  DB_PROVIDER: 'postgres',
  DATABASE_URL: 'postgresql://ploykit:ploykit@localhost:55432/ploykit',
  POSTGRES_HOST: 'localhost',
  POSTGRES_PORT: '55432',
  POSTGRES_DB: 'ploykit',
  POSTGRES_USER: 'ploykit',
  POSTGRES_PASSWORD: 'ploykit',
  BILLING_ENABLED: 'false',
  FILE_STORAGE_ENABLED: 'true',
  FILE_STORAGE_DRIVER: 'local',
  FILE_STORAGE_LOCAL_ROOT: '.data/blobs',
};

function loadLocalDockerEnvFile(): Record<string, string> {
  const envFile = process.env.PLOYKIT_DOCKER_ENV_FILE || '.env.docker';
  const envPath = resolve(process.cwd(), envFile);

  if (!existsSync(envPath)) {
    return {};
  }

  return parse(readFileSync(envPath));
}

export function loadDockerDbEnv(baseEnv: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return {
    ...baseEnv,
    ...DEFAULT_DOCKER_DB_ENV,
    ...loadLocalDockerEnvFile(),
  };
}

export function getDockerDatabaseUrl(env: NodeJS.ProcessEnv = loadDockerDbEnv()): string {
  const url = env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is required for Docker DB verification');
  }
  return url;
}

export function maskDatabaseUrl(url: string): string {
  return url.replace(/:([^:@/]+)@/, ':****@');
}
