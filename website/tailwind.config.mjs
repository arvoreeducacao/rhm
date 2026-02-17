import typography from '@tailwindcss/typography';

export default {
  darkMode: 'class',
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      colors: {
        brand: {
          50: '#f0fdfa',
          100: '#d4f7f0',
          200: '#a9efe2',
          300: '#76e2d1',
          400: '#4dd4c5',
          500: '#45D0C1',
          600: '#35a99c',
          700: '#2d8880',
          800: '#286c67',
          900: '#255a55',
          950: '#113634',
        },
      },
      animation: {
        'float-slow': 'float-slow 20s ease-in-out infinite',
        'float-medium': 'float-medium 14s ease-in-out infinite',
        'float-fast': 'float-fast 10s ease-in-out infinite',
        'fade-in-up': 'fade-in-up 0.8s ease-out forwards',
      },
      keyframes: {
        'float-slow': {
          '0%, 100%': { transform: 'translate(0, 0) rotate(0deg)' },
          '25%': { transform: 'translate(15px, -20px) rotate(2deg)' },
          '50%': { transform: 'translate(-10px, -35px) rotate(-1deg)' },
          '75%': { transform: 'translate(-20px, -15px) rotate(3deg)' },
        },
        'float-medium': {
          '0%, 100%': { transform: 'translate(0, 0) rotate(0deg)' },
          '33%': { transform: 'translate(-25px, -25px) rotate(-3deg)' },
          '66%': { transform: 'translate(20px, -15px) rotate(2deg)' },
        },
        'float-fast': {
          '0%, 100%': { transform: 'translate(0, 0)' },
          '50%': { transform: 'translate(10px, -20px)' },
        },
        'fade-in-up': {
          '0%': { opacity: '0', transform: 'translateY(30px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [typography],
};
