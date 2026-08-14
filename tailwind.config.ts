import type { Config } from 'tailwindcss'

/**
 * Grace Lead Management visual system — a bright, practical CRM. See docs/DESIGN.md.
 *
 * The neutral scale keeps the token name `slate` (it is used across the whole
 * codebase as "neutral") but its values are a near-neutral ramp with a faint
 * warm cast: cool blue-gray reads as a developer tool, beige reads as a
 * template. `brand` is a confident spruce green — the one action color —
 * and `accent` is a warm amber reserved for "today" and highlight moments.
 *
 * Contrast commitments (verified, WCAG AA):
 *   white on brand-600  5.35:1   (primary buttons)
 *   brand-700 on white  6.99:1   (links)
 *   slate-500 on white  5.55:1   (the muted-text floor — never lighter for meaning)
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        slate: {
          50: '#f8f7f5',
          100: '#f1efec',
          200: '#e5e3df',
          300: '#d4d1cc',
          400: '#a3a099',
          500: '#6b6862',
          600: '#55524c',
          700: '#413e39',
          800: '#2b2925',
          900: '#1f1d1a',
          950: '#141310',
        },
        brand: {
          50: '#ecf7f1',
          100: '#d8efe4',
          200: '#b2dfc9',
          300: '#7fc9a8',
          400: '#43ab7f',
          500: '#16905f',
          600: '#0e7a52',
          700: '#0b6647',
          800: '#0b533b',
          900: '#0a4431',
          950: '#052e21',
        },
        accent: {
          50: '#fdf6ee',
          100: '#f9e9d4',
          200: '#f2d3aa',
          300: '#e8b578',
          400: '#dc924b',
          500: '#c9742e',
          600: '#a95a20',
          700: '#88481d',
          800: '#6d3a1d',
          900: '#59301b',
        },
      },
      fontFamily: {
        // One practical sans everywhere; the serif display voice is retired.
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        // Surfaces are defined by their 1px border; the shadow is a hint, not
        // an elevation system. Floating layers (menus, dialogs) use `raised`.
        card: '0 1px 2px 0 rgb(31 29 26 / 0.04)',
        raised: '0 2px 4px rgb(31 29 26 / 0.05), 0 8px 20px -4px rgb(31 29 26 / 0.14)',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(2px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-in-left': {
          from: { opacity: '0.4', transform: 'translateX(-12px)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
        'slide-in-right': {
          from: { opacity: '0.4', transform: 'translateX(12px)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
        'rise-in': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 140ms ease-out',
        'slide-in-left': 'slide-in-left 180ms ease-out',
        'slide-in-right': 'slide-in-right 180ms ease-out',
        'rise-in': 'rise-in 180ms ease-out',
      },
    },
  },
  plugins: [],
}

export default config
