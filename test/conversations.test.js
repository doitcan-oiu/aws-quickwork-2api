import assert from 'node:assert/strict'
import test from 'node:test'
import { createChatFetch } from '../src/chat.js'
import { defaultOptions } from '../src/options.js'

const baseURL = 'https://amazon-quick.invalid/v1'
const headers = { 'x-conversation-id': 'client-conversation', authorization: 'Bearer client-a' }
const user = content => ({ role: 'user', content })
const assistant = content => ({ role: 'assistant', content })
const first = [user('first question')]
const next = [...first, assistant('answer'), user('second question')]

function client(stream = async function* () { yield { type: 'text', text: 'answer' } }, reuse = true) {
  const turns = []
  const account = { accountId: 'a', wsHost: 'test.quick.aws.com', provider: 'social' }
  const fetch = createChatFetch({
    baseURL, models: { fast: {}, smart: {} }, clientOptions: { ...defaultOptions, sessionReuse: reuse },
    session: async () => account,
    stream: async function* (session, turn) {
      turns.push({ ...turn, accountId: session.accountId })
      yield* stream(turn, turns.length)
    },
  })
  function post(messages, body = {}, requestHeaders = headers) {
    return fetch(baseURL + '/chat/completions', { method: 'POST', headers: requestHeaders,
      body: JSON.stringify({ model: 'fast', messages, ...body }) })
  }
  return { turns, account, post }
}

test('a stable conversation resumes the same Quick thread after JSON and streamed replies', async () => {
  const { turns, post } = client(async function* () {
    yield { type: 'text', text: 'an' }
    yield { type: 'text', text: 'swer' }
  })
  const instructions = { role: 'developer', content: 'Keep it short.' }
  const response = await post([instructions, ...first])
  const firstReply = (await response.json()).choices[0].message
  assert.deepEqual(firstReply, assistant('answer'))
  const second = [instructions, ...first, firstReply, user('second question')]
  const frames = await (await post(second, { stream: true })).text()
  assert.match(frames, /"finish_reason":"stop"/)
  assert.ok(frames.endsWith('data: [DONE]\n\n'))
  assert.equal((await post([...second, assistant('answer'), user('third question')])).status, 200)
  assert.notEqual(turns[0].threadId, headers['x-conversation-id'])
  assert.ok(turns[0].threadId)
  assert.deepEqual(turns.map(t => t.threadId), Array(3).fill(turns[0].threadId))
  assert.deepEqual(turns.map(t => t.createSession), [true, false, false])
  assert.deepEqual(turns.map(t => t.transcript), ['first question', 'second question', 'third question'])
  assert.ok(turns.every(t => t.accountId === 'a' && t.keepSession && t.prompt.includes(instructions.content)))
})

test('edited history, credentials, model or account never borrow a retained thread', async () => {
  const cases = [
    { messages: [user('edited first question'), ...next.slice(1)] },
    { messages: [first[0], assistant('changed answer'), next[2]] },
    { headers: { ...headers, authorization: 'Bearer client-b' } },
    { headers: { ...headers, 'x-api-key': 'client-b-key' } },
    { body: { model: 'smart' } },
    { accountId: 'b' },
  ]
  for (const variant of cases) {
    const { account, turns, post } = client()
    assert.equal((await post(first)).status, 200)
    if (variant.accountId) account.accountId = variant.accountId
    const messages = variant.messages || next
    assert.equal((await post(messages, variant.body, variant.headers)).status, 200)
    assert.equal(turns[1].createSession, true)
    assert.notEqual(turns[1].threadId, turns[0].threadId)
    assert.ok(turns[1].transcript.includes(messages[0].content))
    assert.ok(turns[1].transcript.includes(messages[1].content))
  }
})

test('without a conversation header or with reuse disabled the full transcript is sent normally', async () => {
  for (const [reuse, requestHeaders] of [[true, {}], [false, headers]]) {
    const { turns, post } = client(undefined, reuse)
    assert.equal((await post(first, {}, requestHeaders)).status, 200)
    assert.equal((await post(next, {}, requestHeaders)).status, 200)
    assert.ok(turns.every(t => !t.keepSession))
    assert.ok(turns[1].transcript.includes(first[0].content))
  }
})

test('a missing resumed session retries once with full history, only before visible output', async () => {
  const missing = () => Object.assign(new Error('expired test session'), { sessionMissing: true })
  for (const failReplay of [false, true]) {
    const { turns, post } = client(async function* (_turn, attempt) {
      if (attempt === 2 || (attempt === 3 && failReplay)) throw missing()
      yield { type: 'text', text: 'answer' }
    })
    assert.equal((await post(first)).status, 200)
    assert.equal((await post(next)).status, failReplay ? 502 : 200)
    assert.deepEqual(turns.map(t => t.createSession), [true, false, true])
    assert.equal(turns[1].threadId, turns[0].threadId)
    assert.notEqual(turns[2].threadId, turns[1].threadId)
    assert.equal(turns[1].transcript, 'second question')
    assert.ok(turns[2].transcript.includes('first question'))
  }
  const { turns, post } = client(async function* (_turn, attempt) {
    yield { type: 'text', text: 'answer' }
    if (attempt === 2) throw missing()
  })
  assert.equal((await post(first)).status, 200)
  const streamed = await (await post(next, { stream: true })).text()
  assert.match(streamed, /"error":/)
  assert.equal(turns.length, 2)
})

test('simultaneous branches never mutate the same upstream session', { timeout: 3000 }, async () => {
  const started = Promise.withResolvers()
  const release = Promise.withResolvers()
  const { turns, post } = client(async function* (_turn, attempt) {
    if (attempt === 2) {
      started.resolve()
      await release.promise
    }
    yield { type: 'text', text: 'answer' }
  })
  assert.equal((await post(first)).status, 200)
  const branch = post(next)
  await started.promise
  try {
    assert.equal((await post([...next.slice(0, -1), user('other question')])).status, 200)
    assert.deepEqual(turns.map(t => t.createSession), [true, false, true])
    assert.equal(turns[0].threadId, turns[1].threadId)
    assert.notEqual(turns[1].threadId, turns[2].threadId)
    assert.ok(turns[2].transcript.includes('first question'))
  } finally {
    release.resolve()
    await branch
  }
})
