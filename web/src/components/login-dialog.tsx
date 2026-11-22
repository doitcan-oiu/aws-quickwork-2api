import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ExternalLink, LoaderCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ApiError, errorMessage, type Overview, type Request } from '@/lib/api'

type LoginSession = { id: string; step: 'discovery' | 'authorize'; url: string }
type LoginResult = LoginSession | { id: string; step: 'complete'; account_id: number }

export function LoginDialog({ defaults, request, onClose, onComplete }: {
  defaults: Overview['config']['oauth']
  request: Request
  onClose: () => void
  onComplete: () => void
}) {
  const [provider, setProvider] = useState(defaults.provider || 'social')
  const [stage, setStage] = useState(defaults.build_stage || 'prod')
  const [region, setRegion] = useState(defaults.region || '')
  const [session, setSession] = useState<LoginSession | null>(null)
  const [url, setURL] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const sessionId = useRef('')
  const active = useRef(true)

  useEffect(() => {
    active.current = true
    const cancel = () => {
      if (sessionId.current) {
        void request(`login/${encodeURIComponent(sessionId.current)}`, { method: 'DELETE', keepalive: true }).catch(() => {})
        sessionId.current = ''
      }
    }
    window.addEventListener('pagehide', cancel)
    return () => {
      active.current = false
      window.removeEventListener('pagehide', cancel)
      cancel()
    }
  }, [request])

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const path = session ? `login/${encodeURIComponent(session.id)}/callback` : 'login'
      const body = session ? { url: url.trim() } : { provider, stage, region: region.trim() }
      const result = await request<LoginResult>(path, { method: 'POST', body: JSON.stringify(body) })
      if (!active.current) {
        if (result.step !== 'complete') await request(`login/${encodeURIComponent(result.id)}`, { method: 'DELETE' })
        return
      }
      if (result.step === 'complete') {
        sessionId.current = ''
        onComplete()
      } else {
        sessionId.current = result.id
        setSession(result)
        setURL('')
      }
    } catch (err) {
      if (active.current) {
        if (err instanceof ApiError && err.status === 410) {
          sessionId.current = ''
          setSession(null)
          setURL('')
        }
        setError(errorMessage(err))
      }
    } finally {
      if (active.current) setBusy(false)
    }
  }

  const authorize = session?.step === 'authorize'

  return (
    <Dialog open onOpenChange={open => { if (!open && !busy) onClose() }}>
      <DialogContent showCloseButton={!busy} className='max-h-[90svh] overflow-y-auto sm:max-w-lg'
        {...(session ? {} : { 'aria-describedby': undefined })}>
        <DialogHeader className='text-start'>
          <DialogTitle>添加账号</DialogTitle>
          {session && (
            <DialogDescription>
              {authorize ? '授权后，粘贴含 code 和 state 的完整回调地址。' : '登录后，粘贴含 nonce 的完整回调地址。'}
              回调页面无法打开时，仍可从浏览器地址栏复制。
            </DialogDescription>
          )}
        </DialogHeader>
        <form id='login-form' onSubmit={submit} className='space-y-4 px-0.5'>
          {!session ? <>
            <div className='grid grid-cols-6 items-center space-y-0 gap-x-4 gap-y-1'>
              <Label htmlFor='provider' className='col-span-2 justify-end'>登录方式</Label>
              <Select value={provider} onValueChange={setProvider} disabled={busy}>
                <SelectTrigger id='provider' className='col-span-4 w-full'><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value='social'>个人账号（Social）</SelectItem>
                  <SelectItem value='enterprise'>企业单点登录（Enterprise）</SelectItem>
                  <SelectItem value='gateway'>Gateway</SelectItem>
                  <SelectItem value='social_gateway'>Social Gateway</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className='grid grid-cols-6 items-center space-y-0 gap-x-4 gap-y-1'>
              <Label htmlFor='stage' className='col-span-2 justify-end'>环境</Label>
              <Select value={stage} onValueChange={setStage} disabled={busy}>
                <SelectTrigger id='stage' className='col-span-4 w-full'><SelectValue /></SelectTrigger>
                <SelectContent>{['prod', 'beta', 'integ', 'dev'].map(value => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className='grid grid-cols-6 items-center space-y-0 gap-x-4 gap-y-1'>
              <Label htmlFor='region' className='col-span-2 justify-end'>区域（可选）</Label>
              <Input id='region' className='col-span-4' value={region} disabled={busy} placeholder='us-east-1' onChange={event => setRegion(event.target.value)} />
            </div>
          </> : <>
            <Button variant='outline' asChild><a href={session.url} rel='noopener noreferrer' target='_blank'>
              {authorize ? '打开 Amazon 授权页面' : '打开 Amazon 登录页面'}<ExternalLink />
            </a></Button>
            <div className='space-y-2'>
              <Label htmlFor='callback'>回调地址</Label>
              <Input id='callback' value={url} autoComplete='off' spellCheck={false} required disabled={busy}
                placeholder={authorize ? 'http://127.0.0.1:…/?code=…' : 'http://localhost:…/callback?nonce=…'}
                onChange={event => setURL(event.target.value)} />
            </div>
          </>}
          {error && <p className='text-sm text-destructive' role='alert'>{error}</p>}
        </form>
        <DialogFooter>
          <Button variant='outline' disabled={busy} onClick={onClose}>取消</Button>
          <Button type='submit' form='login-form' disabled={busy || (!!session && !url.trim())}>
            {busy && <LoaderCircle className='animate-spin' />}{authorize ? '完成授权' : '继续'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
