export interface Account {
  id: number
  email: string
  display_name: string
  account_name: string
  provider: string
  build_stage: string
  region: string
  expires_at: number
  use_count: number
  last_used_at: number
  disabled: boolean
  has_error: boolean
  monthly_usage: {
    reported_ms: number
    estimated_ms: number
    reported_turns: number
    estimated_turns: number
  }
}

export interface Overview {
  accounts: Account[]
  usage_period: {
    month: string
    timezone: string
    budget_ms: number
    next_reset_at: number
  }
  config: {
    models: string[]
    default_model: string
    request_timeout: string
    refresh_before: string
    max_attempts: number
    api_key_required: boolean
    oauth: { provider: string; build_stage: string; region: string }
  }
}

export type Request = <T>(path: string, options?: RequestInit) => Promise<T>

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

export async function requestAdmin<T>(token: string, path: string, options?: RequestInit): Promise<T> {
  const headers = new Headers(options?.headers)
  headers.set('X-Quickproxy-Admin', '1')
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (options?.body) headers.set('Content-Type', 'application/json')
  const response = await fetch(`/admin/api/${path}`, { ...options, headers, cache: 'no-store' })
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new ApiError(response.status, body?.error || `请求失败（HTTP ${response.status}）`)
  }
  return response.status === 204 ? undefined as T : response.json()
}

export function errorMessage(error: unknown) {
  if (error instanceof TypeError) return '无法连接代理服务，请检查网络与服务状态后重试。'
  return error instanceof Error ? error.message : '请求失败，请稍后重试。'
}

export function accountName(account: Account) {
  return account.display_name || account.email || account.account_name || `账号 #${account.id}`
}

export function accountStatus(account: Account) {
  if (account.disabled) return { label: '已停用', tone: 'muted' }
  if (account.expires_at > 0 && account.expires_at <= Date.now() / 1000) return { label: '已过期', tone: 'warn' }
  if (account.has_error) return { label: '最近有错误', tone: 'warn' }
  return { label: '就绪', tone: 'good' }
}

export function dateTime(epoch: number) {
  return epoch > 0 ? new Date(epoch * 1000).toLocaleString('zh-CN', { hour12: false }) : '—'
}

export const apiBase = new URL('/v1', window.location.origin).href
