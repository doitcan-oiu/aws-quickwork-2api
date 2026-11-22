import { useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { accountName, dateTime, type Account, type Overview } from '@/lib/api'
import { Status } from './shared'

function duration(ms: number) {
  const seconds = Math.floor(ms / 1000)
  if (seconds === 0) return ms > 0 ? '不足 1 秒' : '0 秒'
  return [
    { value: Math.floor(seconds / 3600), unit: '小时' },
    { value: Math.floor(seconds / 60) % 60, unit: '分' },
    { value: seconds % 60, unit: '秒' },
  ].filter(part => part.value > 0).map(part => `${part.value} ${part.unit}`).join(' ')
}

function AccountUsage({ account, budget }: { account: Account; budget: number }) {
  const usage = account.monthly_usage
  const used = usage.reported_ms + usage.estimated_ms
  const remaining = Math.max(0, budget - used)

  return (
    <Card className='min-w-0 gap-4'>
      <CardHeader className='flex items-start justify-between gap-2'>
        <CardTitle className='min-w-0 break-all'>{account.email || accountName(account)}</CardTitle>
        <Status account={account} />
      </CardHeader>
      <CardContent className='space-y-4'>
        <dl className='grid grid-cols-2 gap-4'>
          <div>
            <dt className='text-sm text-muted-foreground'>本月已用</dt>
            <dd className='mt-1 font-semibold tabular-nums'>{duration(used)}</dd>
          </div>
          <div>
            <dt className='text-sm text-muted-foreground'>参考剩余</dt>
            <dd className='mt-1 font-semibold tabular-nums'>{duration(remaining)}</dd>
          </div>
        </dl>
        <dl className='space-y-2 border-t pt-4 text-sm'>
          {[
            ['上游上报', `${duration(usage.reported_ms)} · ${usage.reported_turns} 次`],
            ['本地估算', `${duration(usage.estimated_ms)} · ${usage.estimated_turns} 次`],
            ['累计调用', account.use_count.toLocaleString('zh-CN')],
            ['凭据到期', dateTime(account.expires_at)],
          ].map(([label, value]) => (
            <div key={label} className='flex flex-wrap items-baseline justify-between gap-x-3'>
              <dt className='text-muted-foreground'>{label}</dt>
              <dd className='tabular-nums'>{value}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  )
}

export function StatusPage({ data, reload }: { data: Overview; reload: () => Promise<void> }) {
  const { accounts, usage_period: period } = data

  useEffect(() => {
    let timer: number
    let active = true
    let refreshing = false
    function scheduleRefresh() {
      if (!active || document.visibilityState !== 'visible') return
      const untilReset = period.next_reset_at * 1000 - Date.now()
      timer = window.setTimeout(refresh, untilReset > 0 ? Math.min(60_000, untilReset) : 60_000)
    }
    async function refresh() {
      if (refreshing || document.visibilityState !== 'visible') return
      refreshing = true
      try {
        await reload()
      } finally {
        refreshing = false
        scheduleRefresh()
      }
    }
    function onVisibilityChange() {
      window.clearTimeout(timer)
      if (document.visibilityState === 'visible') void refresh()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    if (period.next_reset_at * 1000 <= Date.now()) void refresh()
    else scheduleRefresh()
    return () => {
      active = false
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [period.next_reset_at, reload])

  return (
    <>
      <div className='space-y-1'>
        <p className='text-sm font-medium'>{period.month}（{period.timezone}） · 每账号参考预算 {duration(period.budget_ms)}</p>
        <p className='text-sm text-muted-foreground'>
          仅统计经此代理的用量，升级前的时长无法回填。缺少上游时长时使用本地计时估算，实际额度以上游为准。
        </p>
      </div>
      {accounts.length > 0 ? (
        <div className='grid min-w-0 gap-4 xl:grid-cols-2'>
          {accounts.map(account => <AccountUsage key={account.id} account={account} budget={period.budget_ms} />)}
        </div>
      ) : (
        <p className='rounded-md border p-6 text-center text-sm text-muted-foreground'>暂无账号</p>
      )}
    </>
  )
}
