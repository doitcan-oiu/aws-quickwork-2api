import { setTimeout as delay } from 'node:timers/promises'
import { isQuickHost } from './auth.js'
import { quickError } from './wire.js'

const MiB = 1024 * 1024
const pollInterval = 1500
const pollAttempts = 60

function tenantBase(session) {
  let url
  try { url = new URL(session.tenant) } catch { throw quickError('Invalid Amazon Quick attachment tenant', 400) }
  if (url.protocol !== 'https:' || !isQuickHost(url.hostname) || url.hostname !== session.wsHost ||
      url.username || url.password || url.port || url.search || url.hash) {
    throw quickError('Invalid Amazon Quick attachment tenant', 400)
  }
  if (typeof session.jwt !== 'string' || !session.jwt || /[\s\x00-\x1f\x7f]/.test(session.jwt)) {
    throw quickError('Amazon Quick sign-in is required', 401)
  }
  return url.href.replace(/\/+$/, '') + '/integration/quick-work/'
}

async function tenantJSON(url, token, signal, { body, contentType, limit = MiB } = {}) {
  const headers = { Authorization: 'Bearer ' + token, Origin: 'https://quick.aws.com', Accept: 'application/json' }
  if (contentType) headers['Content-Type'] = contentType
  let response
  try {
    response = await fetch(url, { method: body === undefined ? 'GET' : 'POST', headers, body, credentials: 'omit', redirect: 'error', signal })
  } catch {
    signal.throwIfAborted()
    throw quickError('Amazon Quick attachment service unavailable')
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {})
    const status = response.status >= 400 && response.status < 600 ? response.status : 502
    throw quickError('Amazon Quick attachment service rejected the request', status)
  }
  try {
    const chunks = []
    let size = 0
    for await (const chunk of response.body) {
      size += chunk.length
      if (size > limit) throw new Error()
      chunks.push(chunk)
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    signal.throwIfAborted()
    throw quickError('Invalid Amazon Quick attachment response')
  }
}

function attachmentPath(value) {
  const path = value?.path || value?.files?.[0]?.path
  return typeof path === 'string' ? path.trim() : ''
}

function decodeObject(value) {
  if (typeof value !== 'string') return value
  try { return JSON.parse(value) } catch { return undefined }
}

function scanAllowed(verdict) {
  const action = String(verdict?.policyAction ?? '').trim().toUpperCase()
  const status = String(verdict?.dlpJobStatus ?? '').trim().toUpperCase()
  if (['BLOCK', 'WARN', 'DENY', 'REJECT'].includes(action)) {
    throw quickError('Amazon Quick attachment blocked by tenant policy', 403)
  }
  if (['FAILED', 'ERROR'].includes(status)) throw quickError('Amazon Quick attachment scan failed')
  const exempt = ['SKIPPED', 'NOT_APPLICABLE', 'DISABLED'].includes(status)
  if (action === 'ALLOW' && (!status || status === 'COMPLETED' || exempt)) return true
  if (!action && exempt) return true
  if (status === 'COMPLETED') throw quickError('Amazon Quick attachment scan returned no approval', 403)
  return false
}

// The tenant receives the UTF-8 bytes over HTTPS and performs scanning. Only
// the final workspace path and metadata travel in the WebSocket frame.
export async function uploadPromptAttachment(session, threadId, name, text, signal) {
  const base = tenantBase(session)
  if (!threadId || threadId === '.' || threadId === '..') throw quickError('Invalid attachment conversation', 400)
  const timeout = AbortSignal.timeout(120_000)
  const deadline = signal ? AbortSignal.any([signal, timeout]) : timeout
  deadline.throwIfAborted()
  const size = Buffer.byteLength(text)
  const query = new URLSearchParams({ name, contentType: 'text/plain', contentLength: String(size) })
  const uploaded = await tenantJSON(base + 'upload-attachment?' + query, session.jwt, deadline, {
    body: Buffer.from(text), contentType: 'application/octet-stream',
  })
  const id = typeof uploaded?.attachmentId === 'string' ? uploaded.attachmentId.trim() : ''
  let path = attachmentPath(uploaded)
  const approved = scanAllowed(uploaded)
  // Some tenants deliver a final path directly and supply no ID to poll.
  // An explicit unfinished or unknown verdict still needs approval.
  if (!id && (uploaded?.policyAction != null || uploaded?.dlpJobStatus != null) && !approved) {
    throw quickError('Amazon Quick attachment scan returned no approval', 403)
  }
  if (id) {
    const url = base + 'attachment-dlp-status?' + new URLSearchParams({ attachmentId: id })
    let allowed = false
    for (let i = 0; i < pollAttempts; i++) {
      if (i) await delay(pollInterval, undefined, { signal: deadline })
      if (scanAllowed(await tenantJSON(url, session.jwt, deadline))) {
        allowed = true
        break
      }
    }
    if (!allowed) throw quickError('Amazon Quick attachment scan timed out', 504)
  }
  if (!path && id) {
    const eventBody = { invokeAgent: { path: 'files/upload/' + encodeURIComponent(threadId),
      queryParams: { _method: 'POST' }, body: { attachmentId: id } } }
    const delivered = await tenantJSON(base + 'qbs-event', session.jwt, deadline, {
      body: JSON.stringify({ eventType: 'invokeAgent', eventBody }), contentType: 'application/json', limit: 2 * MiB,
    })
    const result = decodeObject(delivered?.eventResponse?.invokeAgentResponse) ?? delivered
    path = attachmentPath(delivered) || attachmentPath(decodeObject(result?.body)) || attachmentPath(result)
  }
  if (!path) throw quickError('Amazon Quick attachment returned no workspace path')
  deadline.throwIfAborted()
  return { type: 'file', name, size, mimeType: 'text/plain', path, ...(id ? { attachmentId: id } : {}) }
}
