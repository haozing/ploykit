import type { SupportedLanguage } from '@host/lib/i18n';
import { adminInlineText } from '@host/lib/admin-inline-i18n';
import type { AdminModuleDevConsoleView } from '@host/lib/admin-module-dev-console';

export type DevConsoleModuleRow = AdminModuleDevConsoleView['snapshot']['modules'][number];
export type DevConsoleDiagnostic =
  AdminModuleDevConsoleView['diagnosticsByModule'][string][number];

export function moduleRoot(module: DevConsoleModuleRow): string {
  return module.rootDir ?? `modules/${module.id}`;
}

export function moduleRunbook(module: DevConsoleModuleRow): string {
  return `${moduleRoot(module).replace(/\\/g, '/')}/README.md`;
}

export function moduleOwner(module: DevConsoleModuleRow): string {
  const root = moduleRoot(module).replace(/\\/g, '/');
  return root.split('/').filter(Boolean).at(-1) ?? module.id;
}

export function moduleEscalation(
  lang: SupportedLanguage,
  diagnostics: readonly { severity: string; code: string }[]
): string {
  if (diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
    return adminInlineText(lang, 'block_release_and_repair_error_diagnostics_from_the__f4134cd0');
  }
  if (diagnostics.some((diagnostic) => diagnostic.severity === 'warning')) {
    return adminInlineText(lang, 'module_owner_reviews_warnings_and_test_evidence_befo_4e508ce4');
  }
  return adminInlineText(lang, 'standard_owner_review_keep_module_doctor_and_module__82c3ccc4');
}

export function moduleRepairCommands(module: DevConsoleModuleRow): string[] {
  return [
    `npm run module:doctor -- ${module.id}`,
    `npm run module:test -- ${module.id}`,
    'npm run modules:scan',
  ];
}

export function buildAiPromptEntries(view: AdminModuleDevConsoleView) {
  return view.snapshot.modules.map((module) => {
    const diagnostics = view.diagnosticsByModule[module.id] ?? [];
    return {
      moduleId: module.id,
      diagnostics,
      prompt:
        view.report.aiFixPrompts[module.id] ??
        'Use defineModule(), local module handlers and explicit ctx capabilities only.',
    };
  });
}

export function buildAiPromptBundle(view: AdminModuleDevConsoleView): string {
  return JSON.stringify(
    Object.fromEntries(
      buildAiPromptEntries(view).map((entry) => [entry.moduleId, entry.prompt])
    ),
    null,
    2
  );
}

export function buildRepairPacks(lang: SupportedLanguage, view: AdminModuleDevConsoleView) {
  return view.snapshot.modules.map((module) => {
    const diagnostics = view.diagnosticsByModule[module.id] ?? [];
    const prompt =
      view.report.aiFixPrompts[module.id] ??
      'Use defineModule(), local module handlers and explicit ctx capabilities only.';
    const commands = moduleRepairCommands(module);
    return {
      module,
      diagnostics,
      prompt,
      commands,
      pack: JSON.stringify(
        {
          moduleId: module.id,
          owner: moduleOwner(module),
          runbook: moduleRunbook(module),
          escalation: moduleEscalation(lang, diagnostics),
          diagnostics: diagnostics.map((diagnostic) => ({
            severity: diagnostic.severity,
            code: diagnostic.code,
            message: diagnostic.message,
            path: diagnostic.path,
          })),
          prompt,
          commands,
        },
        null,
        2
      ),
    };
  });
}
