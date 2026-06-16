import { quoteIdentifier, quoteString } from './module-data-sql.mjs';

export function generateResetSql(modulePlan) {
  const blocks = [
    `-- Reset generated Data v2 objects for module ${modulePlan.moduleId}.`,
    `delete from public.module_documents where module_id = ${quoteString(modulePlan.moduleId)};`,
  ];

  for (const table of modulePlan.tables) {
    blocks.push(`drop table if exists public.${quoteIdentifier(table.physicalName)} cascade;`);
  }

  blocks.push(
    `delete from public.module_data_models where module_id = ${quoteString(modulePlan.moduleId)};`,
    `delete from public.module_data_migrations where module_id = ${quoteString(modulePlan.moduleId)};`,
    `delete from public.module_data_grants where module_id = ${quoteString(modulePlan.moduleId)};`,
    `delete from public.module_data_checks where module_id = ${quoteString(modulePlan.moduleId)};`
  );

  return `${blocks.join('\n')}\n`;
}
