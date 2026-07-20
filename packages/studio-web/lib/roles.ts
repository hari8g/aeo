export function canEditBusinessCase(role?: string | null): boolean {
  return role === 'admin' || role === 'editor'
}
