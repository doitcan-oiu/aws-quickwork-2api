import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'

const listeners = new Map()
const sessions = new Map()
const maxBodyBytes = 64 * 1024
const invalidCallback = '回调未通过验证。请核对当前步骤，或回到 Magpie 重新登录。'
const assets = new Map([
  ['/', ['wizard.html', 'text/html; charset=utf-8']],
  ['/wizard.html', ['wizard.html', 'text/html; charset=utf-8']],
  ['/wizard.js', ['wizard.js', 'text/javascript; charset=utf-8']],
])

class RequestError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

export function registerWizardSession(port, session) {
  const key = String(port)
  sessions.set(key, session)
  return () => {
    if (sessions.get(key) === session) sessions.delete(key)
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', chunk => {
      if (size > maxBodyBytes) return
      size += chunk.length
      if (size <= maxBodyBytes) chunks.push(chunk)
      else reject(new RequestError(413, '回调地址过长。'))
    })
    req.once('end', () => {
      if (size > maxBodyBytes) return
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) }
      catch { reject(new RequestError(400, '请输入完整的回调地址。')) }
    })
    req.once('error', reject)
  })
}

async function callback(body) {
  const { step, url: raw } = body || {}
  if (step !== 1 && step !== 2) throw new RequestError(400, '登录步骤无效。')
  // Check the authority as written too: URL normalizes non-canonical IP
  // forms, userinfo and escaped characters that AWS never sends.
  if (typeof raw !== 'string' || !/^http:\/\/(?:127\.0\.0\.1|localhost):[1-9]\d{0,4}(?:[/?]|$)/.test(raw) || /[\\\s#]/.test(raw)) {
    throw new RequestError(400, '请粘贴浏览器地址栏中的完整本机回调地址。')
  }
  let url
  try { url = new URL(raw) } catch { throw new RequestError(400, '回调地址格式不正确。') }
  if (step === 1 && url.pathname !== '/callback') {
    throw new RequestError(400, '请粘贴这次登录的第一个回调地址。')
  }
  if (step === 2 && url.pathname !== '/' && url.pathname !== '/index.html') {
    throw new RequestError(400, '请粘贴完成 AWS 授权后的第二个回调地址。')
  }
  const session = sessions.get(url.port)
  if (!session || (step === 1 && url.searchParams.get('nonce') !== session.firstNonce)) {
    throw new RequestError(400, invalidCallback)
  }
  // State, PKCE, single redemption and cancellation are owned by the
  // original sign-in. A pasted URL is parsed, never fetched.
  let result
  try { result = await session.onCallback(step, url) }
  catch {
    throw new RequestError(400, invalidCallback)
  }
  if (step === 1 && result?.step === 2 && typeof result.url === 'string' && result.url.startsWith('https://')) {
    return { step: 2, url: result.url }
  }
  if (step === 2 && result?.done === true) return { done: true }
  throw new RequestError(400, invalidCallback)
}

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(data))
}

async function serve(port, req, res) {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Vary', 'Origin')
  const hosts = ['127.0.0.1:' + port, 'localhost:' + port]
  const origin = req.headers.origin
  if (!hosts.includes(req.headers.host) || (origin !== undefined && origin !== 'null' && !hosts.some(host => origin === 'http://' + host))) {
    return json(res, 403, { error: '请求来源无效。' })
  }
  if (origin) res.setHeader('Access-Control-Allow-Origin', origin)
  const path = req.url.split('?')[0]
  if (path === '/callback' && req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type' })
    return res.end()
  }
  if (path === '/callback' && req.method === 'POST') {
    if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      return json(res, 415, { error: '请通过登录向导提交回调。' })
    }
    return json(res, 200, await callback(await readBody(req)))
  }
  const asset = assets.get(path)
  if (req.method !== 'GET' || !asset) return json(res, 404, { error: '页面不存在。' })
  const [file, type] = asset
  const bytes = await readFile(new URL('../login/' + file, import.meta.url))
  // WebKit may treat a sandboxed plugin page as an opaque origin, so
  // name its two loopback resources explicitly as well.
  const loopback = 'http://127.0.0.1:' + port
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Security-Policy': [
      "default-src 'none'", "script-src 'self' " + loopback + '/wizard.js',
      "style-src 'unsafe-inline'", "connect-src 'self' " + loopback + '/callback',
      "base-uri 'none'", "form-action 'none'",
    ].join('; '),
  })
  res.end(bytes)
}

// Multiple login attempts can start on the same turn of the event loop.
// Share even the pending bind, and let a later attempt retry a failed one.
export function startLoginWizard(port) {
  if (listeners.has(port)) return listeners.get(port)
  const ready = new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      serve(req.socket.localPort, req, res).catch(err => {
        if (res.destroyed || res.writableEnded) return
        if (err instanceof RequestError) json(res, err.status, { error: err.message })
        else json(res, 500, { error: '登录向导暂时不可用。' })
      })
    })
    server.once('close', () => {
      if (listeners.get(port) === ready) listeners.delete(port)
    })
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      server.unref()
      resolve(server)
    })
  }).catch(err => {
    if (listeners.get(port) === ready) listeners.delete(port)
    throw err
  })
  listeners.set(port, ready)
  return ready
}
