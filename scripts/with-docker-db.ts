import { spawn } from 'child_process';
import { getDockerDatabaseUrl, loadDockerDbEnv, maskDatabaseUrl } from './docker-db-env';

const args = process.argv.slice(2);
const commandArgs = args[0] === '--' ? args.slice(1) : args;

if (commandArgs.length === 0) {
  console.error('Usage: tsx scripts/with-docker-db.ts -- <command> [args...]');
  process.exit(1);
}

const env = loadDockerDbEnv();
const [command, ...commandRest] = commandArgs;

function resolveSpawnCommand(
  name: string,
  args: string[],
  spawnEnv: NodeJS.ProcessEnv
): { file: string; args: string[] } {
  if (process.platform === 'win32' && name === 'npm' && spawnEnv.npm_execpath) {
    return {
      file: process.execPath,
      args: [spawnEnv.npm_execpath, ...args],
    };
  }

  return { file: name, args };
}

console.log(`Using Docker database: ${maskDatabaseUrl(getDockerDatabaseUrl(env))}`);

const resolved = resolveSpawnCommand(command, commandRest, env);
const child = spawn(resolved.file, resolved.args, {
  env,
  stdio: 'inherit',
});

child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`Command terminated by signal: ${signal}`);
    process.exit(1);
  }

  process.exit(code ?? 0);
});

child.on('error', (error) => {
  console.error(`Failed to start command: ${error.message}`);
  process.exit(1);
});
