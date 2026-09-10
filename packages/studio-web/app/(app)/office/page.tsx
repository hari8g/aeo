'use client'

import { useEffect, useRef } from 'react'

export default function OfficePage() {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const fonts = document.createElement('link')
    fonts.rel = 'stylesheet'
    fonts.href =
      'https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Inter:wght@400;500;600;700;800&display=swap'
    document.head.appendChild(fonts)
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = `/office/main.css?v=${Date.now()}`
    document.head.appendChild(link)
    const script = document.createElement('script')
    script.type = 'module'
    script.src = `/office/main.js?v=${Date.now()}`
    document.body.appendChild(script)
    return () => {
      fonts.remove()
      link.remove()
      script.remove()
      document.getElementById('office-panel')?.remove()
      document.getElementById('office-connectors')?.remove()
      document.getElementById('office-board')?.remove()
      document.getElementById('office-help')?.remove()
      document.getElementById('office-tip')?.remove()
      document.getElementById('office-hud')?.remove()
      document.getElementById('office-feed')?.remove()
      document.getElementById('office-legend')?.remove()
      document.getElementById('office-inspect')?.remove()
      document.getElementById('office-now')?.remove()
      document.getElementById('office-topic-floats')?.remove()
      document.getElementById('office-metrics')?.remove()
      document.getElementById('office-badges')?.remove()
      document.querySelectorAll('.office-float').forEach((n) => n.remove())
      document.documentElement.classList.remove('office-dim')
      document.documentElement.classList.remove('office-dark')
      document.documentElement.classList.remove('office-io-min')
    }
  }, [])
  return <div id="office-root" ref={ref} style={{ position: 'absolute', inset: 0 }} />
}
