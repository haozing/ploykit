export function parseCommandArgs(args) {
  let targetPath;
  const moduleFilter = new Set();
  const flags = new Set();
  const values = new Map();

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--module') {
      const moduleId = args[index + 1];
      if (!moduleId) {
        throw new Error('Expected module id after --module.');
      }
      moduleFilter.add(moduleId);
      index += 1;
      continue;
    }

    if (arg === '--database-url') {
      const databaseUrl = args[index + 1];
      if (!databaseUrl) {
        throw new Error('Expected database URL after --database-url.');
      }
      values.set('databaseUrl', databaseUrl);
      index += 1;
      continue;
    }

    if (arg === '--app-database-url') {
      const databaseUrl = args[index + 1];
      if (!databaseUrl) {
        throw new Error('Expected database URL after --app-database-url.');
      }
      values.set('appDatabaseUrl', databaseUrl);
      index += 1;
      continue;
    }

    if (arg === '--schema') {
      const schema = args[index + 1];
      if (!schema) {
        throw new Error('Expected schema after --schema.');
      }
      values.set('schema', schema);
      index += 1;
      continue;
    }

    if (arg.startsWith('--')) {
      flags.add(arg.slice(2));
      continue;
    }

    if (!arg.startsWith('--')) {
      targetPath = arg;
    }
  }

  return { targetPath, moduleFilter, flags, values };
}
