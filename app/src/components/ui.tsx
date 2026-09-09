/** Bộ thành phần giao diện dùng chung. Ưu tiên thẻ HTML đúng nghĩa để đọc được bằng trình đọc màn hình. */
import * as Dialog from '@radix-ui/react-dialog';
import { AnimatePresence, motion } from 'framer-motion';
import { Loader2, X } from 'lucide-react';
import {
  forwardRef, useEffect, useId, useRef, useState,
  type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes,
} from 'react';
import { DUR, EASE, dialogVariants } from '@/lib/motion';
import { fmtNum, fmtVnd, fmtVndSigned, parseMoney } from '@/lib/format';
import { FUNDS, type Fund } from '@/types/db';

/* ============================== Button ============================== */
type Variant = 'default' | 'primary' | 'income' | 'expense' | 'ghost' | 'danger';
const VARIANT: Record<Variant, string> = {
  default: 'border-lineStrong bg-surface hover:bg-surface2',
  primary: 'border-transparent bg-brand text-white shadow-s1 hover:brightness-110',
  income: 'border-transparent bg-income text-white hover:brightness-110',
  expense: 'border-transparent bg-expense text-white hover:brightness-110',
  ghost: 'border-transparent bg-transparent text-ink2 hover:bg-surface2 hover:text-ink',
  danger: 'border-expense/40 text-expense hover:bg-expenseSoft',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md';
  loading?: boolean;
  icon?: ReactNode;
}
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'default', size = 'md', loading, icon, className = '', children, disabled, ...rest }, ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-[10px] border
        font-medium transition-[transform,background,border-color] duration-150 ease-out
        active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50
        ${size === 'sm' ? 'min-h-[32px] px-2.5 text-[13px]' : 'min-h-[40px] px-3.5 text-sm'}
        ${VARIANT[variant]} ${className}`}
      {...rest}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

/* ============================== Card ============================== */
export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`card ${className}`}>{children}</section>;
}
export function CardHead({ title, sub, actions }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
      <div className="min-w-[120px] flex-1">
        <h2 className="text-[1.05rem] font-semibold">{title}</h2>
        {sub && <div className="text-[13px] text-ink3">{sub}</div>}
      </div>
      {actions}
    </header>
  );
}

/* ============================== Field ============================== */
export function Field({
  label, hint, error, required, children,
}: { label: string; hint?: ReactNode; error?: string; required?: boolean; children: ReactNode }) {
  return (
    <label className="mb-3 block">
      <span className="mb-1 block text-[13px] font-semibold text-ink2">
        {label} {required && <span className="text-expense">*</span>}
      </span>
      {children}
      {error ? (
        <span className="mt-1 block text-[13px] font-medium text-expense">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-xs text-ink3">{hint}</span>
      ) : null}
    </label>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input(props, ref) {
    return <input ref={ref} {...props} />;
  },
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select(props, ref) {
    return <select ref={ref} {...props} />;
  },
);

/** Ô nhập tiền: gõ 50000 hoặc 50.000 đều được, tự chèn dấu nhóm nghìn khi gõ. */
export function MoneyInput({
  value, onChange, ...rest
}: { value: number; onChange: (v: number) => void } & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [text, setText] = useState(value ? fmtNum(value) : '');
  useEffect(() => {
    setText(value ? fmtNum(value) : '');
  }, [value]);
  return (
    <input
      {...rest}
      inputMode="numeric"
      className="text-right text-[1.05rem] font-semibold"
      value={text}
      onChange={(e) => {
        const n = parseMoney(e.target.value);
        setText(n ? fmtNum(n) : '');
        onChange(n);
      }}
    />
  );
}

/* ============================== Badge ============================== */
export function Badge({
  tone = 'neutral', children, className = '',
}: { tone?: 'neutral' | 'ok' | 'warn' | 'bad' | 'lop' | 'doan' | 'brand'; children: ReactNode; className?: string }) {
  const tones = {
    neutral: 'bg-surface3 text-ink2',
    ok: 'bg-incomeSoft text-income',
    warn: 'bg-warnSoft text-warn',
    bad: 'bg-expenseSoft text-expense',
    lop: 'bg-lopSoft text-lopInk border border-lop/25',
    doan: 'bg-doanSoft text-doanInk border border-doan/25',
    brand: 'bg-brandSoft text-brandInk',
  };
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5
      text-xs font-semibold leading-5 ${tones[tone]} ${className}`}>
      {children}
    </span>
  );
}

