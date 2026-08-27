import type { Config } from 'tailwindcss'

/**
 * Grace Lead Manager visual system — "a warm ledger". See docs/DESIGN.md.
 *
 * The neutral scale keeps the token name `slate` (it is used across the whole
 * codebase as "neutral") but its values are a warm stone ramp: cold gray is
 * what makes a CRM feel like an admin template, and this product is about
 * people. `brand` is a deep evergreen; `accent` is warm clay, used sparingly.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        slate: {
          50: '#f7f5f2',
          100: '#f0eeea',
          200: '#e5e2dc',
          300: '#d3cfc8',
          400: '#a49d94',
          500: '#736c64',
          600: '#57524b',
          700: '#443f39',
          800: '#2e2a25',
          900: '#211d19',
          950: '#151310',
        },
        brand: {
          50: '#f1f7f3',
          100: '#ddeee3',
          200: '#bcdec9',
          300: '#8ec7a4',
          400: '#57a97c',
          500: '#35895c',
          600: '#2b6a4d',
          700: '#245741',
          800: '#1e4735',
          900: '#193a2c',
          950: '#0d211a',
        },
        accent: {
          50: '#fbf6f0',
          100: '#f5e9dc',
          200: '#ead2b8',
          300: '#dcb28c',
          400: '#cd8f5e',
          500: '#bf6f3f',
          600: '#a4562c',
          700: '#874626',
          800: '#6d3a23',
          900: '#59301e',
        },
        // The one dark surface in the product: the navigation rail.
        ink: {
          DEFAULT: '#1b2420',
          soft: '#243029',
          line: '#32403a',
        },
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['Charter', 'Iowan Old Style', 'Georgia', 'Cambria', 'Times New Roman', 'serif'],
      },
      boxShadow: {
        card: '0 1px 2px 0 rgb(33 29 25 / 0.05), 0 2px 6px -1px rgb(33 29 25 / 0.05)',
        raised: '0 2px 4px rgb(33 29 25 / 0.06), 0 10px 20px -6px rgb(33 29 25 / 0.12)',
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
        'rise-in': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 140ms ease-out',
        'slide-in-left': 'slide-in-left 180ms ease-out',
        'rise-in': 'rise-in 180ms ease-out',
      },
    },
  },
  plugins: [],
}

export default config
