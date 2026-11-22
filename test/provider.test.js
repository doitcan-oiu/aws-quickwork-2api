import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { AmazonQuickPlugin } from '../index.js'
import { createChatFetch } from '../src/chat.js'
import { accountUsage, recordTurn } from '../src/usage.js'

const baseURL = 'https://amazon-quick.invalid/v1'
const account = { accountId: 'fixture-key', email: 'test@example.invalid' }
const req = { model: 'fast', messages: [{ role: 'user', content: 'test' }] }

function post(fn, data) {
  return fn(baseURL + '/chat/completions', { method: 'POST', body: JSON.stringify(data) })
}

function client(stream, record = () => {}) {
  return createChatFetch({ baseURL, models: { fast: {} }, stream, record, session: async () => account })
}

test('register provider, account hooks and four text models', async () => {
  const hooks = await AmazonQuickPlugin({ client: {}, directory: tmpdir(), magpie: {} })
  const cfg = { provider: { other: { name: 'untouched' } } }
  await hooks.config(cfg)
  assert.equal(cfg.provider.other.name, 'untouched')
  assert.deepEqual(Object.keys(cfg.provider['amazon-quick'].models), ['smart', 'fast', 'balanced', 'auto'])
  assert.equal(cfg.provider['amazon-quick'].npm, '@ai-sdk/openai-compatible')
  assert.deepEqual(hooks.auth.methods.map(method => method.type), ['oauth', 'oauth'])
  assert.equal(typeof hooks.auth.refresh, 'function')
  assert.equal(typeof hooks.auth.usage, 'function')
})

test('JSON and SSE report the same content and aggregate per-step cache usage', async () => {
  let saved = 0
  const fetch = client(async function* (session, turn) {
    assert.equal(session, account)
    assert.equal(turn.prompt, 'test')
    yield { type: 'text', text: 'O' }
    yield { type: 'usage', prompt_tokens: 4, completion_tokens: 1, total_tokens: 5, cached_tokens: 3 }
    yield { type: 'text', text: 'K' }
    yield { type: 'usage', prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 }
    await turn.onTiming({ durationMs: 1250, endedAt: Date.now() })
  }, (id, timing) => { assert.equal(id, account.accountId); saved += timing.durationMs })
  const json = await (await post(fetch, req)).json()
  assert.equal(json.choices[0].message.content, 'OK')
  assert.equal(json.choices[0].finish_reason, 'stop')
  assert.deepEqual(json.usage, { prompt_tokens: 6, completion_tokens: 2, total_tokens: 8, prompt_tokens_details: { cached_tokens: 3 } })
  const response = await post(fetch, { ...req, stream: true, stream_options: { include_usage: true } })
  assert.equal(response.status, 200)
  const frames = (await response.text()).trim().split('\n\n').map(line => line.slice(6))
  assert.equal(frames.pop(), '[DONE]')
  const chunks = frames.map(x => JSON.parse(x))
  assert.equal(chunks[0].choices[0].delta.role, 'assistant')
  assert.equal(chunks.map(c => c.choices[0]?.delta?.content).filter(Boolean).join(''), 'OK')
  assert.deepEqual(chunks.at(-1).usage, json.usage)
  assert.equal(saved, 2500)
})

test('pre-stream failure is an HTTP error and malformed input never opens a socket', async () => {
  let attempts = 0
  const fetch = client(async function* () {
    attempts++
    throw Object.assign(new Error('secret bearer'), { status: 429 })
  })
  assert.equal((await post(fetch, { ...req, model: '__proto__' })).status, 400)
  const response = await post(fetch, { ...req, stream: true })
  assert.equal(response.status, 429)
  assert.doesNotMatch(await response.text(), /secret/)
  assert.equal(attempts, 1)
})

test('a streamed error after the first delta terminates the response without leaking upstream details', async () => {
  const fetch = client(async function* () {
    yield { type: 'text', text: 'Hello' }
    throw new Error('private upstream detail')
  })
  const response = await post(fetch, { ...req, stream: true })
  const body = await response.text()
  assert.equal(response.status, 200)
  assert.match(body, /"content":"Hello"/)
  assert.match(body, /"code":502/)
  assert.doesNotMatch(body, /private upstream detail/)
  assert.ok(body.endsWith('data: [DONE]\n\n'))
})

test('cancelling the response closes the upstream stream', { timeout: 3000 }, async () => {
  let closed = false
  const fetch = client(async function* (_account, _turn, signal) {
    try {
      yield { type: 'text', text: 'Hello' }
      signal.throwIfAborted()
      await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }))
    } finally {
      closed = signal.aborted
    }
  })
  const response = await post(fetch, { ...req, stream: true })
  const reader = response.body.getReader()
  await reader.read()
  await reader.read()
  await reader.cancel()
  assert.equal(closed, true)
})

test('use the completion month and keep accounts separate across restarts', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'amazon-quick-usage-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const end = new Date('2026-11-30T23:59:59Z')
  const december = new Date('2026-12-01T00:00:00Z')
  await Promise.all([1, 2].map(() => recordTurn(directory, account.accountId, { durationMs: 600_000, endedAt: end.valueOf() })))
  assert.equal((await accountUsage(directory, account, 10, end)).windows[0].display, '9小时40分')
  assert.equal((await accountUsage(directory, account, 10, december)).windows[0].display, '10小时')
  assert.equal((await accountUsage(directory, { accountId: 'other' }, 10, end)).windows[0].display, '10小时')
  assert.equal((await accountUsage(directory, account, 0.25, end)).windows[0].display, '0秒')
})
