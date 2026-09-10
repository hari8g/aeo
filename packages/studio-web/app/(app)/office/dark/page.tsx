'use client'

import { useEffect } from 'react'
import OfficePage from '../page'

export default function OfficeDarkPage() {
  useEffect(() => {
    document.documentElement.dataset.officeTheme = 'dark'
    document.documentElement.classList.add('office-dark')
    return () => {
      delete document.documentElement.dataset.officeTheme
    }
  }, [])
  return <OfficePage />
}
