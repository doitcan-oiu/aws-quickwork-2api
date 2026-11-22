import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter, once } from 'node:events'
import WebSocket, { WebSocketServer } from 'ws'
import { createChatFetch } from '../src/chat.js'
import { defaultOptions } from '../src/options.js'
import { decodeQuickFrame, encodeQuickFrame } from '../src/wire.js'
import { streamQuick } from '../src/transport.js'

const session = { provider: 'social', jwt: 'test-only', wsHost: 'example.plato.ai.aws.dev', actorArn: 'user' }
const message = { prompt: 'Say hello', systemPrompt: 'Be concise', model: 'fast' }
const aidpReply = Buffer.from('AAAAfwAAAB19psSuCzpldmVudC10eXBlBwAOcmF3T3V0cHV0RXZlbnR7InBheWxvYWQiOiJleUowZVhCbElqb2lkR1Y0ZEY5a1pXeDBZU0lzSW5CaGVXeHZZV1FpT25zaVpHVnNkR0VpT2lKb1pXeHNieUo5ZlE9PSJ902N97w==', 'base64')

function socketFixture(run, gateway = false) {
  const socket = Object.assign(new EventEmitter(), { readyState: WebSocket.CONNECTING })
  const sent = []
  socket.send = (frame, options) => {
    assert.equal(options.binary, true)
    const [envelope] = decodeQuickFrame(frame, true, gateway)
    const event = gateway ? envelope : JSON.parse(Buffer.from(envelope.payload.payload, 'base64').toString())
    sent.push(event)
    if (event.type === 'user_message') queueMicrotask(() => run(socket))
  }
  socket.close = socket.terminate = () => {
    socket.readyState = WebSocket.CLOSED
    socket.emit('close', 1000)
  }
  function connect(url, options) {
    assert.equal(url.protocol, 'wss:')
    assert.equal(url.hostname, session.wsHost)
    assert.equal(options.headers.Authorization, 'Bearer test-only')
    assert.equal(options.followRedirects, false)
    queueMicrotask(() => { socket.readyState = WebSocket.OPEN; socket.emit('open') })
    return socket
  }
  return { connect, sent, socket }
}

function emit(socket, type, payload = {}) {
  socket.emit('message', Buffer.from(JSON.stringify({ type, payload })), false)
}

test('Quick wire reads all AWS events in one websocket message and validates checksums', () => {
  const expected = { type: 'text_delta', payload: { delta: 'hello' } }
  assert.deepEqual(decodeQuickFrame(Buffer.concat([aidpReply, aidpReply]), true, false), [expected, expected])
  assert.deepEqual(decodeQuickFrame(Buffer.from(' \n' + JSON.stringify(expected)), true, false), [expected])
  const gateway = encodeQuickFrame(expected, true)
  assert.deepEqual(decodeQuickFrame(gateway, true, true), [expected])
  // Fixture with a self-described CBOR envelope around the Go gateway codec's payload.
  const tagged = Buffer.from('AAAAmQAAAFNLVppGDTptZXNzYWdlLXR5cGUHAAVldmVudAs6ZXZlbnQtdHlwZQcADXJhd0lucHV0RXZlbnQNOmNvbnRlbnQtdHlwZQcAEGFwcGxpY2F0aW9uL2Nib3LZ2fehZ3BheWxvYWRYKHsidHlwZSI6InRleHRfZGVsdGEiLCJwYXlsb2FkIjoibGVnYWN5In3jB3fe', 'base64')
  assert.deepEqual(decodeQuickFrame(tagged, true, true), [{ type: 'text_delta', payload: 'legacy' }])
  const broken = Buffer.from(aidpReply)
  broken[25] ^= 1
  assert.throws(() => decodeQuickFrame(broken, true, false))
  assert.throws(() => decodeQuickFrame(aidpReply.subarray(0, -1), true, false))
})

test('transport exchanges binary frames with a loopback Quick server', async (t) => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  t.after(() => {
    for (const client of server.clients) client.terminate()
    server.close()
  })
  await once(server, 'listening')
  const gatewaySession = { ...session, provider: 'gateway' }
  const received = []
  server.on('connection', socket => {
    socket.on('message', (data, binary) => {
      const [event] = decodeQuickFrame(data, binary, true)
      received.push(event.type)
      if (event.type === 'user_message') {
        const replies = [
          { type: 'text_delta', payload: { text: 'ok' } },
          { type: 'turn_usage', payload: { total_tokens: 12, output_tokens: 2 } },
          { type: 'turn_completed' },
        ]
        socket.send(Buffer.concat(replies.map(reply => encodeQuickFrame(reply, true))))
      }
    })
  })
  const connect = () => new WebSocket('ws://127.0.0.1:' + server.address().port)
  const result = []
  for await (const event of streamQuick(gatewaySession, message, AbortSignal.timeout(5000), connect)) result.push(event)
  assert.deepEqual(result[0], { type: 'text', text: 'ok' })
  assert.equal(result[1].prompt_tokens, 10)
  assert.deepEqual(received.slice(0, 4), ['session_connect', 'federate_status', 'session_create', 'user_message'])
})

