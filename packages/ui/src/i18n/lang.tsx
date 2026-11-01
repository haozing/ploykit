import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { en as enDict, zh as zhDict } from './messages'
import { setUiLang, translate, type Lang } from './t'

/**
 * 框架级 UI 文案 i18n（EN 默认 + ZH 可选）——延续 kit-labels 的"不引 i18n
 * 框架"哲学：扁平 key 字典 + 一个 Provider + 一个 hook，别的都没有。
 *
 * 设计约定（2026-10-31 B 方案）：
 * - 默认语言恒 'en'：产品不传任何配置即得到英文界面（美区主战场）。
 * - zh 为可选：`<AppProviders uiLang="zh">` 或 `<UiLangProvider lang="zh">`。
 * - 不做浏览器语言协商、不做 Cookie 记忆——语言是宿主产品的显式决定。
 * - key 命名 `<group>.<ComponentOrModule>.<semantic>`，全小写驼峰。
 * - 插值 `{name}` 占位 + `t(key, { name })`；复数/性别/日期格式一律不做。
 */

const LangCtx = createContext<Lang>('en')

export function UiLangProvider({ lang = 'en', children }: { lang?: Lang; children: ReactNode }) {
  // 同步模块级 t()（lib/api-error 等非 React 调用点）——挂载即对齐。
  useMemo(() => setUiLang(lang), [lang])
  return <LangCtx.Provider value={lang}>{children}</LangCtx.Provider>
}

export function useLang(): Lang {
  return useContext(LangCtx)
}

/** React 组件内取文案：const t = useT() → t('auth.signIn.submit')。 */
export function useT() {
  const lang = useContext(LangCtx)
  return useMemo(() => (key: string, vars?: Record<string, string | number>) => translate(lang, key, vars), [lang])
}

export type { Lang }