/** Badge quỹ — xuất hiện trên MỌI dòng thu/chi để không ai phải đoán tiền thuộc quỹ nào. */
export function FundBadge({ fund }: { fund: Fund }) {
  const f = FUNDS[fund];
  return (
    <Badge tone={f.cls}>
      <span className={`h-2 w-2 rounded-full ${fund === 'QUY_LOP' ? 'bg-lop' : 'bg-doan'}`} aria-hidden />
      {f.label}
    </Badge>
  );
}

/* ============================== Money ============================== */
export function Money({ value, kind, className = '' }: { value: number; kind?: 'in' | 'out'; className?: string }) {
  const color = kind === 'in' ? 'text-income' : kind === 'out' ? 'text-expense' : '';
  const sign = kind === 'in' ? '+' : kind === 'out' ? '−' : '';
  return (
    <span className={`num whitespace-nowrap font-medium ${color} ${className}`}>
      {sign}{fmtVnd(value)}
    </span>
  );
}

/** Số liệu lớn chạy từ 0 lên giá trị thật (700ms). Tôn trọng "giảm chuyển động". */
export function CountUp({ value, className = '' }: { value: number; className?: string }) {
  const [shown, setShown] = useState(value);
  const prev = useRef(value);
  useEffect(() => {
    const reduce = document.body.classList.contains('no-motion')
      || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
    if (reduce) {
      setShown(value);
      prev.current = value;
      return;
    }
    const from = prev.current;
    const t0 = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const p = Math.min((now - t0) / 700, 1);
      const eased = p === 1 ? 1 : 1 - 2 ** (-10 * p);
      setShown(Math.round(from + (value - from) * eased));
      if (p < 1) raf = requestAnimationFrame(step);
      else prev.current = value;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <span className={`num ${className}`}>{fmtVndSigned(shown)}</span>;
}

/* ============================== Progress ============================== */
export function Progress({ value, fund }: { value: number; fund?: Fund }) {
  const pct = Math.max(0, Math.min(value, 1));
  return (
    <div className="h-[9px] overflow-hidden rounded-full bg-surface3" role="progressbar"
      aria-valuenow={Math.round(pct * 100)} aria-valuemin={0} aria-valuemax={100}>
      <motion.div
        className={`h-full rounded-full ${fund === 'QUY_DOAN' ? 'bg-doan' : fund === 'QUY_LOP' ? 'bg-lop' : 'bg-brand'}`}
        style={{ originX: 0 }}
        initial={{ scaleX: 0 }}
        animate={{ scaleX: pct }}
        transition={{ type: 'spring', stiffness: 260, damping: 26 }}
      />
    </div>
  );
}

/* ============================== Dialog ============================== */
export function Modal({
  open, onOpenChange, title, sub, children, footer, wide,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: ReactNode;
  sub?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild>
              <motion.div
                className="fixed inset-0 z-[100] bg-[rgb(10_12_18/0.45)] backdrop-blur-[7px]"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, transition: { duration: DUR.fast, ease: EASE.in } }}
              />
            </Dialog.Overlay>
            <Dialog.Content asChild>
              <motion.div
                variants={dialogVariants}
                initial="hidden"
                animate="show"
                exit="exit"
                className={`fixed left-1/2 top-1/2 z-[101] max-h-[92vh] w-[calc(100vw-2rem)]
                  -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-[18px] border border-line
                  bg-surface shadow-s2 ${wide ? 'max-w-[1000px]' : 'max-w-[560px]'}`}
              >
                <header className="flex items-start gap-3 px-4 pb-2 pt-4">
                  <div className="flex-1">
                    <Dialog.Title className="font-head text-[1.15rem] font-semibold">{title}</Dialog.Title>
                    {sub && <Dialog.Description className="text-[13px] text-ink3">{sub}</Dialog.Description>}
                  </div>
                  <Dialog.Close asChild>
                    <Button variant="ghost" size="sm" aria-label="Đóng" className="w-8 px-0">
                      <X className="h-[18px] w-[18px]" aria-hidden />
                    </Button>
                  </Dialog.Close>
                </header>
                <div className="px-4 pb-4">{children}</div>
                {footer && (
                  <footer className="sticky bottom-0 flex flex-wrap justify-end gap-2 rounded-b-[18px]
                    border-t border-line bg-surface2 px-4 py-3">
                    {footer}
                  </footer>
                )}
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}

/** Hộp xác nhận cho hành động khó hoàn tác. */
export function ConfirmModal({
  open, onOpenChange, title, message, okLabel = 'Xác nhận', danger, onConfirm, loading,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  message: ReactNode;
  okLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  loading?: boolean;
}) {
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Huỷ</Button>
          <Button variant={danger ? 'expense' : 'primary'} onClick={onConfirm} loading={loading}>{okLabel}</Button>
        </>
      }
    >
      <div className="text-sm leading-relaxed">{message}</div>
    </Modal>
  );
}

