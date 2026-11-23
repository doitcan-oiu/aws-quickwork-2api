import { randomUUID } from 'node:crypto'
import { EventEmitter, on } from 'node:events'
import WebSocket from 'ws'
import { isQuickHost } from './auth.js'
import { uploadPromptAttachment } from './attachments.js'
import { relayPrompt, withToolReference } from './messages.js'
import { defaultOptions } from './options.js'
import { quickEvents, encodeQuickFrame, quickError, upstreamFailure } from './wire.js'

const aidpPath = '/streaming/quickwork-chat-bidirectional-stream'
const gatewayPath = '/ws/service/SpaceNeedleConversationService/operation/ChatBidirectionalStream'
// Allow Quick's 1 KiB margin below the 64 KiB inner JSON limit. The AIDP
// base64 and the Gateway event-stream envelopes do not count towards it.
const userMessageBudget = 63 * 1024
const terminal = new Set(['turn_completed', 'turn_ended', 'stream_ended', 'chat_complete'])
const toolEvents = new Set(['tool_start', 'tool_arguments', 'tool_arguments_edited', 'tool_progress',
  'tool_result', 'tool_error', 'tool_complete', 'tool_call', 'tool_call_update'])

function destination(session, gateway, { surface, outpostId, workingSessionId }) {
  const host = session.wsHost
  const path = gateway ? gatewayPath : aidpPath
  if (typeof host !== 'string' || !/^[a-z0-9.-]+$/.test(host) || !isQuickHost(host) || (session.wsPath && session.wsPath !== path)) {
    throw quickError('Invalid Amazon Quick connection endpoint', 400)
  }
  if (typeof session.jwt !== 'string' || !session.jwt || /[\s\x00-\x1f\x7f]/.test(session.jwt)) {
    throw quickError('Amazon Quick sign-in is required', 401)
  }
  // Credential-bearing connections always use the validated host and fixed path.
  const url = new URL('wss://' + host + path)
  if (!gateway) {
    url.searchParams.set('surfaceType', surface)
    if (outpostId) url.searchParams.set('outpostId', outpostId)
    if (workingSessionId) url.searchParams.set('workingSessionId', workingSessionId)
    if (session.provider === 'social') url.searchParams.set('token', session.jwt)
  }
  return url
}

function count(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0
}

function usageEvent(p) {
  const cached = count(p.cache_read_tokens)
  const inputs = count(p.input_tokens) + cached + count(p.cache_write_tokens)
  const outputs = count(p.output_tokens)
  const total = count(p.total_tokens) || (inputs + outputs)
  const usage = { type: 'usage', prompt_tokens: total >= outputs ? total - outputs : inputs,
    completion_tokens: outputs, cached_tokens: cached, total_tokens: total }
  if (Number.isSafeInteger(p.duration_ms) && p.duration_ms >= 0) usage.duration_ms = p.duration_ms
  return usage
}

function rememberTool(tools, type, p) {
  if (type === 'tool_result' || type === 'tool_error') return
  const name = p.tool_name || p.name || p.function?.name
  const fromWire = p.tool_id || p.tool_call_id || p.toolCallId || p.id
  const key = fromWire || name || p.title
  if (!key) return
  const tool = tools.get(key) || { type: 'tool', id: fromWire || 'call_' + randomUUID(), name: '', arguments: '' }
  if (typeof name === 'string') tool.name = name
  else if (!tool.name && typeof p.title === 'string') tool.name = p.title
  const args = p.arguments ?? p.function?.arguments ?? p.rawInput ?? p.raw_input
  const delta = p.input_delta ?? p.progress?.input_delta
  if (args != null) {
    tool.arguments = typeof args === 'string' ? args : JSON.stringify(args)
    // tool_start may contain an empty placeholder before the first delta.
    if (type === 'tool_start' && tool.arguments.trim() === '{}') tool.arguments = ''
    tool.finalized = Boolean(tool.arguments)
  } else if (!tool.finalized && typeof delta === 'string') tool.arguments += delta
  tools.set(key, tool)
}

function userMessageFits(payload) {
  return Buffer.byteLength(JSON.stringify({ type: 'user_message', payload })) <= userMessageBudget
}

async function fitUserMessage(payload, input, session, gateway, signal) {
  if (userMessageFits(payload)) return payload
  const tooLarge = () => Object.assign(quickError('This turn exceeds the Amazon Quick 64 KiB message limit.', 413), { expose: true })
  if (gateway || !session.tenant) throw tooLarge()
  async function attach(name, text, attachmentText) {
    // Include the minimum attachment metadata before spending an upload on this layout.
    const metadata = { type: 'file', name, size: Buffer.byteLength(attachmentText), mimeType: 'text/plain', path: '' }
    const outgoing = { ...payload, text, attachments: [metadata] }
    if (!userMessageFits(outgoing)) return null
    outgoing.attachments = [await uploadPromptAttachment(session, payload.thread_id, name, attachmentText, signal)]
    return userMessageFits(outgoing) ? outgoing : null
  }
  const referenceName = 'tool-reference-' + payload.message_id + '.txt'
  const reference = withToolReference(input, referenceName)
  if (reference) {
    const fitted = await attach(referenceName, reference.text, reference.attachmentText)
    if (fitted) return fitted
  }
  const name = 'prompt-' + payload.message_id + '.txt'
  const attachmentCue = 'Read the conversation for this turn in the attached file ' + name + ' and continue it as the assistant.'
    + (input.tools?.enabled ? ' The attachment supplies conversation context. Use the listed client functions for actions in the user’s environment.' : '')
  const text = input.transcript === undefined ? attachmentCue : relayPrompt(input.systemPrompt, attachmentCue)
  const fitted = await attach(name, text, input.transcript ?? input.prompt)
  if (!fitted) throw tooLarge()
  return fitted
}

