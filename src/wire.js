import { decode as decodeCbor, encode as encodeCbor } from 'cborg'

const maxFrameBytes = 16 * 1024 * 1024
const crcTable = Uint32Array.from({ length: 256 }, (_, byte) => {
  let crc = byte
  for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
  return crc >>> 0
})

function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255]
  return (crc ^ 0xffffffff) >>> 0
}

function malformed() {
  return new Error('Invalid Quick event-stream frame')
}

// AWS event-stream carries a checksummed binary prelude and typed headers.
function encodeEventStream(headers, body) {
  const fields = Object.entries(headers).map(([name, value]) => {
    const key = Buffer.from(name)
    const data = Buffer.from(value)
    const field = Buffer.alloc(1 + key.length + 3 + data.length)
    field[0] = key.length
    key.copy(field, 1)
    field[1 + key.length] = 7 // string
    field.writeUInt16BE(data.length, 2 + key.length)
    data.copy(field, 4 + key.length)
    return field
  })
  const block = Buffer.concat(fields)
  const message = Buffer.alloc(16 + block.length + body.length)
  message.writeUInt32BE(message.length, 0)
  message.writeUInt32BE(block.length, 4)
  message.writeUInt32BE(crc32(message.subarray(0, 8)), 8)
  block.copy(message, 12)
  Buffer.from(body).copy(message, 12 + block.length)
  message.writeUInt32BE(crc32(message.subarray(0, -4)), message.length - 4)
  return message
}

function stringHeaders(block) {
  const headers = new Map()
  const fixedLengths = [0, 0, 1, 2, 4, 8, null, null, 8, 16]
  for (let offset = 0; offset < block.length;) {
    const endName = offset + 1 + block[offset]
    if (endName >= block.length) throw malformed()
    const name = block.toString('utf8', offset + 1, endName)
    const type = block[endName]
    offset = endName + 1
    let size = fixedLengths[type]
    if (type === 6 || type === 7) {
      if (offset + 2 > block.length) throw malformed()
      size = block.readUInt16BE(offset)
      offset += 2
    }
    if (size === undefined || offset + size > block.length) throw malformed()
    if (type === 7) headers.set(name, block.toString('utf8', offset, offset + size))
    offset += size
  }
  return headers
}

// Upstream error texts can contain URLs, tokens and prompt fragments. Keep the
// diagnostic numeric and allow only known protocol error classes to set status.
export function quickError(message, status = 502) {
  return Object.assign(new Error(message), { status })
}

export function upstreamFailure(...codes) {
  const statuses = {
    accessdeniedexception: 403, unauthorizedexception: 401, unauthorized: 401,
    notauthorizedexception: 401, expiredtokenexception: 401,
    throttlingexception: 429, throttled: 429, toomanyrequests: 429, toomanyrequestsexception: 429,
    sessionnotfound: 404, conversationnotfound: 404, threadnotfound: 404,
    sessionnotfoundexception: 404, conversationnotfoundexception: 404, threadnotfoundexception: 404,
  }
  const http = codes.find(code => (typeof code === 'string' || typeof code === 'number') && /^[45]\d{2}$/.test(code))
  const status = http === undefined ? 502 : Number(http)
  // A generic HTTP 404 by itself does not identify a missing conversation.
  // Any other explicit HTTP status takes precedence over a secondary error code.
  if (http !== undefined && status !== 404) return quickError('Amazon Quick reported an upstream error', status)
  for (const code of codes) {
    if (typeof code !== 'string' && typeof code !== 'number') continue
    const name = String(code).split('#').at(-1).toLowerCase().replace(/[_-]/g, '')
    if (Object.hasOwn(statuses, name)) {
      const error = quickError('Amazon Quick reported an upstream error', statuses[name])
      if (statuses[name] === 404) error.sessionMissing = true
      return error
    }
  }
  return quickError('Amazon Quick reported an upstream error', status)
}

export function encodeQuickFrame(event, gateway) {
  const body = Buffer.from(JSON.stringify(event))
  if (!gateway) {
    return Buffer.from(JSON.stringify({ eventType: 'rawInputEvent', payload: { payload: body.toString('base64') } }))
  }
  return encodeEventStream({
    ':event-type': 'rawInputEvent', ':content-type': 'application/cbor', ':message-type': 'event',
  }, encodeCbor({ payload: new Uint8Array(body) }))
}

function parseJSON(bytes) {
  try {
    return JSON.parse(bytes.toString('utf8'))
  } catch {
    throw malformed()
  }
}

export function* quickEvents(data, binary, gateway) {
  const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data)
  // Some deployments send a plain JSON WebSocket message.
  // The first byte of a supported AWS prelude is 0 or 1 (16 MiB limit).
  if (!binary || bytes[0] > 1) {
    yield parseJSON(bytes)
    return
  }
  for (let offset = 0; offset < bytes.length;) {
    if (bytes.length - offset < 16) throw malformed()
    const size = bytes.readUInt32BE(offset)
    const headerSize = bytes.readUInt32BE(offset + 4)
    if (size < 16 || size > maxFrameBytes || headerSize > size - 16 || offset + size > bytes.length) throw malformed()
    const frame = bytes.subarray(offset, offset + size)
    if (crc32(frame.subarray(0, 8)) !== frame.readUInt32BE(8) ||
        crc32(frame.subarray(0, -4)) !== frame.readUInt32BE(size - 4)) throw malformed()
    const headers = stringHeaders(frame.subarray(12, 12 + headerSize))
    if (['error', 'exception'].includes(headers.get(':message-type'))) {
      throw upstreamFailure(headers.get(':error-code'), headers.get(':exception-type'))
    }
    const body = frame.subarray(12 + headerSize, -4)
    if (gateway) {
      let envelope
      try {
        // RPC v2 may wrap its envelope in the self-described CBOR tag.
        envelope = decodeCbor(body, { tags: { 55799: decode => decode() } })
      } catch { throw malformed() }
      const payload = envelope?.payload
      if (!(payload instanceof Uint8Array) && typeof payload !== 'string') throw malformed()
      yield parseJSON(Buffer.from(payload))
    } else {
      const payload = parseJSON(body)?.payload
      if (typeof payload !== 'string') throw malformed()
      yield parseJSON(Buffer.from(payload, 'base64'))
    }
    offset += size
  }
}

export function decodeQuickFrame(data, binary, gateway) {
  return Array.from(quickEvents(data, binary, gateway))
}
