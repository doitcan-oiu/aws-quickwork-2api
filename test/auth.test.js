import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { get as httpGet } from 'node:http'
import test from 'node:test'
import { createAuthMethods, getSession, refreshAuth, sessionFromAuth } from '../src/auth.js'

const authMethods = createAuthMethods()
const loopbackFetch = globalThis.fetch.bind(globalThis)
const sendCallback = (port, path, params) =>
  loopbackFetch('http://127.0.0.1:' + port + path + '?' + new URLSearchParams(params), { redirect: 'manual' })

function readSurface(flow) {
  const [surface, nonce, port, version] = new URL(flow.url).searchParams.get('qwSurface').split(':')
  assert.equal(surface, 'desktop')
  assert.ok(version)
  return { nonce, port, version }
}

for (const [i, provider] of ['social', 'enterprise'].entries()) {
  test(provider + ' sign-in uses one listener for both callbacks and PKCE', async t => {
    const tokenEndpoint = provider === 'social' ? 'https://oidc.eu-west-1.amazonaws.com/token' : 'https://login.microsoftonline.com/tenant/oauth2/token'
    const tenant = 'https://test.plato.ai.aws.dev/dp.appintegrations'
    let exchanges = 0, registrations = 0, verifier
    const server = new AbortController()
    t.after(() => server.abort())
    const flow = await authMethods[i].authorize(undefined, { signal: server.signal })
    const { nonce, port, version } = readSurface(flow)
    assert.equal(version, '1.2.4660')
    assert.equal(flow.method, 'auto')
    assert.equal(flow.opened, true)
    assert.equal(new URL(flow.url).searchParams.get('magpie_callback_port'), port)
    const redirect = 'http://' + (provider === 'social' ? '127.0.0.1:' : 'localhost:') + port
    t.mock.method(globalThis, 'fetch', async (endpoint, init) => {
      assert.equal(init.redirect, 'error')
      if (endpoint === 'https://oidc.eu-west-1.amazonaws.com/client/register') {
        registrations++
        const registration = JSON.parse(init.body)
        assert.deepEqual(registration.redirectUris, [redirect])
        assert.deepEqual(registration.grantTypes, ['authorization_code', 'refresh_token'])
        return Response.json({ clientId: 'client', clientSecret: 'secret' })
      }
      if (endpoint === tokenEndpoint) {
        exchanges++
        const form = provider === 'enterprise'
        const params = form ? Object.fromEntries(init.body) : JSON.parse(init.body)
        verifier = params.codeVerifier || params.code_verifier
        assert.equal(params.code, 'test-code')
        assert.equal(params.redirect_uri || params.redirectUri, redirect)
        assert.equal(params.client_secret || params.clientSecret, 'secret')
        return Response.json(form
          ? { access_token: 'access', id_token: 'ws-id', expires_in: 3600 }
          : { accessToken: 'access', idToken: 'ws-id', refreshToken: 'refresh', expiresIn: 3600 })
      }
      assert.equal(endpoint, tenant + '/integration/quick-work/user-info')
      assert.equal(init.headers.Authorization, 'Bearer access')
      return Response.json(provider === 'social'
        ? { userInfo: { userArn: 'arn:synthetic', email: 'user@example.test' } }
        : { user_info: { user_arn: 'arn:synthetic', email_address: 'user@example.test' } })
    })
    const discovery = provider === 'social'
      ? { nonce, tenantUrl: tenant, issuerUrl: 'https://identitycenter.amazonaws.com/ssoins-test', idcRegion: 'eu-west-1' }
      : { nonce, tenantUrl: tenant, clientId: 'client', clientSecret: 'secret', authEndpoint: 'https://login.microsoftonline.com/tenant/oauth2/authorize', tokenEndpoint }
    const badHost = await new Promise((resolve, reject) => {
      httpGet({ hostname: '127.0.0.1', port, path: '/callback?' + new URLSearchParams(discovery),
        headers: { Host: 'untrusted.example.test:' + port } }, res => { res.resume(); resolve(res.statusCode) }).on('error', reject)
    })
    assert.equal(badHost, 400)
    assert.equal(registrations, 0)
    assert.equal((await sendCallback(port, '/callback', { ...discovery, nonce: 'wrong' })).status, 400)
    assert.equal((await sendCallback(port, '/', { code: 'early', state: 'wrong' })).status, 400)
    const approval = await sendCallback(port, '/callback', discovery)
    assert.equal(approval.status, 302)
    const authURL = new URL(approval.headers.get('location'))
    assert.equal(authURL.protocol, 'https:')
    assert.equal(authURL.searchParams.get('redirect_uri'), redirect)
    assert.equal(authURL.searchParams.get('code_challenge_method'), 'S256')
    assert.equal((await sendCallback(port, '/callback', discovery)).headers.get('location'), authURL.href)
    assert.equal((await sendCallback(port, '/', { code: 'test-code', state: 'wrong' })).status, 400)
    assert.equal(exchanges, 0)
    const completed = flow.callback()
    const accepted = await sendCallback(port, '/', { code: 'test-code', state: authURL.searchParams.get('state') })
    assert.equal(accepted.status, 200)
    const signedIn = await completed
    assert.equal(signedIn.type, 'success')
    assert.equal(signedIn.access, 'ws-id')
    assert.equal(signedIn.accountId, 'user@example.test')
    assert.equal(signedIn.uid.length, 64)
    assert.equal(exchanges, 1)
    assert.equal(registrations, provider === 'social' ? 1 : 0)
    assert.equal(createHash('sha256').update(verifier).digest('base64url'), authURL.searchParams.get('code_challenge'))
    assert.deepEqual(sessionFromAuth({ ...signedIn, type: 'oauth' }), {
      jwt: 'ws-id', wsHost: 'test.plato.ai.aws.dev', wsPath: '', provider, actorArn: 'arn:synthetic',
      accountId: signedIn.uid, email: signedIn.accountId,
    })
  })
}

