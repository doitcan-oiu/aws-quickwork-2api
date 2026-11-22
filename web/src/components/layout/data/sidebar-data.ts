import { Activity, BookOpen, LayoutDashboard, Users } from 'lucide-react'

export const pages = [
  { id: 'overview', title: '运行概览', icon: LayoutDashboard },
  { id: 'accounts', title: '账号管理', icon: Users },
  { id: 'status', title: '账号状态', icon: Activity },
  { id: 'guide', title: '接口接入', icon: BookOpen },
] as const

export type PageId = (typeof pages)[number]['id']

export function currentPage() {
  return pages.find((page) => page.id === window.location.hash.slice(1)) ?? pages[0]
}