// This timestamp is taken in the socket handler. A slow downstream consumer
// must not inflate the time charged to the upstream turn.
function stamp() {
  return { epoch: Date.now(), monotonic: performance.now() }
}

export async function* streamQuick(session, input, signal, connect = (url, options) => new WebSocket(url, options)) {
  const abortError = () => signal.reason?.name === 'TimeoutError'
    ? quickError('Amazon Quick request timed out', 504)
    : quickError('Amazon Quick request canceled', 499)
  if (signal?.aborted) throw abortError()
  if (!input.prompt?.trim()) throw quickError('Quick requires a non-empty message', 400)
  const gateway = session.provider === 'gateway' || session.provider === 'social_gateway'
  const options = input.clientOptions ?? defaultOptions
  const { appVersion, surface, outpostId, workingSessionId } = options
  const keepSession = input.keepSession ?? options.keepSessions
  const url = destination(session, gateway, options)
  const thread = input.threadId || randomUUID()
  const title = input.title || Array.from(input.prompt.replace(/\s+/g, ' ').trim()).slice(0, 60).join('')
  let socket
  try {
    socket = connect(url, {
      headers: { Authorization: 'Bearer ' + session.jwt, Origin: 'file://', 'X-Surface-Type': surface,
        'X-Outpost-Id': outpostId, 'X-Agent-Service-Type': 'UNIFIED_QUICK',
        ...(workingSessionId ? { 'X-Working-Session-Id': workingSessionId } : {}) },
      followRedirects: false, handshakeTimeout: 20_000, maxPayload: 16 * 1024 * 1024,
    })
  } catch {
    throw quickError('Could not open the Amazon Quick connection')
  }

  const bus = new EventEmitter()
  const packets = on(bus, 'packet')
  const push = (packet) => bus.emit('packet', packet)
  let started, progress, completed, quietTimer, idleTimer
  let created = false, success = false
  const upload = new AbortController()
  function closeConnection() {
    if (socket.readyState === WebSocket.OPEN) {
      try {
        if ((!keepSession && (created || started)) || (created && !success && input.keepSession === true)) {
          send('session_delete', { session_id: thread })
        }
        socket.close()
      } catch { socket.terminate() }
    } else if (socket.readyState === WebSocket.CONNECTING) socket.terminate()
  }
  socket.once('open', () => push({ kind: 'open' }))
  socket.on('message', (data, binary) => {
    idleTimer?.refresh()
    push({ kind: 'message', data, binary, at: stamp() })
  })
  socket.on('error', (error) => {
    const match = /^Unexpected server response: ([1-5]\d{2})$/.exec(error.message)
    const status = match ? Number(match[1]) : 502
    const failure = quickError('Amazon Quick connection failed (HTTP ' + status + ')', status)
    upload.abort(failure)
    push({ error: failure })
  })
  socket.once('close', (code) => {
    upload.abort(quickError('Amazon Quick closed the connection (' + code + ')'))
    push({ kind: 'closed', code })
  })
  function abort() {
    const error = abortError()
    upload.abort(error)
    push({ error })
    closeConnection()
  }
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) abort()
  const deadline = setTimeout(() => {
    const error = quickError('Amazon Quick request timed out', 504)
    upload.abort(error)
    push({ error })
    closeConnection()
  }, options.requestTimeoutSeconds * 1000)
  const keepalive = setInterval(() => {
    if (socket.readyState === WebSocket.OPEN) {
      try { socket.ping() } catch { push({ error: quickError('Amazon Quick connection lost') }) }
    }
  }, 25_000)
  function send(type, payload) {
    socket.send(encodeQuickFrame({ type, payload }, gateway), { binary: true })
  }
  const tools = new Map()
  const textMessages = new Set()
  let sawUsage = false, completeUsage = true, reportedMs = 0
  try {
    loop: for await (const [packet] of packets) {
      if (signal?.aborted) throw abortError()
      if (packet.error) throw packet.error
      if (packet.kind === 'open') {
        if (gateway) {
          socket.send(encodeQuickFrame({ type: 'session_connect', session_id: outpostId }, true), { binary: true })
        } else {
          send('session_connect', { actor_id: session.actorArn || '', surfaceType: surface, outpostId,
            appVersion, external_agent_sign_in: 1, recents_promotion: 1 })
        }
        send('federate_status', {})
        if (input.createSession !== false) {
          send('session_create', { session_id: thread, title })
          created = true
        }
        const payload = {
          text: input.prompt, send_origin: 'programmatic', had_physical_input: false,
          surfaceType: surface, outpostId, appVersion, traceId: randomUUID(),
          message_id: randomUUID(), thread_id: thread, agent_mode: input.model || 'smart',
          user_timezone: options.timezone, user_locale: options.locale, chat_agent_id: input.chatAgentId || options.chatAgentId || null, auto_routing: false,
          web_search_enabled: false, pre_approved_tools: [], preload_skills: [], panel_edits: [],
          custom_prompt: null, ...(input.transcript === undefined && input.systemPrompt ? { system_prompt: input.systemPrompt } : {}),
          ...(options.thinkingEffort !== 'off' ? { thinking_effort: options.thinkingEffort } : {}),
        }
        const fitted = await fitUserMessage(payload, input, session, gateway, upload.signal)
        upload.signal.throwIfAborted()
        send('user_message', fitted)
        started = stamp()
        idleTimer = setTimeout(() => push({ kind: 'idle' }), 120_000)
        continue
      }
      if (packet.kind === 'finished') break
      if (packet.kind === 'idle') {
        if (completed && progress) break
        throw quickError('Amazon Quick stopped sending events', 504)
      }
      if (packet.kind === 'closed') {
        if (progress && (completed || packet.code === 1000)) break
        throw quickError('Amazon Quick closed the connection (' + packet.code + ')')
      }
      for (const event of quickEvents(packet.data, packet.binary, gateway)) {
        if (signal?.aborted) throw abortError()
        const type = event?.type
        const p = event?.payload ?? {}
        if (type === 'text_delta' || type === 'text_complete') {
          const text = typeof p === 'string' ? p : (p.delta || p.text)
          const message = event.message_id || p.message_id || ''
          if (type === 'text_complete') completed = packet.at
          if (typeof text === 'string' && text && (type === 'text_delta' || !textMessages.has(message))) {
            progress = packet.at
            if (type === 'text_delta') {
              completed = undefined
              clearTimeout(quietTimer)
            }
            textMessages.add(message)
            yield { type: 'text', text }
          }
        } else if (type === 'turn_usage') {
          const usage = usageEvent(p)
          sawUsage = true
          if (usage.duration_ms === undefined || !Number.isSafeInteger(reportedMs + usage.duration_ms)) {
            completeUsage = false
          } else {
            reportedMs += usage.duration_ms
          }
          if (usage.duration_ms !== undefined || usage.total_tokens > 0) progress = packet.at
          yield usage
        } else if (toolEvents.has(type)) {
          rememberTool(tools, type, p)
          progress = packet.at
          completed = undefined
          clearTimeout(quietTimer)
        } else if (type === 'message_complete') {
          for (const tool of p.tool_calls || []) rememberTool(tools, type, tool)
          if (p.tool_calls?.length) progress = packet.at
          clearTimeout(quietTimer)
          completed = p.continuation_expected ? undefined : (completed || packet.at)
          if (p.continuation_expected) textMessages.delete('')
          // Some Quick backends send usage after message_complete and never send turn_completed.
          if (!p.continuation_expected) quietTimer = setTimeout(() => push({ kind: 'finished' }), 5000)
        } else if (terminal.has(type)) {
          completed ||= packet.at
          break loop
        } else if (['error', 'turn_failed', 'session_error', 'stream_error', 'turn_aborted'].includes(type)) {
          throw upstreamFailure(p.status_code, event.status_code, p.code, p.error_code, p.error?.code, event.code, event.error_code)
        } else if (type === 'ping' && socket.readyState === WebSocket.OPEN) {
          socket.pong()
        }
      }
    }
    for (const tool of tools.values()) {
      if (signal?.aborted) throw abortError()
      if (tool.name) yield { type: 'tool', id: tool.id, name: tool.name, arguments: tool.arguments || '{}' }
    }
    success = Boolean(textMessages.size || tools.size)
  } catch (error) {
    if (error?.sessionMissing && (input.createSession !== false || progress)) delete error.sessionMissing
    if (signal?.aborted) throw abortError()
    if (error?.name === 'AbortError' && upload.signal.aborted) throw upload.signal.reason
    if (error?.name === 'TimeoutError') throw quickError('Amazon Quick request timed out', 504)
    if (error?.status) throw error
    throw quickError('Could not process the Amazon Quick stream')
  } finally {
    signal?.removeEventListener('abort', abort)
    clearTimeout(deadline)
    clearTimeout(idleTimer)
    clearTimeout(quietTimer)
    clearInterval(keepalive)
    await packets.return()
    closeConnection()
    if (started && progress && input.onTiming) {
      const end = completed || progress
      const durationMs = sawUsage && completeUsage ? reportedMs : Math.max(0, Math.round(end.monotonic - started.monotonic))
      await input.onTiming({ durationMs, endedAt: end.epoch })
    }
  }
}
