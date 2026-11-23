import { createHash, randomUUID } from 'node:crypto'
import { prepareTurn } from './messages.js'

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

// The host can share a loader between clients. Only opt into retaining a
// Quick thread when the client identifies a conversation. Never send that
// external ID to Quick. The conversation history itself stays with the caller.
export function conversationKey(headers, account, turn) {
  const id = headers.get('x-conversation-id') || headers.get('x-thread-id') || headers.get('x-magpie-session')
  if (!id) return null
  return digest([id, headers.get('authorization'), headers.get('x-api-key'), account.accountId,
    account.tenant, account.wsHost, account.provider, turn.model, turn.systemPrompt])
}

export async function* conversationUpdates(cache, key, body, turn, ttl, run, signal) {
  const messages = body.messages
  const previous = cache.get(key)
  // Consume the entry before any I/O. Concurrent branches must never write
  // to the same Quick thread, even if both started with the exact same text.
  cache.delete(key)
  const reply = messages.at(-2)
  let resume = previous && previous.expires > Date.now() && messages.at(-1).role === 'user'
    && reply?.role === 'assistant' && typeof reply.content === 'string' && !reply.tool_calls && !reply.function_call
    && digest(messages.slice(0, -2)) === previous.prefix
    && createHash('sha256').update(reply.content).digest('hex') === previous.reply

  while (true) {
    const threadId = resume ? previous.threadId : randomUUID()
    const input = resume ? prepareTurn({ ...body, messages: [
      ...messages.filter(m => m.role === 'system' || m.role === 'developer'), messages.at(-1),
    ] }) : turn
    const output = createHash('sha256')
    let emitted = false
    try {
      for await (const part of run({ ...input, threadId, createSession: !resume, keepSession: true })) {
        if (part.delta?.content) output.update(part.delta.content)
        if (part.finish === 'stop' && !signal.aborted) {
          const now = Date.now()
          for (const [k, entry] of cache) if (entry.expires <= now) cache.delete(k)
          cache.delete(key)
          if (cache.size >= 256) cache.delete(cache.keys().next().value)
          cache.set(key, { threadId, prefix: digest(messages), reply: output.digest('hex'), expires: now + ttl })
        }
        emitted = true
        yield part
      }
      return
    } catch (err) {
      if (!resume || emitted || !err.sessionMissing || signal.aborted) throw err
      resume = false
    }
  }
}
