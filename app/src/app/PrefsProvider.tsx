/**
 * Tuỳ chọn hiển thị của MÁY người dùng (không đồng bộ giữa các máy).
 *
 * Sáng/tối KHÔNG còn là tuỳ chọn trong app: giao diện luôn đi theo cài đặt của hệ điều
 * hành qua `prefers-color-scheme`. Một công tắc riêng trong app chỉ tạo ra hai nguồn sự
 * thật cho cùng một thứ, và người dùng đã đặt sáng/tối ở cấp máy rồi.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export interface Prefs {
  reading: boolean;      // chế độ dễ đọc
  noMotion: boolean;     // giảm chuyển động
  fontScale: number;     // 1 · 1.12 · 1.25
}

const DEFAULTS: Prefs = { reading: false, noMotion: false, fontScale: 1 };
const KEY = 'quylop.prefs';

interface Ctx extends Prefs {
  set: (patch: Partial<Prefs>) => void;
}
const PrefsCtx = createContext<Ctx>({ ...DEFAULTS, set: () => {} });

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<Prefs>(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return DEFAULTS;
      // Bỏ qua khoá `theme` của bản trước — giờ sáng/tối do hệ thống quyết định
      const { reading, noMotion, fontScale } = JSON.parse(raw) as Partial<Prefs>;
      return { ...DEFAULTS, ...(reading !== undefined && { reading }), ...(noMotion !== undefined && { noMotion }),
        ...(fontScale !== undefined && { fontScale }) };
    } catch {
      return DEFAULTS;
    }
  });

  useEffect(() => {
    /*
     * Xoá data-theme nếu còn sót từ bản cũ: CSS có nhánh `:root[data-theme='dark']` và
     * `:root:not([data-theme='light'])`, nên một thuộc tính cũ nằm lại sẽ ghim giao diện
     * vào sáng/tối và làm hệ thống mất quyền quyết định.
     */
    document.documentElement.removeAttribute('data-theme');
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
  const value = useMemo(() => ({ ...prefs, set }), [prefs, set]);
  return <PrefsCtx.Provider value={value}>{children}</PrefsCtx.Provider>;
}

export const usePrefs = () => useContext(PrefsCtx);
