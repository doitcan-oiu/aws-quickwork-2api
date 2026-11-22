import { randomUUID } from 'node:crypto'

function badRequest(message) {
  throw Object.assign(new Error(message), { status: 400, expose: true })
}

function textContent(content) {
  if (content == null) return ''
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) badRequest('Amazon Quick accepts text content only.')
  return content.map(part => {
    if (typeof part === 'string') return part
    if (['text', 'input_text', 'output_text'].includes(part?.type) && typeof part.text === 'string') return part.text
    badRequest('Amazon Quick accepts text content only.')
  }).join('')
}

function toolSettings(body) {
  const declared = body.tools ?? []
  const functions = body.functions ?? []
  if (!Array.isArray(declared) || !Array.isArray(functions)) badRequest('Invalid tool definitions.')
  const definitions = new Map()
  for (const item of [...declared, ...functions.map(fn => ({ type: 'function', function: fn }))]) {
    const fn = item?.function
    if (item?.type !== 'function' || typeof fn?.name !== 'string' || !fn.name.trim()) {
      badRequest('Amazon Quick supports named function tools only.')
    }
    definitions.set(fn.name, { name: fn.name, description: fn.description, parameters: fn.parameters })
  }
  const choice = body.tool_choice ?? body.function_call ?? 'auto'
  let required = false
  if (choice === 'none') definitions.clear()
  else if (choice === 'required') required = true
  else if (choice !== 'auto') {
    const name = choice?.function?.name ?? choice?.name
    if (!definitions.has(name) || (choice.type && choice.type !== 'function')) badRequest('tool_choice must name a declared function.')
    const selected = definitions.get(name)
    definitions.clear()
    definitions.set(name, selected)
    required = true
  }
  if (required && !definitions.size) badRequest('A required tool must be declared.')
  if (body.parallel_tool_calls != null && typeof body.parallel_tool_calls !== 'boolean') badRequest('parallel_tool_calls must be a boolean.')
  return { enabled: definitions.size > 0, allowed: definitions, parallel: body.parallel_tool_calls !== false, required }
}

function toolInstructions(tools) {
  const names = [...tools.allowed.keys()]
  return [
    'The caller can execute the following functions:',
    JSON.stringify([...tools.allowed.values()]),
    'These client functions are available through a text bridge. For a native function call, emit one marker per call; the bridge converts it to the caller’s tool_calls field.',
    '<client_tool_call>{"name":' + JSON.stringify(names.length === 1 ? names[0] : 'FUNCTION_NAME') + ',"arguments":{}}</client_tool_call>',
    'When requesting a function, use the actual arguments from the task and follow its parameter schema. Output the marker alone and wait for the caller to return the result.',
    tools.required && (names.length === 1 ? 'You must call ' + JSON.stringify(names[0]) + ' this turn.' : 'You must call at least one listed function this turn.'),
    !tools.parallel && 'Call at most one function in this turn.',
  ].filter(Boolean).join('\n')
}

function historyFunction(fn) {
  if (!fn || typeof fn.name !== 'string') badRequest('Invalid assistant tool-call history.')
  return { name: fn.name, arguments: fn.arguments ?? '{}' }
}

function conversationText(history) {
  const latest = history.at(-1)
  if (history.length === 1 && latest.role === 'user') return latest.content
  const hasTools = history.some(m => m.tool_calls || m.function_call || m.role === 'tool' || m.role === 'function')
  if (!hasTools) return history.map(m => (m.role === 'user' ? 'User: ' : 'Assistant: ') + m.content).join('\n\n')

  // Quick accepts one user_message. Encode the roles and IDs separately from
  // the contents so text inside a message cannot add another transcript entry.
  const parts = [
    'Continue this API conversation as the assistant. Client tools run in the calling application. Each tool or function message contains the result returned by that application. Match it to the assistant call by tool_call_id, or by name for a legacy function result.',
    JSON.stringify(history),
  ]
  if (latest.role === 'tool' || latest.role === 'function') {
    parts.push('Use the returned tool data to continue the user’s task. If the completed call supplied the requested answer, respond now in the exact format the user requested. Request a further call only if the current task or tool choice requires one.')
  }
  return parts.join('\n\n')
}

