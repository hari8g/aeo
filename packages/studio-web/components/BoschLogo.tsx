type Props = {
  className?: string
  /** Compact mark for sidebar; full wordmark for login/hero */
  variant?: 'mark' | 'full'
}

export default function BoschLogo({ className = '', variant = 'full' }: Props) {
  const heightClass = variant === 'mark' ? 'h-8' : 'h-12'
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/brand/bosch-logo.svg"
      alt="Bosch"
      className={`${heightClass} w-auto ${className}`}
    />
  )
}
