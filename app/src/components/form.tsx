/** Các mảnh dùng chung cho form thu / chi / đợt thu. */
import { Check, ChevronsUpDown, Pencil, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { fmtNum, fmtVnd, noAccent, parseMoney } from '@/lib/format';
import { FUNDS, FUND_KEYS, type Fund } from '@/types/db';

/* ============================== Khung một nhóm trường ============================== */
export function Section({
  title, hint, accent, children,
}: { title: string; hint?: ReactNode; accent?: Fund; children: ReactNode }) {
  const border = accent === 'QUY_LOP' ? 'border-l-lop' : accent === 'QUY_DOAN' ? 'border-l-doan' : 'border-l-line';
  return (
    <section className={`mb-3 rounded-[12px] border border-line border-l-4 bg-surface2/40 p-3
      transition-colors duration-200 ${border}`}>
      <h3 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-ink3">{title}</h3>
      {hint && <p className="mb-2 text-xs text-ink3">{hint}</p>}
      {children}
    </section>
  );
}

/* ============================== Chọn quỹ ============================== */
/** Quỹ là thông tin dễ nhầm nhất nên phải là nút lớn, có màu, không ẩn trong dropdown. */
export function FundPicker({
  value, onChange, disabled, disabledHint,
}: { value: Fund; onChange: (f: Fund) => void; disabled?: boolean; disabledHint?: string }) {
  return (
    <>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Chọn quỹ">
        {FUND_KEYS.map((f) => {
          const on = value === f;
          const tone = f === 'QUY_LOP'
            ? 'border-lop bg-lopSoft text-lopInk ring-lop/30'
            : 'border-doan bg-doanSoft text-doanInk ring-doan/30';
          return (
            <button
              key={f}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={disabled}
              onClick={() => onChange(f)}
              className={`relative flex min-h-[52px] flex-1 basis-[140px] items-center justify-center gap-2
                rounded-[12px] border-2 px-3 font-semibold transition-all duration-200 ease-out
                hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:translate-y-0
                ${on ? `${tone} ring-2` : 'border-line bg-surface text-ink2'}`}
            >
              <span className={`h-2.5 w-2.5 rounded-full ${f === 'QUY_LOP' ? 'bg-lop' : 'bg-doan'}`} aria-hidden />
              {FUNDS[f].label}
              {on && <Check className="absolute right-2 top-2 h-4 w-4 opacity-70" aria-hidden />}
            </button>
          );
        })}
      </div>
      {disabled && disabledHint && <p className="mt-1.5 text-xs text-ink3">{disabledHint}</p>}
    </>
  );
}

/* ============================== Ô nhập tiền ============================== */
/**
 * Số tiền là con số quan trọng nhất của form nên hiển thị lớn, có đơn vị và có nút điền nhanh.
 * Gõ 50000 hay 50.000 đều được.
 */
export function AmountField({
  value, onChange, quick, autoFocus, id,
}: {
  value: number;
  onChange: (v: number) => void;
  quick?: Array<{ label: string; value: number }>;
  autoFocus?: boolean;
  id?: string;
}) {
  const [text, setText] = useState(value ? fmtNum(value) : '');
  useEffect(() => setText(value ? fmtNum(value) : ''), [value]);
  // Bỏ chip trùng giá trị: "Còn thiếu" và "Cả đợt" thường bằng nhau khi SV chưa nộp gì,
  // để hai chip cùng sáng thì người dùng tưởng đang chọn hai thứ khác nhau.
  const chips = useMemo(() => {
    const seen = new Set<number>();
    return (quick ?? []).filter((q) => q.value > 0 && !seen.has(q.value) && (seen.add(q.value), true));
  }, [quick]);
  return (
    <div>
      <div className="relative">
        <input
          id={id}
          inputMode="numeric"
          autoFocus={autoFocus}
          value={text}
          aria-describedby={chips.length ? `${id ?? 'amount'}-quick` : undefined}
          onChange={(e) => {
            const n = parseMoney(e.target.value);
            setText(n ? fmtNum(n) : '');
            onChange(n);
          }}
          className="h-14 w-full rounded-[12px] border border-lineStrong bg-surface pr-12 text-right
            font-head text-2xl font-bold tracking-tight"
        />
        <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-lg font-semibold text-ink3">
          ₫
        </span>
      </div>
      {chips.length > 0 && (
        <div id={`${id ?? 'amount'}-quick`} className="mt-2 flex flex-wrap gap-1.5">
          {chips.map((q) => (
            <button
              key={q.label}
              type="button"
              onClick={() => onChange(q.value)}
              className={`rounded-full border px-2.5 py-1 text-xs transition-colors
                ${value === q.value
                  ? 'border-transparent bg-brand font-semibold text-white'
                  : 'border-lineStrong bg-surface hover:bg-surface2'}`}
            >
              {q.label} · {fmtVnd(q.value)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ============================== Chọn người ============================== */
export interface PersonGroup {
  label: string;
  names: string[];
}

/**
 * Người thu / người đi mua: chọn từ danh sách có sẵn HOẶC tự nhập tên.
 * Dùng <select> thật (đọc được bằng trình đọc màn hình, mở đúng kiểu trên điện thoại),
 * kèm lựa chọn cuối để chuyển sang gõ tay.
 */
export function PersonField({
  value, onChange, groups, placeholder, id,
}: {
  value: string;
  onChange: (v: string) => void;
  groups: PersonGroup[];
  placeholder?: string;
  id?: string;
}) {
  const known = useMemo(() => {
    const seen = new Set<string>();
    return groups
      .map((g) => ({ ...g, names: g.names.filter((n) => n && !seen.has(n) && seen.add(n)) }))
      .filter((g) => g.names.length > 0);
  }, [groups]);

  const inList = known.some((g) => g.names.includes(value));
  const [manual, setManual] = useState(Boolean(value) && !inList);
  const inputRef = useRef<HTMLInputElement>(null);

  // Giá trị được nạp từ bên ngoài (mở form sửa) thì tự chọn đúng chế độ
  useEffect(() => {
    setManual(Boolean(value) && !known.some((g) => g.names.includes(value)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value === '' ? '' : inList, known.length]);

  if (manual) {
    return (
      <div className="flex gap-2">
        <input
          id={id}
          ref={inputRef}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1"
        />
        {known.length > 0 && (
          <button
            type="button"
            onClick={() => { setManual(false); onChange(''); }}
            title="Chọn từ danh sách"
            className="flex h-11 items-center gap-1.5 whitespace-nowrap rounded-[10px] border
              border-lineStrong px-2.5 text-[13px] hover:bg-surface2"
          >
            <ChevronsUpDown className="h-4 w-4" aria-hidden /> Danh sách
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex gap-2">
      <select
        id={id}
        value={inList ? value : ''}
        onChange={(e) => {
          if (e.target.value === '__manual') {
            setManual(true);
            onChange('');
            setTimeout(() => inputRef.current?.focus(), 30);
          } else {
            onChange(e.target.value);
          }
        }}
        className="flex-1"
      >
        <option value="">— Chọn người —</option>
        {known.map((g) => (
          <optgroup key={g.label} label={g.label}>
            {g.names.map((n) => <option key={`${g.label}-${n}`} value={n}>{n}</option>)}
          </optgroup>
        ))}
        <option value="__manual">✎ Nhập tên khác…</option>
      </select>
      <button
        type="button"
        onClick={() => { setManual(true); setTimeout(() => inputRef.current?.focus(), 30); }}
        title="Nhập tên bằng tay"
        className="flex h-11 items-center gap-1.5 whitespace-nowrap rounded-[10px] border
          border-lineStrong px-2.5 text-[13px] hover:bg-surface2"
      >
        <Pencil className="h-4 w-4" aria-hidden /> Nhập tay
      </button>
    </div>
  );
}

/* ============================== Chọn sinh viên ============================== */
/** Danh sách có tìm kiếm bỏ dấu, hiện luôn tình trạng nộp để không phải mở trang khác kiểm tra. */
export function StudentPicker({
  students, value, onChange, statusOf,
}: {
  students: Array<{ id: string; code: string; full_name: string }>;
  value: string;
  onChange: (id: string) => void;
  statusOf?: (id: string) => { paid: number; remaining: number; must: number } | null;
}) {
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    const query = noAccent(q);
    const rows = query
      ? students.filter((s) => noAccent(s.full_name).includes(query) || s.code.includes(q.trim()))
      : students;
    return rows.slice(0, 200);
  }, [q, students]);

  return (
    <div>
      <div className="relative mb-2">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink3" aria-hidden />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Tìm tên hoặc mã SV (bỏ dấu vẫn tìm được)…"
          aria-label="Tìm sinh viên"
          className="pl-9"
        />
      </div>
      <ul
        className="max-h-[184px] divide-y divide-line overflow-y-auto rounded-[10px] border border-line"
        role="listbox"
        aria-label="Danh sách sinh viên"
      >
        {list.length === 0 && (
          <li className="px-3 py-4 text-center text-sm text-ink3">Không có sinh viên nào khớp</li>
        )}
        {list.map((s) => {
          const on = value === s.id;
          const st = statusOf?.(s.id) ?? null;
          return (
            <li key={s.id} role="option" aria-selected={on}>
              <button
                type="button"
                onClick={() => onChange(s.id)}
                className={`flex w-full items-center gap-3 px-3 py-2 text-left transition-colors
                  ${on ? 'bg-brandSoft' : 'hover:bg-surface2'}`}
              >
                <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border
                  ${on ? 'border-brand bg-brand text-white' : 'border-lineStrong'}`} aria-hidden>
                  {on && <Check className="h-3.5 w-3.5" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{s.full_name}</span>
                  <span className="num block text-xs text-ink3">{s.code}</span>
                </span>
                {st && st.must > 0 && (
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold
                    ${st.remaining === 0
                      ? 'bg-incomeSoft text-income'
                      : st.paid > 0 ? 'bg-warnSoft text-warn' : 'bg-surface3 text-ink2'}`}>
                    {st.remaining === 0 ? 'đã đủ' : st.paid > 0 ? `thiếu ${fmtNum(st.remaining)}` : 'chưa nộp'}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ============================== Dải tổng kết ============================== */
/** Cho người dùng thấy hệ quả của con số vừa nhập, trước khi bấm lưu. */
export function SummaryBar({ items }: { items: Array<{ label: string; value: ReactNode; tone?: 'ok' | 'warn' | 'bad' }> }) {
  return (
    <dl className="flex flex-wrap gap-x-5 gap-y-1.5 rounded-[10px] bg-surface2 px-3 py-2 text-sm" aria-live="polite">
      {items.map((it) => (
        <div key={it.label} className="flex items-baseline gap-1.5">
          <dt className="text-ink3">{it.label}</dt>
          <dd className={`num font-semibold ${
            it.tone === 'ok' ? 'text-income' : it.tone === 'warn' ? 'text-warn' : it.tone === 'bad' ? 'text-expense' : ''
          }`}>
            {it.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/* ============================== Công tắc ============================== */
export function Switch({
  checked, onChange, label, hint, id,
}: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; id?: string }) {
  return (
    <label htmlFor={id} className="flex min-h-[44px] cursor-pointer items-center gap-3">
      <button
        type="button"
        id={id}
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200
          ${checked ? 'bg-income' : 'bg-surface3'}`}
      >
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all duration-200
          ${checked ? 'left-[22px]' : 'left-0.5'}`} aria-hidden />
      </button>
      <span className="text-sm">
        {label}
        {hint && <span className="block text-xs text-ink3">{hint}</span>}
      </span>
    </label>
  );
}
