import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

// One transaction per turn. Separate Magpie CLI and gateway processes can use
// the same account concurrently. Only the account hash and counters go here.
async function withDatabase(directory, work) {
  const dir = join(directory, 'amazon-quick')
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const SQLite = process.versions.bun
    ? (await import('bun:sqlite')).Database
    : (await import('node:sqlite')).DatabaseSync
  const db = new SQLite(join(dir, 'usage.sqlite'))
  try {
    db.exec('PRAGMA busy_timeout=5000')
    db.exec(`CREATE TABLE IF NOT EXISTS monthly_usage (
      account TEXT NOT NULL, month TEXT NOT NULL, millis INTEGER NOT NULL,
      PRIMARY KEY (account, month)
    )`)
    return work(db)
  } finally {
    db.close()
  }
}

export function recordTurn(directory, account, { durationMs, endedAt }) {
  if (!Number.isFinite(durationMs) || durationMs < 0) throw new Error('Invalid turn duration')
  const month = new Date(endedAt).toISOString().slice(0, 7)
  return withDatabase(directory, db => db.prepare(`INSERT INTO monthly_usage VALUES (?, ?, ?)
    ON CONFLICT(account, month) DO UPDATE SET millis = millis + excluded.millis`)
    .run(account, month, Math.round(durationMs)))
}

export async function accountUsage(directory, session, hours, now = new Date()) {
  const month = now.toISOString().slice(0, 7)
  const spent = await withDatabase(directory, db =>
    db.prepare('SELECT millis FROM monthly_usage WHERE account = ? AND month = ?')
      .get(session.accountId, month)?.millis ?? 0)
  const budget = hours * 3_600_000
  const seconds = Math.floor(Math.max(0, budget - spent) / 1000)
  const h = Math.floor(seconds / 3600), m = Math.floor(seconds / 60) % 60, s = seconds % 60
  const display = [h && h + '小时', m && m + '分', s && s + '秒'].filter(Boolean).join('') || '0秒'
  return {
    user: session.email || '',
    windows: [{
      name: '本月剩余', display, used: Math.min(100, spent / budget * 100),
      resetsAt: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString(),
      aside: true,
    }],
  }
}
