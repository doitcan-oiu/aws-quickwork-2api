import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { defaultOptions, regionPattern } from './options.js'

const dataPlane = 'https://cell001.dp.appintegrations.us-east-1.prod.plato.ai.aws.dev'
const scopes = ['quicksight:read_write']
const refreshing = new Map()

export function isQuickHost(host) {
  return ['quick.aws.com', 'quicksight.aws.amazon.com', 'plato.ai.aws.dev', 'quicksuite.aws.dev']
    .some(domain => host === domain || host.endsWith('.' + domain))
}

function isIdpHost(host) {
  const oidc = /^oidc\.(.+)\.amazonaws\.com$/.exec(host)
  return isQuickHost(host) || (oidc && regionPattern.test(oidc[1])) ||
    ['login.microsoftonline.com', 'accounts.google.com', 'oauth2.googleapis.com'].includes(host) ||
    (process.env.AMAZON_QUICK_IDP_HOSTS || '').split(',').some(value => value.trim().toLowerCase() === host)
}

function checkedURL(value, acceptsHost) {
  let url
  try { url = new URL(value) } catch { throw new Error('Amazon Quick returned an invalid service URL') }
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash || !acceptsHost(url.hostname)) {
    throw new Error('Untrusted Amazon Quick service URL')
  }
  return url
}

function required(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Missing ' + label)
  return value
}

async function post(endpoint, payload, action, signal, bearer) {
  const form = payload instanceof URLSearchParams
  const headers = { Accept: 'application/json', 'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json' }
  if (bearer) headers.Authorization = 'Bearer ' + bearer
  const timeout = AbortSignal.timeout(30_000)
  let response
  try {
    response = await fetch(endpoint, {
      method: 'POST', headers, body: form ? payload : JSON.stringify(payload), redirect: 'error',
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    })
  } catch {
    throw new Error(action + ' request failed')
  }
  if (!response.ok) {
    const error = Object.assign(new Error(action + ' failed (HTTP ' + response.status + ')'), { status: response.status })
    if (action === 'Token refresh' && [400, 401, 403].includes(response.status)) {
      const details = await response.json().catch(() => null)
      // Magpie pauses a sign-in permanently only for a definitive OAuth rejection.
      if (['invalid_grant', 'expired_token', 'invalid_client', 'unauthorized_client'].includes(details?.error)) {
        error.signIn = 'expired'
        error.status = 401
      } else if (details?.error === 'slow_down') error.status = 429
    }
    throw error
  }
  try { return await response.json() } catch { throw new Error(action + ' returned malformed JSON') }
}

function jwtClaims(jwt) {
  try { return JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()) } catch { return {} }
}

function tokenRecord(meta, tokens) {
  const jwt = tokens.idToken || tokens.id_token || tokens.accessToken || tokens.access_token
  required(jwt, 'Amazon Quick token')
  const seconds = Number(tokens.expires_in ?? tokens.expiresIn)
  const expires = seconds > 0 ? Date.now() + seconds * 1000 : Number(jwtClaims(jwt)?.exp) * 1000
  if (!Number.isFinite(expires) || expires <= Date.now()) throw new Error('Missing or expired Amazon Quick token lifetime')
  const refreshToken = tokens.refreshToken || tokens.refresh_token || meta.refreshToken || ''
  return {
    type: 'oauth', access: jwt, expires,
    // All clients retain these three standard OAuth fields, even when they drop provider-specific fields.
    refresh: JSON.stringify({ ...meta, refreshToken }),
    uid: meta.accountId, accountId: meta.email || meta.accountId,
  }
}

