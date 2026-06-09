import type { Config } from 'tailwindcss'

export default {
  darkMode: 'class',
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './content/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        background: 'hsl(var(--background))',
        surface: 'hsl(var(--surface-1))',
        foreground: 'hsl(var(--foreground))',
        border: 'hsl(var(--border))',
        ring: 'hsl(var(--ring))',
        muted: { foreground: 'hsl(var(--muted-foreground))' },
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        violet: {
          core: 'hsl(var(--v-core))',
          mid: 'hsl(var(--v-mid))',
          soft: 'hsl(var(--v-soft))',
          wash: 'hsl(var(--v-wash))',
        },
        charcoal: {
          DEFAULT: 'hsl(var(--charcoal))',
          foreground: 'hsl(var(--charcoal-foreground))',
        },
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'Inter', 'system-ui', 'sans-serif'],
        display: ['var(--font-space-grotesk)', 'Space Grotesk', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      backgroundImage: {
        'violet-tip':
          'linear-gradient(135deg, hsl(var(--v-core)) 0%, hsl(var(--v-mid)) 55%, hsl(var(--v-soft)) 100%)',
        'hero-glow':
          'radial-gradient(60% 50% at 50% 0%, hsl(var(--v-core)/0.22), transparent 70%)',
      },
      transitionTimingFunction: {
        expo: 'cubic-bezier(0.16, 1, 0.3, 1)',
        gentle: 'cubic-bezier(0.25, 0.1, 0.25, 1)',
      },
      maxWidth: { content: '72rem' },
    },
  },
  plugins: [],
} satisfies Config
