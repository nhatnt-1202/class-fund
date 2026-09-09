/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class', '[data-theme="dark"]'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // Font thân thiện, hỗ trợ đầy đủ dấu tiếng Việt (xem index.html)
      fontFamily: {
        sans: ['"Be Vietnam Pro"', '"Segoe UI"', 'system-ui', '-apple-system', '"Noto Sans"', 'sans-serif'],
        head: ['Lexend', '"Be Vietnam Pro"', 'system-ui', 'sans-serif'],
      },
      colors: {
        bg: 'rgb(var(--c-bg) / <alpha-value>)',
        surface: 'rgb(var(--c-surface) / <alpha-value>)',
        surface2: 'rgb(var(--c-surface-2) / <alpha-value>)',
        surface3: 'rgb(var(--c-surface-3) / <alpha-value>)',
        line: 'rgb(var(--c-border) / <alpha-value>)',
        lineStrong: 'rgb(var(--c-border-strong) / <alpha-value>)',
        ink: 'rgb(var(--c-text) / <alpha-value>)',
        ink2: 'rgb(var(--c-text-2) / <alpha-value>)',
        ink3: 'rgb(var(--c-text-3) / <alpha-value>)',
        brand: 'rgb(var(--c-brand) / <alpha-value>)',
        brandSoft: 'rgb(var(--c-brand-soft) / <alpha-value>)',
        brandInk: 'rgb(var(--c-brand-ink) / <alpha-value>)',
        lop: 'rgb(var(--c-lop) / <alpha-value>)',
        lopSoft: 'rgb(var(--c-lop-soft) / <alpha-value>)',
        lopInk: 'rgb(var(--c-lop-ink) / <alpha-value>)',
        doan: 'rgb(var(--c-doan) / <alpha-value>)',
        doanSoft: 'rgb(var(--c-doan-soft) / <alpha-value>)',
        doanInk: 'rgb(var(--c-doan-ink) / <alpha-value>)',
        income: 'rgb(var(--c-income) / <alpha-value>)',
        incomeSoft: 'rgb(var(--c-income-soft) / <alpha-value>)',
        expense: 'rgb(var(--c-expense) / <alpha-value>)',
        expenseSoft: 'rgb(var(--c-expense-soft) / <alpha-value>)',
        warn: 'rgb(var(--c-warn) / <alpha-value>)',
        chartLop: 'rgb(var(--c-chart-lop) / <alpha-value>)',
        chartDoan: 'rgb(var(--c-chart-doan) / <alpha-value>)',
        warnSoft: 'rgb(var(--c-warn-soft) / <alpha-value>)',
      },
      borderRadius: { xl2: '14px' },
      boxShadow: {
        s1: '0 1px 2px rgb(16 24 40 / 0.05), 0 1px 3px rgb(16 24 40 / 0.08)',
        s2: '0 14px 38px -10px rgb(16 24 40 / 0.22), 0 4px 10px rgb(16 24 40 / 0.06)',
      },
      transitionTimingFunction: { out: 'cubic-bezier(.22,1,.36,1)' },
    },
  },
  plugins: [],
};