function readMeta(auth) {
  if (auth?.type !== 'oauth' || !auth.access) throw Object.assign(new Error('Please sign in to Amazon Quick'), { status: 401 })
  let meta
  try { meta = JSON.parse(auth.refresh) } catch { throw new Error('Invalid Amazon Quick credentials; sign in again') }
  if (!meta || !['social', 'enterprise'].includes(meta.provider)) throw new Error('Invalid Amazon Quick sign-in method')
  checkedURL(meta.tenant, isQuickHost)
  const endpoint = checkedURL(meta.tokenEndpoint, isIdpHost)
  if (meta.provider === 'social' && !/^https:\/\/oidc\.[a-z0-9-]+\.amazonaws\.com\/token$/.test(endpoint.href)) {
    throw new Error('Untrusted AWS Identity Center token endpoint')
  }
  required(meta.clientId, 'Amazon Quick client ID')
  required(meta.accountId, 'Amazon Quick account ID')
  return meta
}

export function sessionFromAuth(auth) {
  const meta = readMeta(auth)
  return {
    jwt: auth.access, wsHost: new URL(meta.tenant).hostname, wsPath: '',
    provider: meta.provider, actorArn: meta.actorArn, accountId: meta.accountId, email: meta.email,
  }
}

function exchange(meta, grant, signal) {
  const action = grant.code ? 'Token exchange' : 'Token refresh'
  if (meta.provider === 'enterprise') {
    const form = new URLSearchParams({ client_id: meta.clientId })
    if (meta.clientSecret) form.set('client_secret', meta.clientSecret)
    if (grant.code) {
      form.set('grant_type', 'authorization_code')
      form.set('code', grant.code)
      form.set('redirect_uri', grant.redirect)
      form.set('code_verifier', grant.verifier)
    } else {
      form.set('grant_type', 'refresh_token')
      form.set('refresh_token', meta.refreshToken)
    }
    return post(meta.tokenEndpoint, form, action, signal)
  }
  const payload = { clientId: meta.clientId, clientSecret: meta.clientSecret }
  if (grant.code) {
    Object.assign(payload, { grantType: 'authorization_code', code: grant.code, codeVerifier: grant.verifier, redirectUri: grant.redirect })
  } else {
    Object.assign(payload, { grantType: 'refresh_token', refreshToken: meta.refreshToken })
  }
  return post(meta.tokenEndpoint, payload, action, signal)
}

export async function getSession(getAuth, saveAuth) {
  const auth = await getAuth()
  if (!auth || auth.type !== 'oauth') throw Object.assign(new Error('Please sign in to Amazon Quick'), { status: 401 })
  const lead = readMeta(auth).refreshToken ? 60_000 : 0
  if (auth.expires > Date.now() + lead) return sessionFromAuth(auth)
  // A rotating refresh token may be exchanged only once even when several requests arrive together.
  let pending = refreshing.get(auth.refresh)
  if (!pending) {
    pending = (async () => {
      const next = await refreshAuth(auth)
      await saveAuth(next)
      return next
    })().finally(() => refreshing.delete(auth.refresh))
    refreshing.set(auth.refresh, pending)
  }
  return sessionFromAuth(await pending)
}

export async function refreshAuth(auth) {
  const meta = readMeta(auth)
  if (typeof meta.refreshToken !== 'string' || !meta.refreshToken.trim()) {
    const error = Object.assign(new Error('This Amazon Quick account has no refresh token; sign in again to renew it'), { status: 401 })
    if (!(auth.expires > Date.now())) error.signIn = 'expired'
    throw error
  }
  return tokenRecord(meta, await exchange(meta, {}))
}

function discoveryURL(provider, nonce, port, region, appVersion) {
  const enterpriseHost = (region === 'us-east-1' ? '' : region + '.') + 'quicksight.aws.amazon.com'
  const url = new URL(provider === 'enterprise'
    ? 'https://' + enterpriseHost + '/sn/start/app-integrations/quickwork-enterprise-login'
    : 'https://quick.aws.com/sn')
  url.searchParams.set('qwSurface', 'desktop:' + nonce + ':' + port + ':' + appVersion)
  // Magpie finds loopback callbacks by URL or a named port in the query.
  // Quick reads its port from qwSurface, which Magpie can't parse.
  url.searchParams.set('magpie_callback_port', String(port))
  return url.href
}

