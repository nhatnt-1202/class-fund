import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type ThemeMode = 'light' | 'dark' | 'auto';

export interface Prefs {
  theme: ThemeMode;
  reading: boolean;      // chế độ dễ đọc
  noMotion: boolean;     // giảm chuyển động
  fontScale: number;     // 1 · 1.12 · 1.25
}

const DEFAULTS: Prefs = { theme: 'auto', reading: false, noMotion: false, fontScale: 1 };
const KEY = 'quylop.prefs';

interface Ctx extends Prefs {
  set: (patch: Partial<Prefs>) => void;
  cycleTheme: () => void;
}
const ThemeCtx = createContext<Ctx>({ ...DEFAULTS, set: () => {}, cycleTheme: () => {} });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<Prefs>(() => {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Prefs>) } : DEFAULTS;
    } catch {
      return DEFAULTS;
    }
  });

  useEffect(() => {
    document.documentElement.dataset.theme = prefs.theme;
    document.documentElement.style.setProperty('--fs-scale', String(prefs.fontScale));
    document.body.classList.toggle('reading', prefs.reading);
    document.body.classList.toggle('no-motion', prefs.noMotion);
    try {
      localStorage.setItem(KEY, JSON.stringify(prefs));
    } catch {
      /* trình duyệt chặn lưu — không sao, chỉ mất tuỳ chọn hiển thị */
    }
  }, [prefs]);

  const set = useCallback((patch: Partial<Prefs>) => setPrefs((p) => ({ ...p, ...patch })), []);
  const cycleTheme = useCallback(
    () => setPrefs((p) => ({ ...p, theme: p.theme === 'auto' ? 'light' : p.theme === 'light' ? 'dark' : 'auto' })),
    [],
  );
  const value = useMemo(() => ({ ...prefs, set, cycleTheme }), [prefs, set, cycleTheme]);
  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

export const usePrefs = () => useContext(ThemeCtx);
