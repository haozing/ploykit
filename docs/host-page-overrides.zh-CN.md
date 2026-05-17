# 宿主页面插槽与覆盖

插件可以扩展部分宿主自带页面，而不接管路由，也不复制宿主外壳。适用于插件想给 `/`、`/pricing`、`/about` 等页面追加内容，或受信任插件需要替换某个宿主页面主内容的场景。

## 选择合适的入口

| 需求                               | 合同                  | 权限                          |
| ---------------------------------- | --------------------- | ----------------------------- |
| 在宿主页面区域前后追加内容         | `hostPages.slots`     | `Permission.HostPageExtend`   |
| 替换宿主页面主内容                 | `hostPages.overrides` | `Permission.HostPageOverride` |
| 复用宿主头部、页脚、语言切换和菜单 | override `shell`      | 跟随 override                 |

不要用 `publicAliases` 抢 `/`、`/about`、`/pricing` 这类宿主路径。public alias 是插件自己的公开页面入口。

## 插槽示例

```ts
import { definePlugin, Permission } from '@ploykit/plugin-sdk';

export default definePlugin({
  id: 'marketing-banner',
  name: 'Marketing Banner',
  version: '0.1.0',
  trustLevel: 'trusted',
  permissions: [Permission.HostPageExtend],
  resources: {
    locales: {
      en: './locales/en.json',
      zh: './locales/zh.json',
    },
  },
  hostPages: {
    slots: [
      {
        page: '/',
        position: 'hero.before',
        component: './slots/HomeBanner',
      },
      {
        page: '/pricing',
        position: 'main.after',
        component: './components/PricingNote',
      },
    ],
  },
});
```

`component` 必须是插件内的本地模块路径。推荐把页面级覆盖放在 `./pages/`，把复用 UI 放在 `./components/`，把单纯插槽组件放在 `./slots/`；`plugin:doctor` 会检查声明的模块是否存在。

宿主渲染插槽组件时会传入 `PluginRuntimeSlotProps`，其中包含 `pluginId`、`page`、`position`、`i18n` 和 `assets`：

```tsx
import { createPluginTranslator, type PluginRuntimeSlotProps } from '@ploykit/plugin-sdk';

export default function HomeBanner(props: PluginRuntimeSlotProps) {
  const t = createPluginTranslator(props.i18n);

  return <section>{t('home.banner')}</section>;
}
```

## 覆盖示例

覆盖比插槽更强。它会替换宿主页面主内容，所以必须声明 SEO 和 required locales。

```ts
export default definePlugin({
  id: 'about-replacement',
  name: 'About Replacement',
  version: '0.1.0',
  trustLevel: 'trusted',
  permissions: [Permission.HostPageOverride],
  resources: {
    locales: {
      en: './locales/en.json',
      zh: './locales/zh.json',
    },
  },
  hostPages: {
    overrides: [
      {
        page: '/about',
        mode: 'main.replace',
        component: './pages/AboutOverride',
        shell: {
          layout: 'site',
          header: 'host',
          footer: 'host',
          container: 'fixed',
          activeMenuPath: '/about',
        },
        seo: {
          titleKey: 'hostPages.about.seo.title',
          descriptionKey: 'hostPages.about.seo.description',
          canonical: '/about',
          robots: { index: true, follow: true },
          sitemap: { include: true, changeFrequency: 'weekly', priority: 0.6 },
        },
        i18n: {
          requiredLocales: ['en', 'zh'],
        },
      },
    ],
  },
});
```

覆盖页面组件会收到正常的 `PluginRuntimePageProps`，包括 `pluginId`、`localPath`、`requestPath`、`params`、`query`、`i18n`、`assets` 和 route metadata。

## 规则

- 追加内容用 host page slots。
- 替换宿主页面主体才用 host page overrides，并只给 trusted 插件使用。
- 默认复用宿主头部和页脚。
- `requiredLocales` 里的每个语言都要有可见 UI 文案和 SEO 文案。
- 页面内容替换后，SEO metadata 必须和新内容一致。
- slot 与 override 组件应该通过 `PluginRuntimeSlotProps` / `PluginRuntimePageProps` 读取 i18n 与 assets，不要假设宿主会传裸 `locale`。
- 修改合同后运行 `npm run plugin:doctor -- plugins/<plugin-id>`。