async function discover(provider, query, region, redirect, signal) {
  const field = (...names) => names.map(name => query.get(name)).find(Boolean)
  const tenantURL = field('tenantUrl', 'tenant_url') || (provider === 'social' && dataPlane)
  const tenant = checkedURL(tenantURL, isQuickHost)
  if (tenant.search) throw new Error('Invalid Amazon Quick tenant URL')
  const meta = { provider, tenant: tenant.href.replace(/\/+$/, '') }
  let authorize
  if (provider === 'enterprise') {
    authorize = checkedURL(field('authEndpoint', 'auth_endpoint'), isIdpHost)
    meta.tokenEndpoint = checkedURL(field('tokenEndpoint', 'token_endpoint'), isIdpHost).href
    meta.clientId = required(field('clientId', 'client_id'), 'client ID')
    meta.clientSecret = field('clientSecret', 'client_secret') || ''
  } else {
    const idcRegion = field('idcRegion', 'idc_region') || region
    if (!regionPattern.test(idcRegion)) throw new Error('Invalid AWS region')
    const oidc = 'https://oidc.' + idcRegion + '.amazonaws.com'
    // AWS validates the issuer in its registration endpoint. The plugin never contacts it.
    const issuer = checkedURL(field('issuerUrl', 'issuer_url', 'issuer'), () => true)
    const client = await post(oidc + '/client/register', {
      clientName: 'AmazonQuick-Desktop', clientType: 'public', scopes,
      grantTypes: ['authorization_code', 'refresh_token'], redirectUris: [redirect], issuerUrl: issuer.href,
    }, 'Client registration', signal)
    authorize = new URL(oidc + '/authorize')
    meta.tokenEndpoint = oidc + '/token'
    meta.clientId = required(client.clientId || client.client_id, 'client ID')
    meta.clientSecret = required(client.clientSecret || client.client_secret, 'client secret')
  }
  return { meta, authorize }
}

