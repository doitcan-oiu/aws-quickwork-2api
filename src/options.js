import manifest from '../package.json' with { type: 'json' }

export const defaultOptions = Object.freeze(manifest.magpie.options)
export const regionPattern = /^[a-z]{2}(?:-[a-z0-9]+)+-[0-9]+$/
const versionPattern = /^\d+(?:\.\d+){1,3}(?:-[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*)?(?:\+[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*)?$/

function invalid(field, message) {
  throw Object.assign(new TypeError(message), { field })
}

// The settings panel and the provider use the same checks, including for
// options edited directly in Magpie's JSON editor.
export function readOptions(options = {}) {
  const values = {}
  for (const [field, fallback] of Object.entries(defaultOptions)) {
    const value = options[field] ?? fallback
    if (typeof value !== typeof fallback) invalid(field, field + ' 的值类型不正确。')
    values[field] = typeof value === 'string' ? value.trim() : value
  }
  if (!Number.isFinite(values.monthlyHours * 3_600_000) || values.monthlyHours <= 0) {
    invalid('monthlyHours', '请输入大于 0 的有效小时数。')
  }
  if (!['aidp', 'gateway'].includes(values.transport)) invalid('transport', '请选择 AIDP 或 Quick Gateway。')
  if (values.appVersion.length > 64 || !versionPattern.test(values.appVersion)) {
    invalid('appVersion', '请输入 Quick App 版本号，例如 1.2.4660。')
  }
  if (values.region && !regionPattern.test(values.region)) invalid('region', '请输入 AWS 区域代码，例如 us-east-1。')
  if (!/^[A-Za-z0-9._-]+$/.test(values.surface)) invalid('surface', '客户端标识可使用字母、数字、点、下划线和连字符。')
  for (const key of ['outpostId', 'workingSessionId', 'chatAgentId']) {
    if (!/^[\x21-\x7e]*$/.test(values[key])) invalid(key, '此标识只能包含不带空格的 ASCII 可见字符。')
  }
  if (!Number.isSafeInteger(values.sessionTtlMinutes * 60_000) || !Number.isInteger(values.sessionTtlMinutes) || values.sessionTtlMinutes < 1) {
    invalid('sessionTtlMinutes', '会话复用时限须为正整数分钟。')
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: values.timezone })
  } catch { invalid('timezone', '请输入有效时区，例如 Asia/Taipei。') }
  try {
    values.locale = Intl.getCanonicalLocales(values.locale)[0]
  } catch { invalid('locale', '请输入有效语言标签，例如 zh-TW。') }
  if (!['off', 'low', 'medium', 'high'].includes(values.thinkingEffort)) invalid('thinkingEffort', '请选择有效的思考强度。')
  // Node timers accept at most a signed 32-bit number of milliseconds.
  if (!Number.isSafeInteger(values.requestTimeoutSeconds) || values.requestTimeoutSeconds < 1 || values.requestTimeoutSeconds > 2_147_483) {
    invalid('requestTimeoutSeconds', '请求超时须为 1 至 2147483 秒的整数。')
  }
  return values
}
