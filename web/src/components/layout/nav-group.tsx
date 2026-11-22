import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'
import { pages, type PageId } from './data/sidebar-data'

export function NavGroup({ pageId }: { pageId: PageId }) {
  const { setOpenMobile } = useSidebar()
  return (
    <nav aria-label='主导航'>
      <SidebarGroup>
        <SidebarMenu>
          {pages.map((item) => (
            <SidebarMenuItem key={item.id}>
              <SidebarMenuButton
                asChild
                isActive={item.id === pageId}
                tooltip={item.title}
              >
                <a
                  href={`#${item.id}`}
                  aria-current={item.id === pageId ? 'page' : undefined}
                  onClick={() => setOpenMobile(false)}
                >
                  <item.icon />
                  <span>{item.title}</span>
                </a>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroup>
    </nav>
  )
}
