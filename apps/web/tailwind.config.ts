import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        steel: {
          950: '#0a0c10',
          900: '#0f1218',
          850: '#141821',
          800: '#1a1f2b',
          750: '#212735',
          700: '#2a3040',
          600: '#3d4559',
          500: '#555e74',
          400: '#717b93',
          300: '#949db3',
          200: '#b8bfcf',
          100: '#d4d9e3',
          50: '#eceef3',
        },
        surface: {
          primary: '#f8f9fb',
          secondary: '#ffffff',
          elevated: '#ffffff',
        },
        accent: {
          blue: '#3b82f6',
          'blue-hover': '#2563eb',
          'blue-muted': '#1e3a5f',
          amber: '#f59e0b',
          'amber-muted': '#78350f',
          emerald: '#10b981',
          'emerald-muted': '#064e3b',
          rose: '#f43f5e',
          'rose-muted': '#881337',
          violet: '#8b5cf6',
          'violet-muted': '#4c1d95',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.625rem', { lineHeight: '0.875rem' }],
      },
      spacing: {
        '18': '4.5rem',
        '88': '22rem',
        '128': '32rem',
      },
      boxShadow: {
        'steel': '0 1px 3px 0 rgba(0, 0, 0, 0.12), 0 1px 2px -1px rgba(0, 0, 0, 0.08)',
        'steel-md': '0 4px 6px -1px rgba(0, 0, 0, 0.12), 0 2px 4px -2px rgba(0, 0, 0, 0.08)',
        'steel-lg': '0 10px 15px -3px rgba(0, 0, 0, 0.15), 0 4px 6px -4px rgba(0, 0, 0, 0.1)',
        'steel-inner': 'inset 0 1px 2px 0 rgba(0, 0, 0, 0.06)',
        'glow-blue': '0 0 12px rgba(59, 130, 246, 0.15)',
        'glow-emerald': '0 0 12px rgba(16, 185, 129, 0.15)',
      },
      borderRadius: {
        'steel': '6px',
      },
      animation: {
        'fade-in': 'fadeIn 0.2s ease-out',
        'slide-up': 'slideUp 0.3s ease-out',
        'pulse-subtle': 'pulseSubtle 2s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        pulseSubtle: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.7' },
        },
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
  ],
};

export default config;
