import { randomUUID } from 'node:crypto'
import { prepareTurn, finishTools } from './messages.js'
import { streamQuick } from './transport.js'

function badRequest(message, status = 400) {
  return Object.assign(new Error(message), { status, expose: true })
}

function publicError(err) {
  const status = err?.name === 'TimeoutError' ? 504 :
    (Number.isInteger(err?.status) && err.status >= 400 && err.status <= 599 ? err.status : 502)
  const messages = {
    400: 'Invalid chat request', 401: 'Please sign in to Amazon Quick', 403: 'Amazon Quick denied access',
    429: 'Amazon Quick rate limit reached', 504: 'Amazon Quick request timed out',
  }
  return { status, body: { error: { message: err?.expose ? err.message : messages[status] || 'Amazon Quick request failed',
    type: status === 400 ? 'invalid_request_error' : 'upstream_error', code: status } } }
}

async function* updates(turn, events) {
  const usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, prompt_tokens_details: { cached_tokens: 0 } }
  const tools = [], buffered = []
  let hasText = false
  for await (const event of events) {
    if (event.type === 'text' && event.text) {
      hasText = true
      if (turn.tools.enabled) buffered.push(event.text)
      else yield { delta: { content: event.text } }
    } else if (event.type === 'tool' && turn.tools.enabled) {
      tools.push(event)
    } else if (event.type === 'usage') {
      for (const key of ['prompt_tokens', 'completion_tokens', 'total_tokens']) usage[key] += event[key] ?? 0
      usage.prompt_tokens_details.cached_tokens += event.cached_tokens ?? 0
    }
  }
  let finish = 'stop'
  if (turn.tools.enabled) {
    const result = finishTools(buffered.join(''), tools, turn.tools)
    if (result.text) yield { delta: { content: result.text } }
    hasText = Boolean(result.text)
    if (result.toolCalls.length) {
      const indexed = result.toolCalls.map((call, index) => ({ index, ...call }))
      yield { delta: { tool_calls: indexed } }
      finish = 'tool_calls'
    }
  }
  if (!hasText && finish === 'stop') throw new Error('Empty upstream reply')
  yield { finish, usage }
}

async function asJSON(iterator, base) {
  const content = []
  const message = { role: 'assistant', content: null }
  for await (const part of iterator) {
    if (part.delta?.content) content.push(part.delta.content)
    if (part.delta?.tool_calls) message.tool_calls = part.delta.tool_calls.map(({ index, ...call }) => call)
    if (part.finish) {
      message.content = content.length ? content.join('') : null
      return Response.json({ ...base, object: 'chat.completion', usage: part.usage,
        choices: [{ index: 0, message, finish_reason: part.finish }] })
    }
  }
  throw new Error('Empty upstream reply')
}

function asStream(iterator, first, base, includeUsage, controller) {
  const encoder = new TextEncoder()
  const chunk = (delta, finish_reason = null) => ({
    ...base, object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason }],
  })
  async function* frames() {
    try {
      yield chunk({ role: 'assistant' })
      let next = first
      while (!next.done) {
        const part = next.value
        if (part.delta) yield chunk(part.delta)
        else {
          yield chunk({}, part.finish)
          if (includeUsage) yield { ...base, object: 'chat.completion.chunk', choices: [], usage: part.usage }
        }
        next = await iterator.next()
      }
    } catch (err) {
      yield publicError(err).body
    } finally {
      await iterator.return()
    }
  }
  const chunks = frames()
  const body = new ReadableStream({
    async pull(out) {
      const item = await chunks.next()
      if (item.done) {
        out.enqueue(encoder.encode('data: [DONE]\n\n'))
        out.close()
      } else {
        out.enqueue(encoder.encode('data: ' + JSON.stringify(item.value) + '\n\n'))
      }
    },
    async cancel() {
      controller.abort()
      await chunks.return()
      await iterator.return()
    },
  })
  return new Response(body, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' } })
}

export function createChatFetch({ baseURL, models, session, record, stream = streamQuick }) {
  return async (url, init) => {
    const request = new Request(url, init)
    let signal = request.signal
    try {
      if (request.url !== baseURL + '/chat/completions') throw badRequest('Unsupported Amazon Quick endpoint', 404)
      if (request.method !== 'POST') throw badRequest('Use POST for chat completions', 405)
      let body
      try { body = await request.json() } catch { throw badRequest('Expected a JSON chat request') }
      if (!body || typeof body.model !== 'string' || !Object.hasOwn(models, body.model)) throw badRequest('Unknown Amazon Quick model')
      if (body.n != null && body.n !== 1) throw badRequest('Amazon Quick accepts one completion per request')
      const turn = prepareTurn(body)
      const controller = new AbortController()
      signal = AbortSignal.any([request.signal, controller.signal, AbortSignal.timeout(300_000)])
      signal.throwIfAborted()
      let account
      try { account = await session() }
      catch (err) { throw Object.assign(new Error('Account unavailable'), { status: err?.status || 401 }) }
      signal.throwIfAborted()
      const events = stream(account, { ...turn, onTiming: timing => record(account.accountId, timing) }, signal)
      const parts = updates(turn, events)
      const base = { id: 'chatcmpl-' + randomUUID(), created: Math.floor(Date.now() / 1000), model: body.model }
      if (!body.stream) return await asJSON(parts, base)
      // Leave handshake and authentication failures as HTTP errors so Magpie can pick another account.
      const first = await parts.next()
      return asStream(parts, first, base, body.stream_options?.include_usage === true, controller)
    } catch (err) {
      if (request.signal.aborted) throw request.signal.reason
      const { body, status } = publicError(signal.aborted ? signal.reason : err)
      return Response.json(body, { status })
    }
  }
}
