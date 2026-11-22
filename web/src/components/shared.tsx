import { useEffect, useRef, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { accountStatus, type Account } from '@/lib/api'

export function CopyButton({ value, label }: { value: string; label: string }) {
  const [state, setState] = useState<'idle' | 'done' | 'error'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setState('done')
    } catch {
      setState('error')
    }
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setState('idle'), 2400)
  }
  return (
    <div className='flex items-center gap-2'>
      <span role='status' className='text-xs text-muted-foreground'>
        {state === 'done' ? '已复制' : state === 'error' ? '请手动复制' : ''}
      </span>
      <Button variant='ghost' size='icon' className='h-8 w-8' onClick={copy} title={label} aria-label={label}>
        {state === 'done' ? <Check /> : <Copy />}
      </Button>
    </div>
  )
}

export function Status({ account }: { account: Account }) {
  return <Badge variant='outline'>{accountStatus(account).label}</Badge>
}