test('Quick login versions and regions stay independent across concurrent plugin instances', async t => {
  const controller = new AbortController()
  const context = { signal: controller.signal }
  const previousRegion = process.env.AMAZON_QUICK_REGION
  t.after(() => {
    controller.abort()
    if (previousRegion === undefined) delete process.env.AMAZON_QUICK_REGION
    else process.env.AMAZON_QUICK_REGION = previousRegion
  })
  process.env.AMAZON_QUICK_REGION = 'eu-central-1'
  const configured = createAuthMethods({ appVersion: '2.3.4567', region: 'ap-northeast-1' })
  const inherited = createAuthMethods({ appVersion: '3.4.5678', region: '' })
  const [personal, enterprise, inheritedEnterprise] = await Promise.all([
    configured[0].authorize(undefined, context), configured[1].authorize(undefined, context),
    inherited[1].authorize(undefined, context),
  ])
  assert.equal(readSurface(personal).version, '2.3.4567')
  assert.equal(readSurface(enterprise).version, '2.3.4567')
  assert.equal(readSurface(inheritedEnterprise).version, '3.4.5678')
  assert.equal(new URL(enterprise.url).hostname, 'ap-northeast-1.quicksight.aws.amazon.com')
  assert.equal(new URL(inheritedEnterprise.url).hostname, 'eu-central-1.quicksight.aws.amazon.com')

  t.mock.method(globalThis, 'fetch', async endpoint => {
    assert.equal(endpoint, 'https://oidc.ap-northeast-1.amazonaws.com/client/register')
    return Response.json({ clientId: 'fixture-id', clientSecret: 'fixture-secret' })
  })
  const { nonce, port } = readSurface(personal)
  const approval = await sendCallback(port, '/callback', { nonce, issuerUrl: 'https://identitycenter.amazonaws.com/ssoins-test' })
  assert.equal(approval.status, 302)
  assert.equal(new URL(approval.headers.get('location')).hostname, 'oidc.ap-northeast-1.amazonaws.com')

  delete process.env.AMAZON_QUICK_REGION
  const defaultEnterprise = await authMethods[1].authorize(undefined, context)
  assert.equal(new URL(defaultEnterprise.url).hostname, 'quicksight.aws.amazon.com')
})

test('discovery refuses a non-Quick tenant before making a network request', async t => {
  const calls = t.mock.method(globalThis, 'fetch', () => { throw new Error('unexpected outbound request') })
  const flow = await authMethods[0].authorize()
  const { port, nonce } = readSurface(flow)
  const result = flow.callback()
  const reply = await sendCallback(port, '/callback', { nonce, tenantUrl: 'https://quick.aws.com.example.test/', issuer: 'https://issuer.example.test' })
  assert.equal(reply.status, 400)
  assert.equal((await result).type, 'failed')
  assert.equal(calls.mock.callCount(), 0)
})

