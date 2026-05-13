import postgres from 'postgres';
import { getDockerDatabaseUrl, loadDockerDbEnv, maskDatabaseUrl } from './docker-db-env';

const env = loadDockerDbEnv();
const databaseUrl = getDockerDatabaseUrl(env);
const maxAttempts = Number(process.env.PLOYKIT_DOCKER_DB_WAIT_ATTEMPTS || 60);
const delayMs = Number(process.env.PLOYKIT_DOCKER_DB_WAIT_DELAY_MS || 1000);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForDockerDb(): Promise<void> {
  console.log(`Waiting for Docker database: ${maskDatabaseUrl(databaseUrl)}`);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const sql = postgres(databaseUrl, {
      connect_timeout: 2,
      max: 1,
      ssl: false,
    });

    try {
      await sql`select 1`;
      await sql.end();
      console.log(`Docker database is ready after ${attempt} attempt(s)`);
      return;
    } catch (error) {
      await sql.end({ timeout: 1 }).catch(() => undefined);

      if (attempt === maxAttempts) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Docker database is not ready: ${message}`);
      }

      await sleep(delayMs);
    }
  }
}

waitForDockerDb().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
