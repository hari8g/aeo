import { auth } from '@/auth'
import Sidebar from '@/components/Sidebar'
import { redirect } from 'next/navigation'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session?.user) redirect('/login')

  return (
    <div className="grid grid-cols-[230px_1fr] min-h-screen bg-surface-2">
      <Sidebar user={session.user as { name?: string | null; role?: string }} />
      <main className="px-10 py-8 pb-20 max-w-[1120px] w-full">{children}</main>
    </div>
  )
}
