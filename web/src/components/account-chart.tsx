import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis } from 'recharts'
import { accountStatus, type Account } from '@/lib/api'

export default function AccountChart({ accounts }: { accounts: Account[] }) {
  const labels = ['就绪', '已过期', '最近有错误', '已停用']
  const totals = new Map<string, number>()
  for (const account of accounts) {
    const label = accountStatus(account).label
    totals.set(label, (totals.get(label) ?? 0) + 1)
  }
  const data = labels.map(name => ({ name, total: totals.get(name) ?? 0 }))

  return (
    <div>
      <p className='sr-only'>{data.map(item => `${item.name} ${item.total} 个`).join('，')}</p>
      <ResponsiveContainer width='100%' height={350}>
        <BarChart data={data}>
          <XAxis dataKey='name' stroke='#888888' fontSize={12} tickLine={false} axisLine={false} />
          <YAxis direction='ltr' stroke='#888888' fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} />
          <Bar dataKey='total' name='账号数' fill='currentColor' radius={[4, 4, 0, 0]} className='fill-primary' />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
