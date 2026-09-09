import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, Check, X, XCircle } from 'lucide-react';
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { DUR, EASE } from '@/lib/motion';

type Kind = 'ok' | 'err' | 'warn';
interface Toast {
  id: number;
  kind: Kind;
  title: string;
  detail?: string;
  action?: { label: string; run: () => void };
}

interface Ctx {
  toast: (kind: Kind, title: string, detail?: string, action?: Toast['action']) => void;
  ok: (title: string, detail?: string) => void;
  err: (title: string, detail?: string) => void;
}
const ToastCtx = createContext<Ctx>({ toast: () => {}, ok: () => {}, err: () => {} });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const seq = useRef(0);

  const remove = useCallback((id: number) => setItems((l) => l.filter((t) => t.id !== id)), []);
  const toast = useCallback<Ctx['toast']>((kind, title, detail, action) => {
    const id = ++seq.current;
    setItems((l) => [...l, { id, kind, title, detail, action }]);
    // Toast có hành động thì để lâu hơn, người dùng cần thời gian bấm
    window.setTimeout(() => remove(id), action ? 9000 : kind === 'err' ? 7000 : 4800);
  }, [remove]);

  const value = useMemo<Ctx>(() => ({
    toast,
    ok: (title, detail) => toast('ok', title, detail),
    err: (title, detail) => toast('err', title, detail),
  }), [toast]);

  const Icon = { ok: Check, err: XCircle, warn: AlertTriangle };
  const color = { ok: 'text-income', err: 'text-expense', warn: 'text-warn' };
  const border = { ok: 'border-l-income', err: 'border-l-expense', warn: 'border-l-warn' };

  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div className="fixed bottom-4 right-4 z-[200] flex w-[min(400px,calc(100vw-2rem))] flex-col gap-2" aria-live="polite">
        <AnimatePresence initial={false}>
          {items.map((t) => {
            const I = Icon[t.kind];
            return (
              <motion.div
                key={t.id}
                layout
                initial={{ opacity: 0, y: 14, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, x: 18, transition: { duration: DUR.fast, ease: EASE.in } }}
                transition={{ duration: DUR.slow, ease: EASE.out }}
                className={`card flex items-start gap-3 border-l-[3px] p-3 shadow-s2 ${border[t.kind]}`}
              >
                <I className={`mt-0.5 h-[18px] w-[18px] shrink-0 ${color[t.kind]}`} aria-hidden />
                <div className="min-w-0 flex-1 text-sm">
                  <div className="font-semibold">{t.title}</div>
                  {t.detail && <div className="text-ink3">{t.detail}</div>}
                </div>
                {t.action && (
                  <button
                    type="button"
                    className="shrink-0 rounded-md border border-lineStrong px-2 py-1 text-xs font-medium hover:bg-surface2"
                    onClick={() => { remove(t.id); t.action!.run(); }}
                  >
                    {t.action.label}
                  </button>
                )}
                <button
                  type="button"
                  aria-label="Đóng thông báo"
                  className="shrink-0 rounded p-1 text-ink3 hover:bg-surface2"
                  onClick={() => remove(t.id)}
                >
                  <X className="h-4 w-4" aria-hidden />
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);
