export function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function createRootHelp(createUsage) {
  return `Usage: ploykit-module <doctor|check|inspect|create|templates|dev> [...args]

Commands:
  doctor <module-id|module-root|all>     Validate module contracts and source boundaries.
  check [module-id|module-root|all]      Run module doctor over the selected modules.
  inspect <module-id|module-root|all>    Print module path, source hash, and digest metadata.
  create <module-id> [options]           Create a local module from a template.
  templates                              Print available module templates as JSON.
  dev [module-id|module-root|all]        Run dependency, module map, and module check gates.

Create:
  ${createUsage()}
`;
}

export async function runModuleCliCommand(input) {
  const { argv, commands, printHelp, createErrorDiagnostic, onFinally } = input;
  const [, , command, ...args] = argv;

  try {
    if (!command || command === '--help' || command === '-h') {
      printHelp();
      return;
    }

    const handler = commands[command];
    if (!handler) {
      console.error('Unknown command.');
      printHelp();
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
