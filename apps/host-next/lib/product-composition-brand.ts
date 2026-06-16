import fs from 'node:fs';
import path from 'node:path';
import type { ProductPresentationDefinition } from '@ploykit/module-sdk/presentation';

export interface ProductThemeVisualBaselineView {
  createdAt: string | null;
  source: string;
  adminUiGate: {
    ok: boolean;
    report: string | null;
    errors: number | null;
    warnings: number | null;
  };
  browserMatrix: {
    ok: boolean;
    report: string | null;
    outputDir: string | null;
    adminCheckCount: number | null;
    adminScreenshotCount: number;
  };
  themeMatrix: {
    report: string | null;
    screenshotCount: number | null;
    adminScreenshotCount: number | null;
    adminScreenshots: readonly string[];
  };
  accessibilitySmoke: {
    ok: boolean;
    report: string | null;
  };
  adminMobileHandfeel: {
    ok: boolean;
    report: string | null;
    failed: number | null;
  } | null;
}

export interface ProductBrandView {
  productName: string;
  productNameKey: string | null;
  logoLight: string | null;
  logoDark: string | null;
  logoMark: string | null;
  favicon: string | null;
  manifestIcon: string | null;
  openGraphImageDefault: string | null;
  openGraphImageLocales: Record<string, string>;
  themeColor: string | null;
  diagnostics: string[];
}

export function resolveProductBrandView(
  definition: ProductPresentationDefinition
): ProductBrandView {
  const brand = definition.brand;
  const diagnostics: string[] = [];
  const openGraphImage = brand?.openGraphImage;
  const openGraphImageDefault =
    typeof openGraphImage === 'string' ? openGraphImage : (openGraphImage?.default ?? null);
  const openGraphImageLocales =
    openGraphImage && typeof openGraphImage === 'object'
      ? Object.fromEntries(
          Object.entries(openGraphImage).filter(([language]) => language !== 'default')
        )
      : {};

  if (!brand?.favicon) {
    diagnostics.push('BRAND_FAVICON_MISSING');
  }
  if (!brand?.manifestIcon) {
    diagnostics.push('BRAND_MANIFEST_ICON_MISSING');
  }
  if (!openGraphImageDefault) {
    diagnostics.push('BRAND_OPEN_GRAPH_IMAGE_MISSING');
  }
  if (!brand?.themeColor) {
    diagnostics.push('BRAND_THEME_COLOR_MISSING');
  }

  return {
    productName: definition.name,
    productNameKey: brand?.productNameKey ?? null,
    logoLight: brand?.logo?.light ?? null,
    logoDark: brand?.logo?.dark ?? null,
    logoMark: brand?.logo?.mark ?? null,
    favicon: brand?.favicon ?? null,
    manifestIcon: brand?.manifestIcon ?? null,
    openGraphImageDefault,
    openGraphImageLocales,
    themeColor: brand?.themeColor ?? null,
    diagnostics,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

export function readProductThemeVisualBaseline(): ProductThemeVisualBaselineView | null {
  const file = path.join(process.cwd(), '.runtime', 'admin-visual-baseline.json');
  if (!fs.existsSync(file)) {
    return null;
  }
  try {
    const parsed = asRecord(JSON.parse(fs.readFileSync(file, 'utf8')) as unknown);
    const reports = asRecord(parsed.reports);
    const adminUiGate = asRecord(reports.adminUiGate);
    const browserMatrix = asRecord(reports.browserMatrix);
    const themeMatrix = asRecord(reports.themeMatrix);
    const accessibilitySmoke = asRecord(reports.accessibilitySmoke);
    const adminMobileHandfeelValue = reports.adminMobileHandfeel;
    const adminMobileHandfeel =
      adminMobileHandfeelValue && typeof adminMobileHandfeelValue === 'object'
        ? asRecord(adminMobileHandfeelValue)
        : null;
    const adminScreenshots = asStringArray(browserMatrix.adminScreenshots);
    return {
      createdAt: asString(parsed.createdAt),
      source: path.relative(process.cwd(), file),
      adminUiGate: {
        ok: adminUiGate.ok === true,
        report: asString(adminUiGate.report),
        errors: asNumber(adminUiGate.errors),
        warnings: asNumber(adminUiGate.warnings),
      },
      browserMatrix: {
        ok: browserMatrix.ok === true,
        report: asString(browserMatrix.report),
        outputDir: asString(browserMatrix.outputDir),
        adminCheckCount: asNumber(browserMatrix.adminCheckCount),
        adminScreenshotCount: adminScreenshots.length,
      },
      themeMatrix: {
        report: asString(themeMatrix.report),
        screenshotCount: asNumber(themeMatrix.screenshotCount),
        adminScreenshotCount: asNumber(themeMatrix.adminScreenshotCount),
        adminScreenshots: asStringArray(themeMatrix.adminScreenshots),
      },
      accessibilitySmoke: {
        ok: accessibilitySmoke.ok === true,
        report: asString(accessibilitySmoke.report),
      },
      adminMobileHandfeel: adminMobileHandfeel
        ? {
            ok: adminMobileHandfeel.ok === true,
            report: asString(adminMobileHandfeel.report),
            failed: asNumber(adminMobileHandfeel.failed),
          }
        : null,
    };
  } catch {
    return null;
  }
}
