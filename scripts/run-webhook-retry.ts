/* eslint-disable no-console */
import { retryPendingWebhookReceipts } from '@/lib/webhooks';

function readNumberArg(name: string): number | undefined {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  const value = inline ? inline.slice(prefix.length) : undefined;

  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`--${name} must be a positive integer.`);
  }

  return parsed;
}

async function main(): Promise<void> {
  const results = await retryPendingWebhookReceipts({
    limit: readNumberArg('limit'),
    maxAttempts: readNumberArg('max-attempts'),
  });

  console.log(
    JSON.stringify(
      {
        success: results.every((result) => result.success),
        processed: results.length,
        succeeded: results.filter((result) => result.success).length,
        failed: results.filter((result) => !result.success).length,
        results,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
