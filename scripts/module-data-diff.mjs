import childProcess from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const PROJECT_ROOT = process.cwd();

function slash(value) {
  return value.replace(/\\/g, '/');
}

function toProjectPath(file) {
  return slash(path.relative(PROJECT_ROOT, file));
}

function runPlan(target) {
  const result = childProcess.spawnSync(
    process.execPath,
    ['scripts/module-data.mjs', 'plan', target],
    {
      cwd: PROJECT_ROOT,
      encoding: 'utf8',
    }
  );
  if (result.status !== 0) {
    throw new Error(result.stdout || result.stderr || 'data plan failed');
  }
  return JSON.parse(result.stdout);
}

function readBaseline(moduleRoot) {
  const file = path.join(PROJECT_ROOT, moduleRoot, '.ploykit', 'generated', 'data-plan.json');
  if (!fs.existsSync(file)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function mapByName(items = []) {
  return new Map(items.map((item) => [item.name, item]));
}

function canonical(value) {
  return JSON.stringify(value ?? null);
}

function addChange(changes, kind, pathValue, message, details = {}) {
  changes.push({ kind, path: pathValue, message, details });
}

function compareNamedMaps(changes, beforeMap, afterMap, basePath, label) {
  for (const [name, after] of afterMap) {
    if (!beforeMap.has(name)) {
      addChange(changes, 'additive', `${basePath}.${name}`, `${label} "${name}" will be added.`, {
        after,
      });
    }
  }

  for (const [name, before] of beforeMap) {
    if (!afterMap.has(name)) {
      addChange(
        changes,
        'destructive',
        `${basePath}.${name}`,
        `${label} "${name}" was removed and requires explicit review.`,
        { before }
      );
    }
  }
}

function compareScalar(changes, before, after, pathValue, label, kind = 'manual_review') {
  if (canonical(before) === canonical(after)) {
    return;
  }
  addChange(changes, kind, pathValue, `${label} changed and requires review.`, {
    before,
    after,
  });
}

function compareGroups(changes, beforeGroups = [], afterGroups = [], basePath, label, addKind) {
  const beforeMap = new Map(beforeGroups.map((group) => [canonical(group), group]));
  const afterMap = new Map(afterGroups.map((group) => [canonical(group), group]));

  for (const [key, after] of afterMap) {
    if (!beforeMap.has(key)) {
      addChange(changes, addKind, `${basePath}.${after.join('_')}`, `${label} will be added.`, {
        after,
      });
    }
  }

  for (const [key, before] of beforeMap) {
    if (!afterMap.has(key)) {
      addChange(
        changes,
        'destructive',
        `${basePath}.${before.join('_')}`,
        `${label} was removed and requires explicit review.`,
        { before }
      );
    }
  }
}

function compareFields(changes, beforeFields = {}, afterFields = {}, basePath, label) {
  const beforeMap = new Map(Object.entries(beforeFields));
  const afterMap = new Map(Object.entries(afterFields));
  compareNamedMaps(changes, beforeMap, afterMap, basePath, label);

  for (const [name, before] of beforeMap) {
    const after = afterMap.get(name);
    if (!after) {
      continue;
    }
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      addChange(
        changes,
        'manual_review',
        `${basePath}.${name}`,
        `${label} "${name}" changed shape and requires review.`,
        { before, after }
      );
    }
  }
}

function compareNamedDefinitions(changes, beforeItems, afterItems, basePath, label) {
  const beforeMap = mapByName(beforeItems);
  const afterMap = mapByName(afterItems);
  compareNamedMaps(changes, beforeMap, afterMap, basePath, label);

  for (const [name, before] of beforeMap) {
    const after = afterMap.get(name);
    if (!after) {
      continue;
    }
    if (canonical(before.definition) !== canonical(after.definition)) {
      addChange(
        changes,
        'manual_review',
        `${basePath}.${name}`,
        `${label} "${name}" changed shape and requires review.`,
        { before: before.definition, after: after.definition }
      );
    }
  }
}

function compareRelationMaps(changes, beforeRelations = {}, afterRelations = {}, basePath) {
  const beforeMap = new Map(Object.entries(beforeRelations));
  const afterMap = new Map(Object.entries(afterRelations));

  for (const [name, after] of afterMap) {
    if (!beforeMap.has(name)) {
      addChange(
        changes,
        'manual_review',
        `${basePath}.${name}`,
        `Relation "${name}" will be added and requires review.`,
        { after }
      );
    }
  }

  for (const [name, before] of beforeMap) {
    if (!afterMap.has(name)) {
      addChange(
        changes,
        'destructive',
        `${basePath}.${name}`,
        `Relation "${name}" was removed and requires explicit review.`,
        { before }
      );
    }
  }

  for (const [name, before] of beforeMap) {
    const after = afterMap.get(name);
    if (after && canonical(before) !== canonical(after)) {
      addChange(
        changes,
        'manual_review',
        `${basePath}.${name}`,
        `Relation "${name}" changed shape and requires review.`,
        { before, after }
      );
    }
  }
}

function diffPlan(before, after) {
  const changes = [];
  const beforeTables = mapByName(before?.tables);
  const afterTables = mapByName(after.tables);
  const beforeDocuments = mapByName(before?.documents);
  const afterDocuments = mapByName(after.documents);

  compareScalar(changes, before?.dataVersion, after.dataVersion, 'dataVersion', 'Data version');
  compareScalar(changes, before?.migrations, after.migrations, 'migrations', 'Migration policy');

  compareNamedMaps(changes, beforeTables, afterTables, 'tables', 'Table');
  compareNamedMaps(changes, beforeDocuments, afterDocuments, 'documents', 'Document');

  for (const [name, beforeTable] of beforeTables) {
    const afterTable = afterTables.get(name);
    if (afterTable) {
      compareScalar(
        changes,
        beforeTable.scope,
        afterTable.scope,
        `tables.${name}.scope`,
        `Table "${name}" scope`
      );
      compareFields(
        changes,
        beforeTable.columns,
        afterTable.columns,
        `tables.${name}.columns`,
        'Column'
      );
      compareGroups(
        changes,
        beforeTable.indexes,
        afterTable.indexes,
        `tables.${name}.indexes`,
        `Table "${name}" index`,
        'additive'
      );
      compareGroups(
        changes,
        beforeTable.unique,
        afterTable.unique,
        `tables.${name}.unique`,
        `Table "${name}" unique constraint`,
        'manual_review'
      );
      compareRelationMaps(
        changes,
        beforeTable.relations,
        afterTable.relations,
        `tables.${name}.relations`
      );
    }
  }

  for (const [name, beforeDocument] of beforeDocuments) {
    const afterDocument = afterDocuments.get(name);
    if (afterDocument) {
      compareScalar(
        changes,
        beforeDocument.scope,
        afterDocument.scope,
        `documents.${name}.scope`,
        `Document "${name}" scope`
      );
      compareFields(
        changes,
        beforeDocument.fields,
        afterDocument.fields,
        `documents.${name}.fields`,
        'Document field'
      );
      compareScalar(
        changes,
        beforeDocument.indexes,
        afterDocument.indexes,
        `documents.${name}.indexes`,
        `Document "${name}" indexes`
      );
    }
  }

  compareNamedDefinitions(changes, before?.views, after.views, 'views', 'View');
  compareNamedDefinitions(changes, before?.grants, after.grants, 'grants', 'Grant');
  compareNamedDefinitions(changes, before?.checks, after.checks, 'checks', 'Check');

  if (changes.length === 0 && before?.schemaHash && before.schemaHash !== after.schemaHash) {
    addChange(
      changes,
      'manual_review',
      'schemaHash',
      'Schema hash changed outside known diff dimensions and requires review.',
      { before: before.schemaHash, after: after.schemaHash }
    );
  }

  return changes;
}

function main() {
  const target = process.argv[2] ?? 'modules';
  const planResult = runPlan(target);
  const modules = (planResult.modules ?? [])
    .filter((plan) => plan && plan.hasData !== false && plan.plan !== null)
    .map((plan) => {
    const baseline = readBaseline(plan.moduleRoot);
    const changes = baseline
      ? diffPlan(baseline, plan)
      : [
          {
            kind: 'additive',
            path: 'module',
            message: 'No generated baseline exists; the whole data plan is new.',
            details: { after: plan },
          },
        ];
    return {
      moduleId: plan.moduleId,
      moduleRoot: plan.moduleRoot,
      baseline: baseline
        ? toProjectPath(
            path.join(PROJECT_ROOT, plan.moduleRoot, '.ploykit/generated/data-plan.json')
          )
        : null,
      changes,
      destructive: changes.filter((change) => change.kind === 'destructive'),
      manualReview: changes.filter((change) => change.kind === 'manual_review'),
    };
  });
  const success = modules.every(
    (moduleResult) =>
      moduleResult.destructive.length === 0 && moduleResult.manualReview.length === 0
  );

  process.stdout.write(
    `${JSON.stringify(
      {
        success,
        mode: 'diff',
        modules,
      },
      null,
      2
    )}\n`
  );

  if (!success) {
    process.exitCode = 1;
  }
}

main();