export function prepareTurn(body) {
  if (!Array.isArray(body?.messages) || !body.messages.length) badRequest('messages must be a non-empty array.')
  const tools = toolSettings(body)
  const system = [], history = [], names = new Map()
  let lastUser = ''
  for (const message of body.messages) {
    if (!message || typeof message.role !== 'string') badRequest('Each message must have a role.')
    if (message.audio != null) badRequest('Amazon Quick accepts text content only.')
    const text = textContent(message.content)
    switch (message.role) {
      case 'system':
      case 'developer':
        if (text) system.push(text)
        break
      case 'user':
        if (text.trim()) { lastUser = text; history.push({ role: 'user', content: text }) }
        break
      case 'assistant': {
        const calls = message.tool_calls ?? []
        if (!Array.isArray(calls)) badRequest('Invalid assistant tool-call history.')
        const assistant = { role: 'assistant', content: text || null }
        if (calls.length) {
          assistant.tool_calls = calls.map(call => {
            const fn = historyFunction(call?.function)
            if (call.id) names.set(call.id, fn.name)
            return { id: call.id, type: 'function', function: fn }
          })
        }
        if (message.function_call) assistant.function_call = historyFunction(message.function_call)
        if (text || assistant.tool_calls || assistant.function_call) history.push(assistant)
        break
      }
      case 'tool':
      case 'function':
        history.push({ role: message.role, tool_call_id: message.tool_call_id, name: message.name ?? names.get(message.tool_call_id), content: text })
        break
      default:
        badRequest('Unsupported message role.')
    }
  }
  if (!history.length) badRequest('messages contain no user text, assistant text, or tool history.')
  let prompt = conversationText(history)
  if (tools.enabled) {
    const protocol = toolInstructions(tools)
    if (tools.required) {
      // Some Quick agents answer the visible task without consulting the
      // per-turn system_prompt. Keep the schema alongside the required task.
      system.push('Return a client function call for this turn. Follow the wire format in the message for: ' + JSON.stringify([...tools.allowed.keys()]) + '.')
      prompt += '\n\n' + protocol
    } else {
      system.push(protocol)
    }
  }
  const title = Array.from(lastUser.trim().replace(/\s+/g, ' ')).slice(0, 64).join('') || 'Magpie'
  return { prompt, systemPrompt: system.join('\n\n'), model: body.model, title, tools }
}

function asCall(item, tools) {
  const fn = item?.function ?? item
  if (!fn || !tools.allowed.has(fn.name)) return null
  if (item.function && item.type != null && item.type !== 'function') return null
  let args = fn.arguments
  if (typeof args === 'string') {
    try { args = JSON.parse(args || '{}') } catch { return null }
  }
  if (args === undefined) args = {}
  if (!args || typeof args !== 'object' || Array.isArray(args)) return null
  return {
    id: typeof item.id === 'string' && item.id ? item.id : 'call_' + randomUUID().replaceAll('-', ''),
    type: 'function', function: { name: fn.name, arguments: JSON.stringify(args) },
  }
}

function parseCalls(json, tools, requireArguments = false) {
  let payload
  try { payload = JSON.parse(json) } catch { return null }
  const items = Array.isArray(payload) ? payload : (Array.isArray(payload?.tool_calls) ? payload.tool_calls : [payload])
  if (requireArguments && items.some(item => (item?.function ?? item)?.arguments === undefined)) return null
  const calls = items.map(item => asCall(item, tools))
  // Keep a marker containing an unknown or malformed tool intact, including mixed arrays.
  return calls.length && calls.every(Boolean) ? calls : null
}

export function finishTools(text, nativeEvents, tools) {
  if (!tools.enabled) return { text, toolCalls: [] }
  const toolCalls = []
  let cleaned = text.replace(/<client_tool_call>([\s\S]*?)<\/client_tool_call>/g, (marker, payload) => {
    const calls = parseCalls(payload, tools)
    if (!calls) return marker
    toolCalls.push(...calls)
    return ''
  })
  if (!toolCalls.length) {
    // Native events for backend tools are never exposed unless the client declared the same function.
    for (const event of nativeEvents) {
      const call = asCall(event, tools)
      if (call) toolCalls.push(call)
    }
  }
  if (tools.required && !toolCalls.length) {
    // A forced call can arrive as the entire reply, plain or fenced. Prose
    // with a JSON example and ordinary auto-mode data stay assistant text.
    const whole = text.trim()
    const fence = /^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/i.exec(whole)
    const calls = parseCalls(fence ? fence[1] : whole, tools, true)
    if (!calls) throw Object.assign(new Error('Amazon Quick did not return a required tool call.'), { status: 502, expose: true })
    toolCalls.push(...calls)
    cleaned = ''
  }
  return { text: cleaned === text ? text : cleaned.trim(), toolCalls: tools.parallel ? toolCalls : toolCalls.slice(0, 1) }
}
