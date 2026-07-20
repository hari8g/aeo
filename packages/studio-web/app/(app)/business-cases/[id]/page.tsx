import { auth } from '@/auth'
import { canEditBusinessCase } from '@/lib/roles'
import BusinessCaseClient from './BusinessCaseClient'

export default async function BusinessCaseDetailPage({
  params,
}: {
  params: { id: string }
}) {
  const session = await auth()
  const role = (session?.user as { role?: string } | undefined)?.role
  const canEdit = canEditBusinessCase(role)

  return <BusinessCaseClient id={params.id} canEdit={canEdit} />
}
