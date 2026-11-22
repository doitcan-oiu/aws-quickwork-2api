import assert from 'node:assert/strict'
import test from 'node:test'
import { prepareTurn, finishTools } from '../src/messages.js'

const tools = ['weather', 'calendar'].map(name => ({
  type: 'function', function: { name, parameters: { type: 'object' } },
}))
const basic = { model: 'fast', messages: [{ role: 'user', content: 'Hi' }] }
const mark = body => '<client_tool_call>' + body + '</client_tool_call>'

test('places instructions and a single text turn in their native fields', () => {
  const turn = prepareTurn({ ...basic, messages: [
    { role: 'system', content: 'Be concise.' }, { role: 'developer', content: 'Use Chinese.' },
    { role: 'user', content: [{ type: 'text', text: '早' }, { type: 'input_text', text: '上好' }] },
  ] })
  assert.equal(turn.systemPrompt, 'Be concise.\n\nUse Chinese.')
  assert.equal(turn.prompt, '早上好')
  assert.equal(turn.title, '早上好')
  assert.equal(turn.model, 'fast')
  assert.equal(prepareTurn(basic).systemPrompt, '')
})

test('a tool result retains the call it answers and the user transcript', () => {
  const turn = prepareTurn({ ...basic, messages: [basic.messages[0],
    { role: 'assistant', content: null, tool_calls: [
      { id: 'c1', type: 'function', function: { name: 'weather', arguments: '{"city":"Taipei"}' } },
    ] },
    { role: 'tool', tool_call_id: 'c1', content: 'Sunny' },
  ] })
  assert.ok(turn.prompt.includes('User: Hi'))
  assert.match(turn.prompt, /Assistant tool call: .*"id":"c1","name":"weather"/)
  assert.match(turn.prompt, /Tool result: .*"id":"c1","name":"weather","content":"Sunny"/)
})

test('malformed and non-text messages return static client errors', () => {
  const secret = 'private-image-url'
  for (const messages of [[], [null], [{ role: 'assistant', content: null }], [{ role: 'user', content: [
    { type: 'text', text: 'here' }, { type: 'image_url', image_url: { url: secret } },
  ] }]]) {
    assert.throws(() => prepareTurn({ messages }), e => e.status === 400 && !e.message.includes(secret))
  }
})

test('recognizes declared calls and preserves unknown or malformed markers side by side', () => {
  const config = prepareTurn({ ...basic, tools }).tools
  const unknown = mark('{"name":"other","arguments":{}}')
  const invalid = mark('{"name":"weather","arguments":"broken JSON"}')
  const valid = mark('{"name":"weather","arguments":{"city":"Taipei"}}')
  const result = finishTools([unknown, valid, invalid].join('\n'), [], config)
  assert.equal(result.text, unknown + '\n\n' + invalid)
  assert.equal(result.toolCalls.length, 1)
  assert.deepEqual(result.toolCalls[0].function, { name: 'weather', arguments: '{"city":"Taipei"}' })
  assert.match(result.toolCalls[0].id, /^call_/)
  const mixed = mark('[{"name":"weather"},{"name":"unlisted"}]')
  assert.deepEqual(finishTools(mixed, [], config), { text: mixed, toolCalls: [] })
})

test('honors forced, disabled and sequential tool choices and filters native tools', () => {
  const native = [{ id: 'a', name: 'unlisted', arguments: {} }, { id: 'b', name: 'weather', arguments: '{}' },
    { id: 'c', name: 'calendar', arguments: { title: 'Dinner' } }]
  const selected = prepareTurn({ ...basic, tools, tool_choice: { type: 'function', function: { name: 'calendar' } } })
  const result = finishTools('', native, selected.tools)
  assert.equal(result.toolCalls.length, 1)
  assert.equal(result.toolCalls[0].id, 'c')
  assert.deepEqual(result.toolCalls[0].function, { name: 'calendar', arguments: '{"title":"Dinner"}' })
  assert.throws(() => finishTools('No call', [], selected.tools), { status: 502 })
  const disabled = prepareTurn({ ...basic, tools, tool_choice: 'none' })
  const literal = mark('{"name":"weather"}')
  assert.equal(disabled.systemPrompt, '')
  assert.deepEqual(finishTools(literal, native, disabled.tools), { text: literal, toolCalls: [] })
  const single = prepareTurn({ ...basic, tools, parallel_tool_calls: false }).tools
  assert.deepEqual(finishTools('', native, single).toolCalls.map(call => call.id), ['b'])
  assert.throws(() => prepareTurn({ ...basic, tools, tool_choice: { function: { name: 'not-declared' } } }), { status: 400 })
})

test('required client tools accept a whole plain or fenced JSON call', () => {
  const audit = { name: 'audit_echo', arguments: { text: 'line 1\n"回声"' } }
  const registered = [{ type: 'function', function: { name: audit.name } }, ...tools]
  const chatCall = { id: 'echo-1', type: 'function', function: { name: audit.name, arguments: JSON.stringify(audit.arguments) } }
  const envelope = JSON.stringify({ tool_calls: [chatCall] })
  for (const choice of ['required', { type: 'function', function: { name: audit.name } }]) {
    const config = prepareTurn({ ...basic, tools: registered, tool_choice: choice }).tools
    for (const text of [JSON.stringify(audit), ['```json', JSON.stringify(audit), '```'].join('\n'), envelope, mark(envelope)]) {
      const result = finishTools(text, [], config)
      assert.equal(result.text, '')
      assert.equal(result.toolCalls.length, 1)
      assert.deepEqual(result.toolCalls[0].function, chatCall.function)
    }
  }
})

test('bare data stays text in auto mode and cannot satisfy a forced call by implication', () => {
  const registered = [{ type: 'function', function: { name: 'audit_echo' } }, ...tools]
  const auto = prepareTurn({ ...basic, tools: registered }).tools
  const forced = prepareTurn({ ...basic, tools: registered, tool_choice: { function: { name: 'audit_echo' } } }).tools
  const echo = JSON.stringify({ name: 'audit_echo', arguments: { text: 'test' } })
  assert.deepEqual(finishTools(echo, [], auto), { text: echo, toolCalls: [] })
  for (const invalid of [
    'I cannot call external tools.', 'Example: ' + echo, JSON.stringify({ text: 'test' }),
    JSON.stringify({ name: 'weather', arguments: {} }),
    JSON.stringify({ name: 'audit_echo', arguments: 'invalid JSON' }),
    JSON.stringify({ tool_calls: [{ type: 'function', function: { name: 'audit_echo', arguments: '[]' } }] }),
  ]) {
    assert.throws(() => finishTools(invalid, [], forced), { status: 502 })
    assert.deepEqual(finishTools(invalid, [], auto), { text: invalid, toolCalls: [] })
  }
})
