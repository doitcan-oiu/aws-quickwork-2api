import { lazy, Suspense } from 'react'
import { Activity, ShieldCheck, UsersRound } from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { accountName, type Overview } from '@/lib/api'
import { Status } from './shared'

const AccountChart = lazy(() => import('./account-chart'))

export function Dashboard({ data }: { data: Overview }) {
  const { accounts, config } = data
  const disabled = accounts.filter(account => account.disabled).length
  const metrics = [
    {
      title: '已连接账号',
      value: accounts.length,
      detail: accounts.length === 0 ? '添加账号后即可发送请求。' : disabled > 0 ? `${disabled} 个已停用` : '',
      icon: UsersRound,
    },
    { title: '累计使用次数', value: accounts.reduce((sum, account) => sum + account.use_count, 0), icon: Activity },
    { title: 'API 密钥鉴权', value: config.api_key_required ? '已开启' : '未开启', icon: ShieldCheck },
  ]
  const recent = [...accounts].sort((a, b) => b.last_used_at - a.last_used_at || b.id - a.id).slice(0, 5)

  return (
    <div className='space-y-4'>
      <div className='grid gap-4 sm:grid-cols-3'>
        {metrics.map(({ title, value, detail, icon: Icon }) => (
          <Card key={title}>
            <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
              <CardTitle className='text-sm font-medium'>{title}</CardTitle>
              <Icon className='h-4 w-4 text-muted-foreground' />
            </CardHeader>
            <CardContent>
              <div className='text-2xl font-bold'>{value.toLocaleString('zh-CN')}</div>
              {detail && <p className='text-xs text-muted-foreground'>{detail}</p>}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className='flex flex-wrap items-center gap-2'>
        <span className='me-1 text-sm text-muted-foreground'>可用模型（{config.models.length}）</span>
        {config.models.map((model, index) => (
          <Badge key={`${model}-${index}`} variant={model === config.default_model ? 'secondary' : 'outline'} className='max-w-full whitespace-normal'>
            <code className='min-w-0 [overflow-wrap:anywhere]'>{model}</code>
            {model === config.default_model && <span className='shrink-0'>默认</span>}
          </Badge>
        ))}
        {!config.models.includes(config.default_model) && (
          <span className='text-sm text-muted-foreground [overflow-wrap:anywhere]'>默认模型 {config.default_model}</span>
        )}
      </div>

      {accounts.length > 0 && (
        <div className='grid grid-cols-1 gap-4 lg:grid-cols-7'>
          <Card className='col-span-1 lg:col-span-4'>
            <CardHeader><CardTitle>账号状态分布</CardTitle></CardHeader>
            <CardContent className='ps-2'>
              <Suspense fallback={<div className='h-[350px]' aria-busy='true' aria-label='正在加载账号状态图表' />}>
                <AccountChart accounts={accounts} />
              </Suspense>
            </CardContent>
          </Card>
          <Card className='col-span-1 lg:col-span-3'>
            <CardHeader><CardTitle>最近账号</CardTitle></CardHeader>
            <CardContent className='space-y-8'>
              {recent.map(account => {
                const name = accountName(account)
                return (
                  <div key={account.id} className='flex items-center gap-4'>
                    <Avatar className='h-9 w-9'><AvatarFallback>{name.slice(0, 2).toUpperCase()}</AvatarFallback></Avatar>
                    <div className='flex min-w-0 flex-1 flex-wrap items-center justify-between gap-2'>
                      <div className='min-w-0 space-y-1'>
                        <p className='truncate text-sm leading-none font-medium'>{name}</p>
                        {account.email && account.email !== name && <p className='truncate text-sm text-muted-foreground'>{account.email}</p>}
                      </div>
                      <Status account={account} />
                    </div>
                  </div>
                )
              })}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