test('Magpie cancelling the callback closes the ephemeral listener', async () => {
  const flow = await authMethods[0].authorize()
  const { port } = readSurface(flow)
  const abort = new AbortController()
  const waiting = flow.callback(undefined, { signal: abort.signal })
  abort.abort()
  assert.equal((await waiting).type, 'failed')
  await assert.rejects(sendCallback(port, '/callback', {}))
})

test('refresh rotates a selected account once for concurrent requests', async t => {
  const meta = { accountId: 'account1', email: 'user@example.test', actorArn: 'arn:fixture', tenant: 'https://tenant.quick.aws.com',
    provider: 'social', clientId: 'client', clientSecret: 'secret', refreshToken: 'old-refresh', tokenEndpoint: 'https://oidc.us-east-1.amazonaws.com/token' }
  const old = { type: 'oauth', access: 'old', expires: Date.now(), refresh: JSON.stringify(meta) }
  const calls = t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(url, meta.tokenEndpoint)
    assert.equal(JSON.parse(init.body).refreshToken, 'old-refresh')
    return Response.json({ accessToken: 'new', refreshToken: 'new-refresh', expiresIn: 3600 })
  })
  let saved, saves = 0
  const save = async auth => { saved = auth; saves++ }
  const get = async () => saved || old
  const sessions = await Promise.all([getSession(get, save), getSession(get, save)])
  assert.equal(calls.mock.callCount(), 1)
  assert.equal(saves, 1)
  assert.equal(sessions[0].jwt, 'new')
  assert.deepEqual(sessions[0], sessions[1])
  assert.equal(JSON.parse(saved.refresh).refreshToken, 'new-refresh')
  assert.equal((await getSession(get, save)).accountId, meta.accountId)
  assert.equal(calls.mock.callCount(), 1)
  await assert.rejects(refreshAuth({ ...old, refresh: JSON.stringify({ ...meta, tokenEndpoint: 'https://elsewhere.example.test' }) }), /Untrusted/)
  assert.equal(calls.mock.callCount(), 1)
})

test('classifies permanent refresh rejection for Magpie and retains an unrotated refresh token', async t => {
  const meta = { accountId: 'uid', email: 'u@example.test', actorArn: 'arn:test', tenant: 'https://tenant.quick.aws.com',
    provider: 'enterprise', clientId: 'client', refreshToken: 'original', tokenEndpoint: 'https://login.microsoftonline.com/tenant/token' }
  const auth = { type: 'oauth', access: 'old', expires: 1, refresh: JSON.stringify(meta) }
  let reply
  const vendor = t.mock.method(globalThis, 'fetch', async (_url, init) => {
    assert.equal(init.body.get('grant_type'), 'refresh_token')
    assert.equal(init.body.get('refresh_token'), 'original')
    return reply
  })
  for (const [status, code, expired] of [[400, 'invalid_grant', true], [400, 'expired_token', true], [401, 'invalid_client', true],
    [400, 'slow_down', false], [429, 'throttled', false], [503, 'server_error', false]]) {
    reply = Response.json({ error: code, error_description: 'sensitive-vendor-detail' }, { status })
    await assert.rejects(refreshAuth(auth), err => {
      assert.equal(err.signIn === 'expired', expired)
      assert.ok(!err.message.includes('sensitive-vendor-detail'))
      return true
    })
  }
  reply = Response.json({ access_token: 'new', expires_in: 3600 })
  const updated = await refreshAuth(auth)
  assert.equal(updated.access, 'new')
  assert.equal(updated.uid, meta.accountId)
  assert.equal(JSON.parse(updated.refresh).refreshToken, 'original')
  const withoutRefresh = { ...auth, refresh: JSON.stringify({ ...meta, refreshToken: '' }) }
  const calls = vendor.mock.callCount()
  const fresh = { ...withoutRefresh, expires: Date.now() + 15_000 }
  assert.equal((await getSession(async () => fresh)).jwt, auth.access)
  await assert.rejects(refreshAuth(fresh), err => !err.signIn && err.status === 401)
  await assert.rejects(refreshAuth(withoutRefresh), { status: 401, signIn: 'expired' })
  assert.equal(vendor.mock.callCount(), calls)
})
