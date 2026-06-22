import type { Config } from 'tailwindcss'

// Ballpark Watch design tokens — "vintage athletic, rendered flat".
// See docs/design_handoff_ballpark_watch/README.md. Hard corners, no shadows.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        cream: '#F4ECD8',
        'cream-off': '#FAF4E6',
        ink: '#1A2A4A', // ink navy
        'barn-red': '#A6342E',
        'board-green': '#2C5234',
        'field-green': '#1E3A24',
        'night-green': '#15281b',
        gold: '#C9A14A',
        'muted-green': '#a9c0ad',
        'muted-tan': '#7a6f54',
      },
      fontFamily: {
        display: ['"Alfa Slab One"', 'serif'],
        athletic: ['"Saira Condensed"', 'sans-serif'],
        data: ['Archivo', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        // Brand-defining: hard corners everywhere. Override Tailwind defaults.
        none: '0',
        DEFAULT: '0',
        sm: '0',
        md: '0',
        lg: '0',
        full: '9999px', // keep for the few intentional circles (runner chips, dots)
      },
      boxShadow: {
        // The only shadow in the system: a hard offset, never a blur.
        hard: '6px 6px 0 #1A2A4A',
        none: 'none',
      },
    },
  },
  plugins: [],
} satisfies Config
