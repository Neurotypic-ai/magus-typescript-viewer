/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{vue,js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        'background-default': 'var(--color-background-default)',
        'background-paper': 'var(--color-background-paper)',
        'background-node': 'var(--color-background-node)',
        'background-node-package': 'var(--color-background-node-package)',
        'text-primary': 'var(--color-text-primary)',
        'text-secondary': 'var(--color-text-secondary)',
        'text-muted': 'var(--color-text-muted)',
        'border-default': 'var(--color-border-default)',
        'border-hover': 'var(--color-border-hover)',
        'border-focus': 'var(--color-border-focus)',
        'primary-main': 'var(--color-primary-main)',
        'visibility-public': 'var(--color-visibility-public)',
        'visibility-protected': 'var(--color-visibility-protected)',
        'visibility-private': 'var(--color-visibility-private)',
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'SF Mono', 'Menlo', 'Consolas', 'Liberation Mono', 'monospace'],
      },
      transitionDuration: {
        fast: '150ms',
      },
    },
  },
  plugins: [],
};
