import assert from 'node:assert/strict';
import test from 'node:test';
import { defineModule, Permission, validateModuleDefinition } from '@ploykit/module-sdk';

function codesFor(definition: Parameters<typeof validateModuleDefinition>[0]): string[] {
  return validateModuleDefinition(definition).map((diagnostic) => diagnostic.code);
}

test('module contract validates theme permissions and host token allowlist', () => {
  const codes = codesFor(
    defineModule({
      id: 'theme-test',
      name: 'Theme Test',
      version: '0.1.0',
      theme: {
        tokens: {
          colorPrimary: '#2563eb',
          focusRing: 'red; color: transparent',
          'global.css': 'body{}',
        },
        css: 'body { color: red; }',
      },
    })
  );

  assert.ok(codes.includes('MODULE_THEME_PERMISSION_REQUIRED'));
  assert.ok(codes.includes('MODULE_THEME_CSS_UNSUPPORTED'));
  assert.ok(codes.includes('MODULE_THEME_TOKEN_NOT_ALLOWED'));
  assert.ok(codes.includes('MODULE_THEME_TOKEN_VALUE_UNSAFE'));
});

test('module contract validates white-label presentation declarations', () => {
  const codes = codesFor(
    defineModule({
      id: 'white-label-invalid',
      name: 'White Label Invalid',
      version: '0.1.0',
      permissions: [Permission.SurfaceOverride],
      presentation: {
        whiteLabel: true,
        replaces: ['host.page:site.home', 'bad.target'],
        seoNamespaces: ['seo'],
        themeScope: 'site',
      },
      surfaces: {
        'host.page:site.home': {
          mode: 'append',
          component: './surfaces/HomePage',
          permissions: [Permission.SurfaceOverride],
        },
        'host.page:site.docs': {
          mode: 'replace',
          component: './surfaces/DocsPage',
          loader: './loaders/docs-meta',
          permissions: [Permission.SurfaceOverride],
        },
      },
    })
  );

  assert.ok(codes.includes('MODULE_PRESENTATION_I18N_REQUIRED'));
  assert.ok(codes.includes('MODULE_PRESENTATION_LOCALES_REQUIRED'));
  assert.ok(codes.includes('MODULE_PRESENTATION_REPLACE_TARGET_INVALID'));
  assert.ok(codes.includes('MODULE_PRESENTATION_REPLACE_SURFACE_MODE_INVALID'));
  assert.ok(codes.includes('MODULE_PRESENTATION_REPLACE_LOADER_REQUIRED'));
  assert.ok(codes.includes('MODULE_PRESENTATION_REPLACE_NOT_DECLARED'));
  assert.ok(codes.includes('MODULE_PRESENTATION_SEO_NAMESPACE_MISSING'));
});

test('module contract accepts complete white-label presentation declarations', () => {
  const diagnostics = validateModuleDefinition(
    defineModule({
      id: 'white-label-valid',
      name: 'White Label Valid',
      version: '0.1.0',
      permissions: [Permission.SurfaceOverride, Permission.ThemeWrite],
      resources: {
        locales: {
          zh: './locales/zh.json',
          en: './locales/en.json',
        },
      },
      i18n: {
        defaultLanguage: 'zh',
        requiredLanguages: ['zh', 'en'],
        namespaces: ['nav', 'seo'],
        strict: true,
      },
      presentation: {
        whiteLabel: true,
        replaces: ['host.page:site.home'],
        seoNamespaces: ['seo'],
        themeScope: 'site',
      },
      theme: {
        tokens: {
          colorPrimary: '#2563eb',
        },
      },
      surfaces: {
        'host.page:site.home': {
          mode: 'replace',
          component: './surfaces/HomePage',
          loader: './loaders/home-meta',
          permissions: [Permission.SurfaceOverride],
        },
      },
    })
  );

  assert.deepEqual(diagnostics, []);
});

test('module contract requires localized message keys for strict i18n fallbacks', () => {
  const codes = codesFor(
    defineModule({
      id: 'strict-i18n-messages',
      name: 'Strict I18n Messages',
      version: '0.1.0',
      resources: {
        locales: {
          zh: './locales/zh.json',
        },
      },
      i18n: {
        defaultLanguage: 'zh',
        requiredLanguages: ['zh'],
        namespaces: ['actions', 'surfaces'],
        strict: true,
      },
      actions: {
        publish: {
          handler: './actions/publish',
          confirmation: {
            required: true,
            fallbackMessage: 'Publish now?',
          },
        },
      },
      surfaces: {
        'dashboard.home:summary': {
          mode: 'append',
          component: './surfaces/Summary',
          fallback: {
            behavior: 'placeholder',
            fallbackMessage: 'Summary unavailable.',
          },
        },
      },
    })
  );

  assert.ok(codes.includes('MODULE_I18N_ACTION_CONFIRMATION_MESSAGE_KEY_REQUIRED'));
  assert.ok(codes.includes('MODULE_I18N_SURFACE_FALLBACK_MESSAGE_KEY_REQUIRED'));
});

test('module contract validates local contract parts, action side effects, and surface placement metadata', () => {
  const codes = codesFor(
    defineModule({
      id: 'contract-metadata-test',
      name: 'Contract Metadata Test',
      version: '0.1.0',
      parts: {
        data: './data',
        routes: './routes',
        theme: './theme',
      },
      actions: {
        deleteEverything: {
          handler: './actions/delete-everything',
          sideEffect: 'destructive',
        },
        callExternal: {
          handler: './actions/call-external',
          permissions: [Permission.FilesRead],
          sideEffect: 'external',
        },
      },
      surfaces: {
        'admin.dashboard:actions': {
          component: './surfaces/AdminActions',
          placement: {
            responsive: 'float' as never,
          },
          visibility: {
            mode: 'permission',
          },
          fallback: {
            behavior: 'teleport' as never,
          },
        },
      },
    })
  );

  assert.ok(codes.includes('MODULE_PART_DATA_NOT_WIRED'));
  assert.ok(codes.includes('MODULE_PART_ROUTES_NOT_WIRED'));
  assert.ok(codes.includes('MODULE_PART_THEME_NOT_WIRED'));
  assert.ok(codes.includes('MODULE_ENTRY_PERMISSION_NOT_DECLARED'));
  assert.ok(codes.includes('MODULE_ACTION_CONFIRMATION_REQUIRED'));
  assert.ok(codes.includes('MODULE_ACTION_IDEMPOTENCY_REQUIRED'));
  assert.ok(codes.includes('MODULE_SURFACE_PLACEMENT_RESPONSIVE_INVALID'));
  assert.ok(codes.includes('MODULE_SURFACE_VISIBILITY_PERMISSION_REQUIRED'));
  assert.ok(codes.includes('MODULE_SURFACE_FALLBACK_INVALID'));
});