/* ============================== Trạng thái rỗng / đang tải ============================== */
export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="grid place-items-center gap-2 px-4 py-10 text-center text-ink3">
      <motion.svg
        width="54" height="54" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3"
        animate={{ y: [0, -4, 0] }}
        transition={{ duration: 3.4, repeat: Infinity, ease: 'easeInOut' }}
        aria-hidden
      >
        <rect x="3" y="5" width="18" height="15" rx="2" />
        <path d="M3 10h18M8 5V3M16 5V3" />
        <path d="M8 14h8" opacity=".5" />
      </motion.svg>
      <div className="font-semibold text-ink">{title}</div>
      {hint && <div className="max-w-prose text-[13px]">{hint}</div>}
      {action}
    </div>
  );
}

export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-2 p-4" aria-busy="true" aria-label="Đang tải dữ liệu">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-3">
          {Array.from({ length: cols }).map((__, c) => (
            <div key={c} className="skel h-4 flex-1" style={{ maxWidth: c === 0 ? 60 : undefined }} />
          ))}
        </div>
      ))}
    </div>
  );
}

/* ============================== Hộp thông báo ============================== */
export function Note({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'ok'; children: ReactNode }) {
  const cls = {
    info: 'bg-brandSoft text-brandInk border-brand/25',
    warn: 'bg-warnSoft text-warn border-warn/30',
    ok: 'bg-incomeSoft text-income border-income/30',
  }[tone];
  return <div className={`flex gap-2 rounded-[10px] border px-3 py-2 text-sm ${cls}`}>{children}</div>;
}

/* ============================== Chip lọc ============================== */
export function Chip({ on, children, ...rest }: { on?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={`rounded-full border px-3 py-1 text-[13px] transition-colors
        ${on ? 'border-transparent bg-brand font-semibold text-white' : 'border-lineStrong bg-surface hover:bg-surface2'}`}
      {...rest}
    >
      {children}
    </button>
  );
}

/** Bảng cuộn ngang trong khung riêng — thân trang không bao giờ cuộn ngang. */
export function TableWrap({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`overflow-x-auto ${className}`}>{children}</div>;
}

export function useFieldId(prefix: string) {
  const id = useId();
  return `${prefix}-${id}`;
}