async function signIn(provider, { appVersion = defaultOptions.appVersion, region: configuredRegion }, options = {}) {
  const region = configuredRegion || process.env.AMAZON_QUICK_REGION || 'us-east-1'
  if (!regionPattern.test(region)) throw new Error('Invalid Amazon Quick login region')
  options.signal?.throwIfAborted()
  const nonce = randomBytes(32).toString('base64url')
  const state = randomBytes(32).toString('base64url')
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  const lifetime = new AbortController()
  let settle
  const result = new Promise(resolve => { settle = resolve })
  let discovery, redeemed = false, redirect, port
  const server = createServer(async (req, res) => {
    const reply = (status, body = '') => {
      res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' })
      res.end(body)
    }
    if (lifetime.signal.aborted) return reply(410)
    const hosts = ['localhost:' + port, '127.0.0.1:' + port]
    if (req.method !== 'GET' || !hosts.includes(req.headers.host)) return reply(400)
    try {
      const url = new URL(req.url, redirect)
      if (url.protocol !== 'http:' || url.username || url.password || !hosts.includes(url.host)) return reply(400)
      const q = url.searchParams
      if (url.pathname === '/callback') {
        if (q.get('nonce') !== nonce) return reply(400, 'Invalid discovery callback')
        if (q.has('error')) throw new Error('Amazon Quick declined sign-in')
        discovery ??= discover(provider, q, region, redirect, lifetime.signal)
        const { meta, authorize } = await discovery
        const params = {
          response_type: 'code', client_id: meta.clientId, redirect_uri: redirect, state,
          code_challenge: challenge, code_challenge_method: 'S256',
          scope: provider === 'social' ? scopes.join(' ') : 'openid profile email',
        }
        if (provider === 'enterprise') Object.assign(params, { access_type: 'offline', prompt: 'consent' })
        for (const [key, value] of Object.entries(params)) authorize.searchParams.set(key, value)
        res.writeHead(302, { Location: authorize.href, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' })
        res.end()
      } else if (url.pathname === '/' || url.pathname === '/index.html') {
        if (q.get('state') !== state || !discovery) return reply(400, 'Invalid sign-in callback')
        if (q.has('error')) throw new Error('Amazon Quick declined sign-in')
        if (!q.get('code')) return reply(400, 'Missing authorization code')
        if (redeemed) return reply(409, 'Sign-in already in progress')
        redeemed = true
        const { meta } = await discovery
        const tokens = await exchange(meta, { code: q.get('code'), verifier, redirect }, lifetime.signal)
        const access = required(tokens.accessToken || tokens.access_token, 'access token')
        const profileBase = provider === 'enterprise' || meta.tenant.includes('dp.appintegrations') ? meta.tenant : dataPlane
        const response = await post(profileBase + '/integration/quick-work/user-info', {}, 'Account lookup', lifetime.signal, access)
        const profile = response.userInfo || response.user_info || response
        const sub = jwtClaims(tokens.idToken || tokens.id_token || '')?.sub
        meta.actorArn = profile.userArn || profile.user_arn || (typeof sub === 'string' && sub.startsWith('arn:') ? sub : '')
        meta.email = profile.email || profile.emailAddress || profile.email_address || ''
        const identity = required(meta.actorArn || sub || meta.email.toLowerCase() || profile.userName || profile.user_name || profile.username, 'account identity')
        meta.accountId = createHash('sha256').update(meta.tenant + '\0' + identity).digest('hex')
        const saved = tokenRecord(meta, tokens)
        reply(200, 'Amazon Quick 登录成功，可以关闭此页面。')
        finish({ ...saved, type: 'success' })
      } else {
        reply(404)
      }
    } catch (err) {
      reply(400, 'Amazon Quick 登录失败，请返回 Magpie。')
      finish({ type: 'failed', error: err instanceof Error ? err.message : 'Amazon Quick sign-in failed' })
    }
  })
  let timer, callbackSignal
  const abort = () => finish({ type: 'failed', error: 'Amazon Quick sign-in cancelled or timed out' })
  function finish(value) {
    if (lifetime.signal.aborted) return
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', abort)
    callbackSignal?.removeEventListener('abort', abort)
    lifetime.abort()
    server.close()
    settle(value)
  }
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  server.on('error', () => finish({ type: 'failed', error: 'Amazon Quick callback listener failed' }))
  port = server.address().port
  redirect = 'http://' + (provider === 'enterprise' ? 'localhost:' : '127.0.0.1:') + port
  timer = setTimeout(abort, 10 * 60_000)
  timer.unref?.()
  options.signal?.addEventListener('abort', abort, { once: true })
  if (options.signal?.aborted) abort()
  return {
    url: discoveryURL(provider, nonce, port, region, appVersion),
    method: 'auto',
    // Magpie leaves opening the URL to the user when the plugin handles it.
    opened: true,
    instructions: '第 1 步 · 登录 AWS。复制下方链接到无痕窗口或其他浏览器登录。若回调页打不开，把第一条完整回调地址粘贴到「回调 URL」并提交。\n' +
      '第 2 步 · 完成授权。卡片链接更新后，复制新链接到刚才的窗口完成授权，再在同一输入框提交第二条完整回调地址。',
    async callback(_code, context = {}) {
      callbackSignal = context.signal
      callbackSignal?.addEventListener('abort', abort, { once: true })
      if (callbackSignal?.aborted) abort()
      try { return await result } finally { callbackSignal?.removeEventListener('abort', abort) }
    },
  }
}

export function createAuthMethods(clientOptions = defaultOptions) {
  return [
    { type: 'oauth', label: 'Amazon Quick 个人账号', authorize: (_inputs, context) => signIn('social', clientOptions, context) },
    { type: 'oauth', label: 'Amazon Quick 企业账号', authorize: (_inputs, context) => signIn('enterprise', clientOptions, context) },
  ]
}
