import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { createRoot } from 'react-dom/client'
import { LoaderCircle, Plus, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { AccountsPage } from '@/components/accounts-page'
import { StatusPage } from '@/components/status-page'
import { Dashboard } from '@/components/dashboard'
import { Guide } from '@/components/guide'
import { ConsoleShell, currentPage } from '@/components/layout/shell'
import { LoginDialog } from '@/components/login-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Toaster } from '@/components/ui/sonner'
import { FontProvider } from '@/context/font-provider'
import { ThemeProvider } from '@/context/theme-provider'
import { ApiError, errorMessage, requestAdmin, type Overview, type Request } from '@/lib/api'
import './styles/index.css'

function notify(message: string, failed = false) {
  if (failed) toast.error(message)
  else toast.success(message)
}

function App() {
  const [page, setPage] = useState(currentPage)
  const [data, setData] = useState<Overview | null>(null)
  const [loading, setLoading] = useState(true)
  const [accessRequired, setAccessRequired] = useState(false)
  const [inputKey, setInputKey] = useState('')
  const [error, setError] = useState('')
  const [loginOpen, setLoginOpen] = useState(false)
  const token = useRef('')
  const requestId = useRef(0)

  useEffect(() => {
    const onHash = () => {
      setPage(currentPage())
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => { document.title = page.title + ' · QuickProxy' }, [page])

  const request = useCallback<Request>(async (path, options) => {
    try {
      return await requestAdmin(token.current, path, options)
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        token.current = ''
        setData(null)
        setAccessRequired(true)
        setLoginOpen(false)
      }
      throw err
    }
  }, [])

  const reload = useCallback(async () => {
    const id = ++requestId.current
    const attemptedUnlock = Boolean(token.current)
    setLoading(true)
    setError('')
    try {
      const result = await request<Overview>('overview')
      if (id === requestId.current) {
        setData(result)
        setAccessRequired(false)
      }
    } catch (err) {
      if (id === requestId.current) {
        setData(null)
        const firstChallenge = err instanceof ApiError && err.status === 401 && !attemptedUnlock
        setError(firstChallenge ? '' : errorMessage(err))
      }
    } finally {
      if (id === requestId.current) setLoading(false)
    }
  }, [request])
  useEffect(() => { void reload() }, [reload])

  async function unlock(event: FormEvent) {
    event.preventDefault()
    token.current = inputKey.trim()
    setInputKey('')
    await reload()
  }

  return (
    <ConsoleShell pageId={page.id}>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <h1 className='text-2xl font-bold tracking-tight'>{page.title}</h1>
        {data && (
          <div className='flex items-center space-x-2'>
            <Button variant='outline' disabled={loading} onClick={() => void reload()} aria-label='刷新数据'>
              <RefreshCw className={loading ? 'animate-spin' : undefined} />
              刷新
            </Button>
            {(page.id === 'overview' || page.id === 'accounts') && (
              <Button onClick={() => setLoginOpen(true)}><Plus />添加账号</Button>
            )}
          </div>
        )}
      </div>
      {data ? (
        <>
          {page.id === 'overview' && <Dashboard data={data} />}
          {page.id === 'accounts' && (
            <AccountsPage accounts={data.accounts} request={request} reload={reload} notify={notify} />
          )}
          {page.id === 'guide' && <Guide config={data.config} />}
          {page.id === 'status' && <StatusPage data={data} reload={reload} />}
          {loginOpen && (
            <LoginDialog
              defaults={data.config.oauth}
              request={request}
              onClose={() => setLoginOpen(false)}
              onComplete={() => {
                setLoginOpen(false)
                notify('账号已连接')
                void reload()
              }}
            />
          )}
        </>
      ) : accessRequired ? (
        <Card className='max-w-sm gap-4'>
          <CardHeader>
            <CardTitle className='text-lg tracking-tight'>验证管理令牌</CardTitle>
            <CardDescription>请输入服务端设置的 QUICKPROXY_ADMIN_TOKEN。</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={unlock} className='grid gap-3'>
              <Label htmlFor='admin-key'>管理令牌</Label>
              <Input type='password' id='admin-key' required autoFocus autoComplete='off'
                value={inputKey} onChange={event => setInputKey(event.target.value)} />
              {error && <p className='text-sm text-destructive' role='alert'>{error}</p>}
              <Button disabled={loading || !inputKey.trim()}>解锁控制台</Button>
            </form>
          </CardContent>
        </Card>
      ) : error ? (
        <Card className='max-w-sm'>
          <CardHeader><CardTitle>无法读取服务状态</CardTitle><CardDescription role='alert'>{error}</CardDescription></CardHeader>
          <CardContent><Button onClick={() => void reload()}>重新连接</Button></CardContent>
        </Card>
      ) : (
        <p className='flex items-center gap-2 text-sm text-muted-foreground' role='status'>
          <LoaderCircle className='size-4 animate-spin' />正在读取服务状态…
        </p>
      )}
    </ConsoleShell>
  )
}

createRoot(document.getElementById('root')!).render(
  <ThemeProvider>
    <FontProvider>
      <App />
      <Toaster duration={5000} />
    </FontProvider>
  </ThemeProvider>
)
