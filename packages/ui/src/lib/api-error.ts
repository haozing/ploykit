
import { ApiError } from '@ploykit/client'
import { t } from '../i18n'

/**
 * 错误消息统一翻译（B 方案 i18n）：映射表存的是 i18n key（g8 分片 lib.api.*），
 * 取值统一走模块级 t()——默认 en；zh 产品挂 UiLangProvider 后随 setUiLang 生效。
 * 对外 API（apiErrorMessage(err, fallback?)）不变，消费点无需改动。
 */


const KNOWN_MESSAGES: Record<string, string> = {
  'invalid credentials': 'lib.api.invalidCredentials',


  'current password incorrect': 'lib.api.currentPasswordIncorrect',
  '当前密码不正确，请确认后重新输入': 'lib.api.currentPasswordIncorrect',
  '新密码不能与当前密码相同': 'lib.api.passwordUnchanged',
  'email already registered': 'lib.api.emailRegistered',
  'slug already taken': 'lib.api.slugTaken',
  'already a member': 'lib.api.alreadyMember',
  'invitation already pending': 'lib.api.invitationPending',
  'target is already an owner': 'lib.api.alreadyOwner',

  'name required (<=64 chars)': 'lib.api.nameRequiredLimit',
  'name required': 'lib.api.nameRequired',
}


const KNOWN_MESSAGE_PREFIXES: Array<[prefix: string, key: string]> = [

  ['slug must be', 'lib.api.slugInvalid'],


  ['last owner cannot leave', 'lib.api.lastOwnerLeave'],


  ['avatar_url must be', 'lib.api.avatarUrlInvalid'],


  ['workspace cannot be deleted', 'lib.api.workspaceDeleteBlocked'],

  ['egress:', 'lib.api.egressBlocked'],
  ['egressx:', 'lib.api.egressBlocked'],
]


const KNOWN_CODES: Record<string, string> = {
  E_QUOTA_EXCEEDED: 'lib.api.quotaExceeded',
  E_TIMEOUT: 'lib.api.timeout',
  E_ABORTED: 'lib.api.aborted',
  E_NETWORK: 'lib.api.network',

  E_CHANNEL_TEST_UNSUPPORTED: 'lib.api.channelTestUnsupported',

  E_MALFORMED_RESPONSE: 'lib.api.malformedResponse',

  E_VALIDATION: 'lib.api.validation',
  E_TURNSTILE: 'lib.api.turnstile',

  E_INVALID_CRON: 'lib.api.invalidCron',
  E_INVALID_TZ: 'lib.api.invalidTz',


  E_CONFLICT: 'lib.api.conflict',
}


function detailsText(details: unknown): string | undefined {
  return typeof details === 'string' && details.trim() !== '' ? details.trim() : undefined
}

function knownMessage(message: string): string | undefined {
  const normalized = message.trim().toLowerCase()
  const exact = KNOWN_MESSAGES[normalized]
  if (exact) return t(exact)
  const key = KNOWN_MESSAGE_PREFIXES.find(([prefix]) => normalized.startsWith(prefix))?.[1]
  return key ? t(key) : undefined
}

export function apiErrorMessage(err: unknown, fallback?: string): string {
  if (err instanceof ApiError) {

    const byMessage = knownMessage(err.message)
    if (byMessage) return byMessage


    const details = detailsText(err.details)
    if (details) return details


    if (err.code && KNOWN_CODES[err.code]) return t(KNOWN_CODES[err.code])
    if (err.status === 402) {
      return t('lib.api.planUpgrade')
    }
    if (err.status === 401) return t('lib.api.unauthenticated')
    if (err.status === 429) {

      return err.retryAfter !== undefined && err.retryAfter > 0
        ? t('lib.api.rateLimitedRetryIn', { seconds: err.retryAfter })
        : t('lib.api.rateLimited')
    }
    if (err.status >= 500) return t('lib.api.serverError')
    if (err.status === 404) return t('lib.api.notFound')
    if (err.status === 403) {
      return err.message && err.message !== 'forbidden'
        ? t('lib.api.forbiddenDetail', { message: err.message })
        : t('lib.api.forbidden')
    }
    return err.message || (fallback ?? t('lib.api.fallback'))
  }

  if (err instanceof TypeError) return t('lib.api.network')
  return err instanceof Error && err.message ? err.message : (fallback ?? t('lib.api.fallback'))
}
