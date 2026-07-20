import { auth } from '@/auth'
import { canEditBusinessCase } from '@/lib/roles'
import ValueClient from './ValueClient'

export default async function BusinessValuePage({ params }: { params: { id: string } }) {
  const session = await auth()
  const role = (session?.user as { role?: string } | undefined)?.role
  return <ValueClient id={params.id} canEdit={canEditBusinessCase(role)} />
}
