import { auth } from '@/auth'
import { canEditBusinessCase } from '@/lib/roles'
import EffortClient from './EffortClient'

export default async function EngineeringEffortPage({ params }: { params: { id: string } }) {
  const session = await auth()
  const role = (session?.user as { role?: string } | undefined)?.role
  return <EffortClient id={params.id} canEdit={canEditBusinessCase(role)} />
}
