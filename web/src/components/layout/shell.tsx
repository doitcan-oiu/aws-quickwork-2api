import { getCookie } from '@/lib/cookies'
import { cn } from '@/lib/utils'
import { DirectionProvider } from '@/context/direction-provider'
import { LayoutProvider } from '@/context/layout-provider'
import { SearchProvider } from '@/context/search-provider'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { ThemeSwitch } from '@/components/theme-switch'
import { AppSidebar } from './app-sidebar'
import { ConfigDrawer } from './config-drawer'
import { type PageId } from './data/sidebar-data'
import { Header } from './header'
import { Main } from './main'
import { Search } from './search'
import { SkipToMain } from './skip-to-main'

export { currentPage } from './data/sidebar-data'

export function ConsoleShell({ pageId, children }: { pageId: PageId; children: React.ReactNode }) {
  const defaultOpen = getCookie('sidebar_state') !== 'false'

  return (
    <DirectionProvider>
      <SearchProvider>
        <LayoutProvider>
          <SidebarProvider defaultOpen={defaultOpen}>
            <SkipToMain />
            <AppSidebar pageId={pageId} />
            <SidebarInset
              className={cn(
                '@container/content',
                'has-data-[layout=fixed]:h-svh',
                'peer-data-[variant=inset]:has-data-[layout=fixed]:h-[calc(100svh-(var(--spacing)*4))]'
              )}
            >
              <Header>
                <Search className='ms-auto' />
                <ThemeSwitch />
                <ConfigDrawer />
              </Header>
              <Main
                id='content'
                tabIndex={-1}
                className='flex flex-1 flex-col gap-4 sm:gap-6'
              >
                {children}
              </Main>
            </SidebarInset>
          </SidebarProvider>
        </LayoutProvider>
      </SearchProvider>
    </DirectionProvider>
  )
}
