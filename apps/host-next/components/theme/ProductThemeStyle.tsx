import {
  createProductThemeCss,
  type ProductThemeRuntimeView,
} from '@host/lib/product-composition';

export function ProductThemeStyle({
  theme,
  id = 'ploykit-product-theme',
}: {
  theme: ProductThemeRuntimeView;
  id?: string;
}) {
  const css = createProductThemeCss(theme);
  if (!css) {
    return null;
  }

  return (
    <style
      id={id}
      data-product-theme={theme.product.themeProfileId ?? 'default'}
      data-workspace-theme={theme.workspace?.workspaceId ?? undefined}
      data-page-theme={theme.page?.themeProfileId ?? (theme.page ? 'page' : undefined)}
      dangerouslySetInnerHTML={{ __html: css }}
    />
  );
}
