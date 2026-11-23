import assert from 'node:assert/strict'
import test from 'node:test'
import { uploadPromptAttachment } from '../src/attachments.js'

const host = 'tenant.plato.ai.aws.dev'
const session = { tenant: 'https://' + host + '/dp.appintegrations/', wsHost: host, jwt: 'fixture-token' }
const base = session.tenant + 'integration/quick-work/'
const name = 'prompt-example.txt'

test('posts exact UTF-8 bytes, waits for approval and binds the file to the conversation', async t => {
  const content = '附件\nRésumé 🐦'
  const calls = []
  t.mock.method(globalThis, 'fetch', async (address, init) => {
    const url = new URL(address)
    calls.push([init.method, url.pathname])
    assert.equal(url.origin, new URL(base).origin)
    assert.equal(init.headers.Authorization, 'Bearer fixture-token')
    assert.equal(init.headers.Origin, 'https://quick.aws.com')
    assert.equal(init.redirect, 'error')
    if (address.startsWith(base + 'upload-attachment?')) {
      assert.equal(url.searchParams.get('name'), name)
      assert.equal(Number(url.searchParams.get('contentLength')), Buffer.byteLength(content))
      assert.equal(url.searchParams.get('contentType'), 'text/plain')
      assert.equal(init.headers['Content-Type'], 'application/octet-stream')
      assert.deepEqual(init.body, Buffer.from(content))
      return Response.json({ attachmentId: 'att-1' })
    }
    if (address.startsWith(base + 'attachment-dlp-status?')) {
      assert.equal(url.searchParams.get('attachmentId'), 'att-1')
      return Response.json({ dlpJobStatus: 'COMPLETED', policyAction: 'ALLOW' })
    }
    assert.equal(address, base + 'qbs-event')
    assert.deepEqual(JSON.parse(init.body), { eventType: 'invokeAgent', eventBody: { invokeAgent: {
      path: 'files/upload/conversation-1', queryParams: { _method: 'POST' }, body: { attachmentId: 'att-1' },
    } } })
    const response = { type: 'api_response', body: JSON.stringify({ files: [{ path: '/workspace/file' }] }) }
    return Response.json({ eventResponse: { invokeAgentResponse: JSON.stringify(response) } })
  })
  assert.deepEqual(await uploadPromptAttachment(session, 'conversation-1', name, content), {
    type: 'file', name, size: Buffer.byteLength(content), mimeType: 'text/plain', path: '/workspace/file', attachmentId: 'att-1',
  })
  assert.deepEqual(calls.map(([method, path]) => [method, path.split('/').pop()]), [
    ['POST', 'upload-attachment'], ['GET', 'attachment-dlp-status'], ['POST', 'qbs-event'],
  ])
})

test('attachment redirects, untrusted tenants and unresolved or denied scans do not deliver a file', async t => {
  let calls = 0, upload, scan, httpStatus = 200
  t.mock.method(globalThis, 'fetch', async (address, init) => {
    calls++
    assert.equal(init.redirect, 'error')
    if (address.startsWith(base + 'upload-attachment?')) return Response.json(upload, { status: httpStatus })
    assert.ok(address.startsWith(base + 'attachment-dlp-status?'))
    return Response.json(scan)
  })
  const send = (override = {}) => uploadPromptAttachment({ ...session, ...override }, 'thread', name, 'sensitive fixture text')
  for (const tenant of ['http://' + host, 'https://other.plato.ai.aws.dev', 'https://third-party.test', 'https://user@' + host]) {
    await assert.rejects(send({ tenant }), { status: 400 })
  }
  assert.equal(calls, 0)
  upload = { path: '/already-delivered.txt' }
  assert.equal((await send()).path, upload.path)
  for (const verdict of [{ policyAction: 'WARN' }, { policyAction: 'BLOCK' }, { dlpJobStatus: 'PENDING' }, { dlpJobStatus: 'COMPLETED' }]) {
    upload = { path: '/already-delivered.txt', ...verdict }
    await assert.rejects(send(), { status: 403 })
  }
  upload = { attachmentId: 'id-1', path: '/workspace/file' }
  scan = { dlpJobStatus: 'COMPLETED', policyAction: 'DENY' }
  await assert.rejects(send(), { status: 403 })
  httpStatus = 401
  upload = { detail: 'sensitive fixture text' }
  await assert.rejects(send(), err => err.status === 401 && !err.message.includes('sensitive fixture text'))
})

test('cancelling during a pending scan prevents another poll or a file reference', async t => {
  const controller = new AbortController()
  let calls = 0
  t.mock.method(globalThis, 'fetch', async address => {
    calls++
    if (address.startsWith(base + 'upload-attachment?')) return Response.json({ attachmentId: 'id-1' })
    assert.ok(address.startsWith(base + 'attachment-dlp-status?'))
    queueMicrotask(() => controller.abort())
    return Response.json({ dlpJobStatus: 'PENDING' })
  })
  await assert.rejects(uploadPromptAttachment(session, 'thread', name, 'text', controller.signal), { name: 'AbortError' })
  assert.equal(calls, 2)
})