test('a Quick turn streams content and usage, keeps final tool arguments and sums reported time once', async () => {
  const fixture = socketFixture(socket => {
    socket.emit('message', aidpReply, true)
    emit(socket, 'text_complete', { text: 'hello' })
    emit(socket, 'tool_start', { tool_id: 'tool1', tool_name: 'find' })
    emit(socket, 'tool_progress', { tool_id: 'tool1', input_delta: '{"q":' })
    emit(socket, 'tool_progress', { tool_id: 'tool1', input_delta: '"abc"}' })
    emit(socket, 'message_complete', {})
    emit(socket, 'turn_usage', { cache_read_tokens: 10, cache_write_tokens: 3, input_tokens: 7, output_tokens: 5, duration_ms: 48 })
    emit(socket, 'turn_usage', { total_tokens: 30, output_tokens: 2, duration_ms: 126 })
    emit(socket, 'turn_completed')
  })
  const timings = []
  const result = []
  for await (const event of streamQuick(session, { ...message, onTiming: v => timings.push(v) }, undefined, fixture.connect)) result.push(event)
  assert.deepEqual(result, [
    { type: 'text', text: 'hello' },
    { type: 'usage', prompt_tokens: 20, completion_tokens: 5, total_tokens: 25, cached_tokens: 10, duration_ms: 48 },
    { type: 'usage', prompt_tokens: 28, completion_tokens: 2, total_tokens: 30, cached_tokens: 0, duration_ms: 126 },
    { type: 'tool', id: 'tool1', name: 'find', arguments: '{"q":"abc"}' },
  ])
  assert.deepEqual(fixture.sent.map(e => e.type), ['session_connect', 'federate_status', 'session_create', 'user_message', 'session_delete'])
  assert.equal(fixture.sent[3].payload.system_prompt, message.systemPrompt)
  assert.equal(fixture.sent[3].payload.text, message.prompt)
  assert.equal(fixture.sent[3].payload.appVersion, '1.2.4660')
  assert.equal(fixture.sent[3].payload.surfaceType, 'QUICK_WORK_DESKTOP_WINDOWS')
  assert.equal(fixture.sent[3].payload.user_timezone, 'UTC')
  assert.equal(fixture.sent[3].payload.user_locale, 'en-US')
  assert.equal('thinking_effort' in fixture.sent[3].payload, false)
  assert.equal(timings.length, 1)
  assert.equal(timings[0].durationMs, 174)
  assert.ok(timings[0].endedAt > 0)
})

for (const gateway of [false, true]) {
  test((gateway ? 'Gateway' : 'AIDP') + ' uses saved client options throughout a chat request', async t => {
    const clientOptions = { ...defaultOptions, appVersion: '2.3.4567', surface: 'TEST_SURFACE',
      locale: 'zh-TW', timezone: 'Asia/Taipei', thinkingEffort: 'high', outpostId: 'outpost-test',
      workingSessionId: 'session-test', requestTimeoutSeconds: 17, keepSessions: true }
    const fixture = socketFixture(socket => {
      emit(socket, 'text_delta', { text: 'OK' })
      emit(socket, 'turn_completed')
    }, gateway)
    const connect = t.mock.fn(fixture.connect)
    const timeout = t.mock.method(AbortSignal, 'timeout')
    const fetch = createChatFetch({
      baseURL: 'https://example.invalid', models: { fast: {} }, clientOptions,
      session: () => gateway ? { ...session, provider: 'gateway' } : session,
      record() {},
      stream: (account, turn, signal) => streamQuick(account, turn, signal, connect),
    })
    const response = await fetch('https://example.invalid/chat/completions', { method: 'POST',
      body: JSON.stringify({ model: 'fast', messages: [{ role: 'user', content: 'hello' }] }) })
    assert.equal((await response.json()).choices[0].message.content, 'OK')
    assert.ok(timeout.mock.calls.some(call => call.arguments[0] === 17_000))
    const [url, { headers }] = connect.mock.calls[0].arguments
    assert.equal(headers['X-Surface-Type'], clientOptions.surface)
    assert.equal(headers['X-Outpost-Id'], clientOptions.outpostId)
    assert.equal(headers['X-Working-Session-Id'], clientOptions.workingSessionId)
    if (gateway) {
      assert.equal(url.search, '')
      assert.deepEqual(fixture.sent[0], { type: 'session_connect', session_id: clientOptions.outpostId })
    } else {
      assert.equal(url.searchParams.get('surfaceType'), clientOptions.surface)
      assert.equal(url.searchParams.get('outpostId'), clientOptions.outpostId)
      assert.equal(url.searchParams.get('workingSessionId'), clientOptions.workingSessionId)
      assert.equal(fixture.sent[0].payload.surfaceType, clientOptions.surface)
      assert.equal(fixture.sent[0].payload.outpostId, clientOptions.outpostId)
      assert.equal(fixture.sent[0].payload.appVersion, clientOptions.appVersion)
    }
    const turn = fixture.sent.find(event => event.type === 'user_message').payload
    assert.equal(turn.surfaceType, clientOptions.surface)
    assert.equal(turn.outpostId, clientOptions.outpostId)
    assert.equal(turn.appVersion, clientOptions.appVersion)
    assert.equal(turn.user_locale, clientOptions.locale)
    assert.equal(turn.user_timezone, clientOptions.timezone)
    assert.equal(turn.thinking_effort, clientOptions.thinkingEffort)
    assert.equal(fixture.sent.some(event => event.type === 'session_delete'), false)
    assert.equal(fixture.socket.readyState, WebSocket.CLOSED)
  })
}

