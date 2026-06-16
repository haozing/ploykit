export const MODULE_DATA_CLI_USAGE =
  'Usage: module-data <plan|generate|migrate|types|verify|verify-db|reset> [...args] [--app-database-url <url>] [--require-app-role-safety]';

export async function runModuleDataCliCommand(input) {
  const {
    argv,
    commands,
    createErrorDiagnostic,
    onFinally,
    printJson,
    printUsage = (usage) => console.error(usage),
    usage = MODULE_DATA_CLI_USAGE,
  } = input;
  const [, , command, ...args] = argv;

  try {
    const handler = commands[command];
    if (!handler) {
      printUsage(usage);
      process.exitCode = 1;
      return;
    }

    await handler(args);
  } catch (error) {
    printJson({
      success: false,
      diagnostics: [createErrorDiagnostic(error)],
    });
    process.exitCode = 1;
  } finally {
    await onFinally?.();
  }
}
