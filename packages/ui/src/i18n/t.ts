import { en as enDict, zh as zhDict } from './messages'

/** UI 语言。默认 'en'（美区主战场；zh 为宿主产品显式开启的可选项）。 */
export type Lang = 'en' | 'zh'

// 模块级当前语言：供 lib/（api-error 等）与非 React 调用点使用。
// Provider 挂载时会 setUiLang 对齐；无 Provider 的环境（纯函数测试）恒 'en'。
let currentUiLang: Lang = 'en'

export function setUiLang(lang: Lang): void {
  currentUiLang = lang
}

export function currentLang(): Lang {
  return currentUiLang
}

/** 字典解析：当前语言 → en 兜底 → key 本身（缺翻译可见可查，不静默吞）。 */
export function translate(lang: Lang, key: string, vars?: Record<string, string | number>): string {
  const raw = (lang === 'zh' ? zhDict[key] : undefined) ?? enDict[key] ?? key
  if (!vars) return raw
  return raw.replace(/\{(\w+)\}/g, (m, name) => (name in vars ? String(vars[name]) : m))
}

/** 非 React 场景取文案（模块级，随 setUiLang 变化，默认 en）。 */
export function t(key: string, vars?: Record<string, string | number>): string {
  return translate(currentUiLang, key, vars)
}
