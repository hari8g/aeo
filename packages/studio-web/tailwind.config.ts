import type { Config } from 'tailwindcss'

/** Brand tokens aligned with Bosch Mobility Platform & Solutions (bosch-mps.com) */
export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Keep `pink` class names for compatibility — mapped to Bosch red
        pink: { DEFAULT: '#E20015', bg: '#FFF1F2', bd: '#FECACA' },
        bosch: {
          red: '#E20015',
          redSoft: '#FFF1F2',
          black: '#000000',
          ink: '#1A1A1A',
          muted: '#5C6670',
          line: '#E5E7EB',
          surface: '#F5F6F8',
        },
        ok: { DEFAULT: '#0D9268', bg: '#F0FDF9', bd: '#A7DFCA' },
        amber: { DEFAULT: '#D97706', bg: '#FFFBEB', bd: '#FCD34D' },
        blue: { DEFAULT: '#2563EB', bg: '#EFF6FF', bd: '#BFDBFE' },
        ink: { 1: '#1A1A1A', 2: '#5C6670', 3: '#8B939E' },
        surface: { 1: '#FFFFFF', 2: '#F5F6F8' },
        line: { DEFAULT: '#E5E7EB', 2: '#D1D5DB' },
      },
      borderRadius: { xl2: '10px', xl3: '12px' },
      fontFamily: {
        sans: ['var(--font-inter)', 'Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
} satisfies Config
