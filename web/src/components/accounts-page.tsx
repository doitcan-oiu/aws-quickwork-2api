import { useState } from 'react'
import { ChevronLeft, ChevronRight, Ellipsis, RefreshCw, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/confirm-dialog'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
  DropdownMenuShortcut, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { accountName, dateTime, errorMessage, type Account, type Request } from '@/lib/api'
import { Status } from './shared'

export function AccountsPage({ accounts, request, reload, notify }: {
  accounts: Account[]
  request: Request
  reload: () => Promise<void>
  notify: (message: string, failed?: boolean) => void
}) {
  const [filter, setFilter] = useState('')
  const [page, setPage] = useState(1)
  const [rowsPerPage, setRowsPerPage] = useState(10)
  const [busy, setBusy] = useState<number | 'all' | null>(null)
  const [removing, setRemoving] = useState<Account | null>(null)
  const [removalError, setRemovalError] = useState('')
  const [deleting, setDeleting] = useState(false)
  const query = filter.trim().toLowerCase()
  const matches = accounts.filter(a => [a.id, a.display_name, a.email, a.account_name, a.region, a.provider].join(' ').toLowerCase().includes(query))
  const pages = Math.max(1, Math.ceil(matches.length / rowsPerPage))
  const currentPage = Math.min(page, pages)
  const visible = matches.slice((currentPage - 1) * rowsPerPage, currentPage * rowsPerPage)

  async function refresh(id?: number) {
    setBusy(id ?? 'all')
    try {
      if (id !== undefined) {
        await request(`accounts/${id}/refresh`, { method: 'POST' })
        notify('账号凭据已刷新')
      } else {
        const result = await request<{ total: number; failed: number }>('accounts/refresh', { method: 'POST' })
        notify(`已刷新 ${result.total - result.failed} 个账号${result.failed ? `，${result.failed} 个失败` : ''}`, result.failed > 0)
      }
    } catch (error) {
      notify(errorMessage(error), true)
    } finally {
      await reload()
      setBusy(null)
    }
  }

  async function remove() {
    if (!removing) return
    setDeleting(true)
    setRemovalError('')
    try {
      await request(`accounts/${removing.id}`, { method: 'DELETE' })
      setRemoving(null)
      notify('已从账号池移除')
      await reload()
    } catch (error) {
      setRemovalError(errorMessage(error))
    } finally {
      setDeleting(false)
    }
  }

  if (accounts.length === 0) {
    return <p className='rounded-md border p-6 text-center text-sm text-muted-foreground'>暂无账号</p>
  }

  return (
    <div className='flex min-w-0 flex-1 flex-col gap-4'>
      <div className='flex items-center justify-between gap-2'>
        <div className='flex flex-1 flex-col-reverse items-start gap-y-2 sm:flex-row sm:items-center sm:space-x-2'>
          <Input className='h-8 w-37.5 lg:w-62.5' aria-label='搜索账号' placeholder='搜索名称、邮箱或区域…'
            value={filter} onChange={event => { setFilter(event.target.value); setPage(1) }} />
          {filter && <Button variant='ghost' className='h-8 px-2 lg:px-3' onClick={() => { setFilter(''); setPage(1) }}>
            清除搜索<X className='ms-2 h-4 w-4' />
          </Button>}
        </div>
        <Button variant='outline' size='sm' onClick={() => void refresh()} disabled={busy !== null || deleting}>
          <RefreshCw className={busy === 'all' ? 'animate-spin' : ''} />刷新全部凭据
        </Button>
      </div>
      <div className='overflow-hidden rounded-md border'>
        <Table>
          <TableHeader><TableRow className='group/row'>
            {['账号', '状态', '登录信息', '到期时间', '使用次数', '操作'].map(col =>
              <TableHead key={col} className='bg-background group-hover/row:bg-muted'>{col}</TableHead>
            )}
          </TableRow></TableHeader>
          <TableBody>
            {visible.map(a => <TableRow key={a.id} className='group/row'>
              <TableCell><div className='font-medium'>{accountName(a)}</div><div className='text-xs text-muted-foreground'>{a.email && a.email !== accountName(a) ? a.email : `ID · ${a.id}`}</div></TableCell>
              <TableCell><Status account={a} /></TableCell>
              <TableCell><div>{a.provider}</div><div className='text-xs text-muted-foreground'>{[a.build_stage, a.region].filter(Boolean).join(' · ')}</div></TableCell>
              <TableCell>{dateTime(a.expires_at)}</TableCell>
              <TableCell>{a.use_count.toLocaleString('zh-CN')}<div className='text-xs text-muted-foreground'>{a.last_used_at > 0 ? `最近 · ${dateTime(a.last_used_at)}` : '尚未使用'}</div></TableCell>
              <TableCell>
                <DropdownMenu modal={false}>
                  <DropdownMenuTrigger asChild>
                    <Button variant='ghost' className='flex h-8 w-8 p-0 data-[state=open]:bg-muted' disabled={busy !== null || deleting}>
                      <Ellipsis className='h-4 w-4' /><span className='sr-only'>管理 {accountName(a)}</span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align='end' className='w-40'>
                    <DropdownMenuItem onSelect={() => void refresh(a.id)}>刷新凭据<DropdownMenuShortcut><RefreshCw size={16} /></DropdownMenuShortcut></DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant='destructive' onSelect={() => { setRemoving(a); setRemovalError('') }}>移除账号<DropdownMenuShortcut><Trash2 size={16} /></DropdownMenuShortcut></DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>)}
            {!visible.length && <TableRow><TableCell colSpan={6} className='h-24 text-center'>
              没有匹配的账号
            </TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
      {matches.length > 0 && <div className='flex flex-wrap items-center justify-between gap-4 px-2'>
        <div className='flex items-center gap-2'>
          <Select value={String(rowsPerPage)} onValueChange={value => { setRowsPerPage(Number(value)); setPage(1) }}>
            <SelectTrigger aria-label='每页行数' className='h-8 w-17.5'><SelectValue /></SelectTrigger>
            <SelectContent side='top'>{[10, 20, 30, 40, 50].map(n => <SelectItem value={String(n)} key={n}>{n}</SelectItem>)}</SelectContent>
          </Select>
          <p className='hidden text-sm font-medium sm:block'>每页行数</p>
        </div>
        <div className='flex items-center space-x-2'>
          <span className='text-sm font-medium'>第 {currentPage} / {pages} 页</span>
          <Button variant='outline' className='size-8 p-0' disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)} aria-label='上一页'><ChevronLeft /></Button>
          <Button variant='outline' className='size-8 p-0' disabled={currentPage >= pages} onClick={() => setPage(currentPage + 1)} aria-label='下一页'><ChevronRight /></Button>
        </div>
      </div>}
      <ConfirmDialog open={!!removing} onOpenChange={open => { if (!open && !deleting) setRemoving(null) }}
        title='移除账号？' desc={`将从本地账号池删除「${removing ? accountName(removing) : ''}」及其登录凭据。需要时可重新登录添加。`}
        confirmText='移除账号' cancelBtnText='取消' destructive isLoading={deleting} handleConfirm={() => void remove()}>
        {removalError && <p className='text-sm text-destructive' role='alert'>{removalError}</p>}
      </ConfirmDialog>
    </div>
  )
}
