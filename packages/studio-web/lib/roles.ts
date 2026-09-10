export function canEditBusinessCase(role?: string | null): boolean {
  return role === 'admin' || role === 'editor'
}

export function canViewControlling(role?: string | null): boolean {
  return role === 'admin' || role === 'editor' || role === 'finance'
}

export function canExportPortfolio(role?: string | null): boolean {
  return role === 'admin' || role === 'finance'
}

export function isFinanceOnly(role?: string | null): boolean {
  return role === 'finance'
}