test('the configured transport deadline closes a turn before its idle timeout', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const fixture = socketFixture(socket => emit(socket, 'text_delta', { text: 'start' }))
  const stream = streamQuick(session, {
    ...message, clientOptions: { ...defaultOptions, requestTimeoutSeconds: 9 },
  }, undefined, fixture.connect)
  assert.equal((await stream.next()).value.text, 'start')
  t.mock.timers.tick(8999)
  assert.equal(fixture.socket.readyState, WebSocket.OPEN)
  t.mock.timers.tick(1)
  await assert.rejects(stream.next(), err => err.status === 504)
  assert.equal(fixture.sent.at(-1).type, 'session_delete')
})

test('consumer return after output still records elapsed time and deletes the session', async () => {
  const fixture = socketFixture(socket => { emit(socket, 'text_delta', { text: 'first' }) })
  const timings = []
  const stream = streamQuick(session, { ...message, onTiming: v => timings.push(v) }, undefined, fixture.connect)
  await stream.next()
  await stream.return()
  assert.equal(timings.length, 1)
  assert.ok(timings[0].durationMs >= 0)
  assert.equal(fixture.sent.at(-1).type, 'session_delete')
})

test('cancel takes precedence over text which has already arrived in the same websocket packet', async () => {
  const controller = new AbortController()
  const fixture = socketFixture(socket => socket.emit('message', Buffer.concat([aidpReply, aidpReply]), true))
  const stream = streamQuick(session, message, controller.signal, fixture.connect)
  assert.equal((await stream.next()).value.text, 'hello')
  controller.abort()
  await assert.rejects(stream.next(), error => error.status === 499)
  assert.equal(fixture.sent.at(-1).type, 'session_delete')
})

test('a silent socket finishes completed output and times out an unfinished turn', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  for (const type of ['text_complete', 'text_delta']) {
    const timings = []
    const fixture = socketFixture(socket => emit(socket, type, { text: 'hello' }))
    const stream = streamQuick(session, { ...message, onTiming: v => timings.push(v) }, undefined, fixture.connect)
    assert.equal((await stream.next()).value.text, 'hello')
    t.mock.timers.tick(120_000)
    if (type === 'text_complete') assert.equal((await stream.next()).done, true)
    else await assert.rejects(stream.next(), error => error.status === 504)
    assert.equal(timings.length, 1)
    assert.ok(timings[0].durationMs < 120_000)
    assert.equal(fixture.sent.at(-1).type, 'session_delete')
  }
})

test('partial upstream durations fall back to one elapsed duration, cancellation excludes silent wait', async () => {
  const controller = new AbortController()
  const fixture = socketFixture(socket => {
    emit(socket, 'turn_usage', { input_tokens: 7, duration_ms: 9999999 })
    emit(socket, 'turn_usage', { output_tokens: 5 })
  })
  const timings = []
  const stream = streamQuick(session, { ...message, onTiming: v => timings.push(v) }, controller.signal, fixture.connect)
  await stream.next()
  await stream.next()
  const cutoff = Date.now()
  await new Promise(resolve => setTimeout(resolve, 15))
  controller.abort()
  await assert.rejects(stream.next(), e => e.status === 499)
  assert.equal(timings.length, 1)
  assert.ok(timings[0].durationMs >= 0 && timings[0].durationMs < 9999999)
  assert.ok(timings[0].endedAt <= cutoff)
})

test('credential targets and handshake failures are checked before any usage is recorded', async () => {
  let connects = 0
  const timings = []
  const input = { ...message, onTiming: v => timings.push(v) }
  for (const values of [{ wsHost: 'test-only@outside.invalid/example.plato.ai.aws.dev' }, { wsPath: '//outside.invalid' }]) {
    await assert.rejects(streamQuick({ ...session, ...values }, input, undefined, () => connects++).next(), e => e.status === 400 && !e.message.includes('test-only'))
  }
  assert.equal(connects, 0)
  const socket = Object.assign(new EventEmitter(), { readyState: WebSocket.CLOSED })
  const connect = () => {
    queueMicrotask(() => socket.emit('error', new Error('Unexpected server response: 403')))
    return socket
  }
  await assert.rejects(streamQuick(session, input, undefined, connect).next(), e => e.status === 403)
  assert.equal(timings.length, 0)
})
