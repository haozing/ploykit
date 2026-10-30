
import { apiFetch, type ApiFetchOptions } from '@ploykit/client'
import type { SiteConfig } from '@ploykit/hooks'

/**
 * Turnstile 前端接线的公共层（组件见 auth/TurnstileWidget.tsx）。
 *
 * 头注入位置说明：@ploykit/client 的 `api.post(path, body)` 不收自定义头，
 * 而其底层的 `apiFetch(path, options)` 天然支持 headers（CSRF / 超时 /
 * 工作区头等 plumbing 全部保留）。本函数就是「带 Turnstile 头的 POST」的
 * 单一实现，三个 auth 表单（注册 / 找回密码 / 登录发码）共用，避免三处
 * 各自手拼头字符串产生漂移。
 */

/** 服务端 webx Turnstile 中间件读取的请求头（设计文档 §2.1 定的契约）。 */
export const TURNSTILE_TOKEN_HEADER = 'X-Turnstile-Token'

/**
 * 从公开 /config 数据里取生效的 Turnstile site key。
 * 空串 / 纯空白视为未配置（返回 null）——与 GA4 批 ga4_measurement_id 的
 * trim 判空语义一致。
 */
export function turnstileSiteKey(cfg: SiteConfig | undefined): string | null {
  const key = cfg?.turnstile_site_key?.trim()
  return key ? key : null
}

/**
 * 发一个可选携带 Turnstile token 的 POST。
 * token 为空时与 `api.post(path, body)` 行为完全一致（无 site key 的产品
 * 零感知）；非空时附 X-Turnstile-Token 头。
 */
export async function postTurnstileProtected<T>(
  path: string,
  body: unknown,
  token: string | null,
): Promise<T> {
  const options: ApiFetchOptions = { method: 'POST', body }
  if (token) options.headers = { [TURNSTILE_TOKEN_HEADER]: token }
  return apiFetch<T>(path, options)
}
