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
        normal: '200ms',
      },
      fontSize: {
        '2xs': '0.625rem',  /* 10px — badges, tiny labels */
        'xs': '0.75rem',    /* 12px — body small, controls */
        'sm': '0.8125rem',  /* 13px — body medium */
        'base': '0.875rem', /* 14px — body default */
      },
      zIndex: {
        canvas: '1',
        graph: '2',
        'node-connected': '10',
        'node-selected': '11',
        'edge-hover': '12',
        overlay: '20',
        panel: '21',
        'context-menu': '100',
      },
      maxHeight: {
        128: '32rem',
      },
    },
  },
  plugins: [],
};
