export function moduleDataPhysicalTableName(moduleId: string, tableName: string): string {
  return `mod_${moduleId.replace(/-/g, '_')}__${tableName}`;
}

export function moduleDataPhysicalViewName(moduleId: string, viewName: string): string {
  return `${moduleDataPhysicalTableName(moduleId, viewName)}_view`;
}
