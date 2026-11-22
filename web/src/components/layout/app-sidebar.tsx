import { Activity, Command } from 'lucide-react'
import { useLayout } from '@/context/layout-provider'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '@/components/ui/sidebar'
import { type PageId } from './data/sidebar-data'
import { NavGroup } from './nav-group'

export function AppSidebar({ pageId }: { pageId: PageId }) {
  const { collapsible, variant } = useLayout()
  return (
    <Sidebar collapsible={collapsible} variant={variant}>
      <SidebarHeader>
        <div className='flex h-12 items-center gap-2 overflow-hidden p-2 group-data-[collapsible=icon]:h-8 group-data-[collapsible=icon]:p-0'>
          <span className='flex size-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground'>
            <Command className='size-4' aria-hidden='true' />
          </span>
          <span className='truncate text-sm font-semibold'>QuickProxy</span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <NavGroup pageId={pageId} />
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip='健康检查'>
              <a href='/healthz' target='_blank' rel='noopener noreferrer' aria-label='查看当前实例的健康检查' title='健康检查'>
                <Activity />
                <span className='truncate'>{window.location.host}</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
