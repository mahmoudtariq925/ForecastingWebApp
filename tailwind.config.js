/** @type {import('tailwindcss').Config} */
// The design tokens mirror the CSS variables defined in the original prototype
// (see src/index.css :root). Tailwind utilities reference the variables so the
// palette stays single-sourced.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        'bg-elev': 'var(--bg-elev)',
        'bg-elev-2': 'var(--bg-elev-2)',
        border: 'var(--border)',
        'border-strong': 'var(--border-strong)',
        text: 'var(--text)',
        'text-dim': 'var(--text-dim)',
        'text-muted': 'var(--text-muted)',
        accent: 'var(--accent)',
        green: 'var(--green)',
        red: 'var(--red)',
        amber: 'var(--amber)',
        blue: 'var(--blue)',
      },
      fontFamily: {
        serif: ['Fraunces', 'Georgia', 'serif'],
        sans: ['Inter Tight', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
};
