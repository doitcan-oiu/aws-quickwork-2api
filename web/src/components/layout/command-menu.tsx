import { useCallback } from 'react'
import { ArrowRight, Laptop, Moon, Sun } from 'lucide-react'
import { useSearch } from '@/context/search-provider'
import { useTheme } from '@/context/theme-provider'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'
import { ScrollArea } from '@/components/ui/scroll-area'
import { pages } from './data/sidebar-data'

export function CommandMenu() {
  const { setTheme } = useTheme()
  const { open, setOpen } = useSearch()

  const runCommand = useCallback(
    (command: () => void) => {
      setOpen(false)
      command()
    },
    [setOpen]
  )

  return (
    <CommandDialog modal open={open} onOpenChange={setOpen} title='搜索控制台' description='查找页面或选择主题'>
      <CommandInput placeholder='搜索页面或主题…' />
      <CommandList>
        <ScrollArea type='hover' className='h-72 pe-1'>
          <CommandEmpty>没有匹配结果</CommandEmpty>
          <CommandGroup heading='工作空间'>
            {pages.map((page) => (
              <CommandItem
                key={page.id}
                value={page.title}
                keywords={[page.id]}
                onSelect={() => runCommand(() => { window.location.hash = page.id })}
              >
                <div className='flex size-4 items-center justify-center'>
                  <ArrowRight className='size-2 text-muted-foreground/80' />
                </div>
                {page.title}
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading='主题'>
            <CommandItem onSelect={() => runCommand(() => setTheme('light'))}>
              <Sun /> <span>浅色</span>
            </CommandItem>
            <CommandItem onSelect={() => runCommand(() => setTheme('dark'))}>
              <Moon className='scale-90' /> <span>深色</span>
            </CommandItem>
            <CommandItem onSelect={() => runCommand(() => setTheme('system'))}>
              <Laptop /> <span>跟随系统</span>
            </CommandItem>
          </CommandGroup>
        </ScrollArea>
      </CommandList>
    </CommandDialog>
  )
}
