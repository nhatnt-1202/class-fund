/**
 * Thu tiền bằng QR chuyển khoản.
 *
 * Mỗi sinh viên × mỗi đợt thu có một mã riêng, đã gắn sẵn đúng số tiền còn phải nộp và
 * nội dung chuyển khoản chứa mã SV ⇒ không ai chuyển nhầm, thủ quỹ đối chiếu sao kê được.
 * Mã được vẽ NGAY TRÊN MÁY người dùng: số tài khoản không đi tới dịch vụ sinh QR nào.
 *
 * Khi sinh viên còn nợ NHIỀU ĐỢT, có thể gộp thành một mã cho tổng số tiền. Lúc xác nhận
 * đã nhận, tiền được TÁCH THÀNH NHIỀU BẢN GHI THU theo từng đợt (mỗi đợt một bản ghi, đúng
 * quỹ của đợt đó) — một bản ghi chỉ thuộc được một đợt, nếu gộp làm một thì công nợ từng
 * đợt và số liệu hai quỹ sẽ sai.
 *
 * Tiền chỉ vào quỹ khi thủ quỹ bấm "Đã nhận được tiền" — app không tự động xác nhận
 * (đối soát tự động với ngân hàng là việc của bước sau).
 */
import { Copy, Printer, Wallet } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/app/AuthProvider';
import { useToast } from '@/app/ToastProvider';
import { Badge, Button, Field, FundBadge, MoneyInput, Modal, Note, Select } from '@/components/ui';
import { logEvent, useSaveIncomesBatch, useSettings, type NewIncome } from '@/data/api';
import { fmtVnd, toInt } from '@/lib/format';
import { can } from '@/lib/permissions';
import { buildVietQr, qrSvg, transferNote } from '@/lib/vietqr';
import { FUNDS, type ClassSettings, type Period, type Student } from '@/types/db';

const ALL = '__all';

function noteFor(settings: ClassSettings, student: Student | null, periodLabel: string) {
  return transferNote(settings.note_template, {
    code: student?.code ?? '',
    name: student?.full_name ?? '',
    period: periodLabel,
    fund: '',
    className: settings.class_name,
  });
}

const bankReady = (s: ClassSettings | null | undefined) =>
  Boolean(s && /^\d{6}$/.test(s.bank_bin) && s.account_no);

async function copyText(text: string, onDone: () => void) {
  try {
    await navigator.clipboard.writeText(text);
    onDone();
  } catch {
    // Trình duyệt chặn clipboard (thường vì không phải HTTPS) — cách cũ vẫn chạy
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); onDone(); } finally { ta.remove(); }
  }
}

/** Mở cửa sổ in riêng, không phụ thuộc CSS của app. */
function printQrCards(
  settings: ClassSettings,
  items: Array<{ student: Student; note: string; amount: number }>,
  title: string,
) {
  const cards = items.map(({ student, note, amount }) => {
    const svg = qrSvg(buildVietQr({ bin: settings.bank_bin, accountNo: settings.account_no, amount, description: note }), 4);
    return `<div class="c"><div class="q">${svg}</div>
      <div class="n">${student.full_name}</div>
      <div class="s">${student.code} · ${fmtVnd(amount)}</div>
      <div class="s">${note}</div></div>`;
  }).join('');

  const w = window.open('', '_blank');
  if (!w) return false;
  w.document.write(`<!doctype html><html lang="vi"><head><meta charset="utf-8">
    <title>QR chuyển khoản — ${title}</title><style>
    body{font-family:'Be Vietnam Pro',system-ui,sans-serif;margin:16px;color:#111}
    h1{font-size:16px;margin:0 0 4px} .meta{font-size:12px;color:#555;margin-bottom:12px}
    .g{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px}
    .c{border:1px solid #ccc;border-radius:8px;padding:8px;text-align:center;break-inside:avoid}
    .q svg{width:100%;height:auto}.n{font-weight:700;font-size:12px;margin-top:4px}.s{font-size:11px;color:#444}
    @media print{.noprint{display:none}}
    </style></head><body>
    <h1>QR chuyển khoản quỹ lớp ${settings.class_name} — ${title}</h1>
    <div class="meta">${settings.bank_name} · ${settings.account_no}${settings.account_name ? ` · ${settings.account_name}` : ''}
      · in lúc ${new Date().toLocaleString('vi-VN')}</div>
    <button class="noprint" onclick="window.print()">In trang này</button>
    <div class="g">${cards}</div></body></html>`);
  w.document.close();
  return true;
}

function NeedBankSetup({ onClose }: { onClose: () => void }) {
  const { role } = useAuth();
  return (
    <div className="space-y-3">
      <Note tone="warn">
        <span>
          Chưa cấu hình tài khoản nhận tiền nên chưa sinh được mã QR.
          {can.editSettings(role)
            ? ' Vào Cài đặt → Tài khoản nhận chuyển khoản để nhập ngân hàng và số tài khoản.'
            : ' Hãy nhờ quản trị lớp nhập ngân hàng và số tài khoản trong Cài đặt.'}
        </span>
      </Note>
      {can.editSettings(role) && (
        <Link to="/cai-dat" onClick={onClose}>
          <Button variant="primary">Mở Cài đặt</Button>
        </Link>
      )}
    </div>
  );
}

export interface QrTarget {
  period: Period;
  remaining: number;
}

export function QrDialog({
  open, onOpenChange, student, periods, remainingOf, initialPeriodId, onCash,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  student: Student | null;
  periods: Period[];
  /** Số tiền sinh viên còn thiếu ở một đợt. */
  remainingOf: (studentId: string, periodId: string) => number;
  initialPeriodId?: string;
  onCash?: (periodId: string) => void;
}) {
  const { role } = useAuth();
  const toast = useToast();
  const { data: settings } = useSettings(role);
  const saveBatch = useSaveIncomesBatch();

  const [selection, setSelection] = useState<string>(initialPeriodId ?? '');
  const [amount, setAmount] = useState(0);

  /** Các đợt sinh viên này còn nợ, sắp theo ngày mở để phân bổ tiền từ đợt cũ nhất. */
  const owing = useMemo(() => {
    if (!student) return [] as QrTarget[];
    return periods
      .map((p) => ({ period: p, remaining: student ? remainingOf(student.id, p.id) : 0 }))
      .filter((x) => x.remaining > 0)
      .sort((a, b) => (a.period.open_date < b.period.open_date ? -1 : 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [student?.id, periods, remainingOf]);

  const totalOwing = owing.reduce((a, x) => a + x.remaining, 0);

  // Mở hộp thoại: mặc định chọn đợt được truyền vào, nếu đợt đó đã nộp đủ thì gộp tất cả
  useEffect(() => {
    if (!open || !student) return;
    const preset = initialPeriodId && owing.some((o) => o.period.id === initialPeriodId)
      ? initialPeriodId
      : owing.length > 1 ? ALL : owing[0]?.period.id ?? initialPeriodId ?? '';
    setSelection(preset);
    setAmount(
      preset === ALL
        ? totalOwing
        : owing.find((o) => o.period.id === preset)?.remaining
          ?? toInt(periods.find((p) => p.id === preset)?.amount_per_student ?? 0),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, student?.id, initialPeriodId, owing.length, totalOwing]);

  /**
   * Phân bổ số tiền vào các đợt: đợt cũ nhất trước, mỗi đợt tối đa bằng số còn thiếu.
   * Sửa số tiền nhỏ hơn tổng thì chỉ những đợt đầu được ghi — quy tắc này hiển thị ngay
   * trong hộp thoại để thủ quỹ thấy tiền sẽ vào đâu.
   */
  const allocation = useMemo(() => {
    const rows: Array<{ period: Period; amount: number }> = [];
    if (selection === ALL) {
      let left = amount;
      for (const o of owing) {
        if (left <= 0) break;
        const take = Math.min(left, o.remaining);
        rows.push({ period: o.period, amount: take });
        left -= take;
      }
      if (left > 0 && rows.length > 0) rows[rows.length - 1]!.amount += left;   // nộp thừa dồn vào đợt cuối
      return rows;
    }
    const p = periods.find((x) => x.id === selection);
    return p && amount > 0 ? [{ period: p, amount }] : [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, amount, owing, periods]);

  const periodLabel = selection === ALL
    ? `${allocation.length} DOT`
    : periods.find((p) => p.id === selection)?.name ?? '';
  const ready = bankReady(settings);
  const note = ready && settings ? noteFor(settings, student, periodLabel) : '';
  const payload = ready && settings
    ? buildVietQr({ bin: settings.bank_bin, accountNo: settings.account_no, amount, description: note })
    : '';
  const svg = qrSvg(payload, 5);

  const fundTotals = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of allocation) m.set(r.period.fund, (m.get(r.period.fund) ?? 0) + r.amount);
    return [...m.entries()];
  }, [allocation]);

  const confirm = async () => {
    if (!student || allocation.length === 0 || amount <= 0) return;
    const rows: NewIncome[] = allocation.map((r) => ({
      date: new Date().toISOString().slice(0, 10),
      fund: r.period.fund,
      period_id: r.period.id,
      student_id: student.id,
      payer_name: student.full_name,
      amount: r.amount,
      method: 'TRANSFER',
      collected_by: settings?.account_name || '',
      note: allocation.length > 1 ? `Chuyển khoản QR (gộp ${allocation.length} đợt)` : 'Chuyển khoản QR',
    }));
    try {
      await saveBatch.mutateAsync(rows);
      toast.ok(
        `Đã ghi nhận chuyển khoản ${fmtVnd(amount)}`,
        rows.length > 1
          ? `${student.full_name} · tách thành ${rows.length} khoản thu theo từng đợt`
          : `${student.full_name} · ${FUNDS[rows[0]!.fund].label}`,
      );
      onOpenChange(false);
    } catch (e) {
      toast.err('Không ghi nhận được', e instanceof Error ? e.message : undefined);
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={student ? `QR chuyển khoản — ${student.full_name}` : 'QR chuyển khoản'}
      sub={student ? `${student.code} · còn nợ tổng ${fmtVnd(totalOwing)}` : undefined}
      footer={
        ready ? (
          <>
            {onCash && can.confirmTransfer(role) && (
              <Button variant="ghost" className="mr-auto" icon={<Wallet className="h-4 w-4" />}
                onClick={() => { onOpenChange(false); onCash(selection === ALL ? (owing[0]?.period.id ?? '') : selection); }}>
                Nộp tiền mặt…
              </Button>
            )}
            <Button onClick={() => onOpenChange(false)}>Đóng</Button>
            {can.confirmTransfer(role) && (
              <Button variant="income" loading={saveBatch.isPending} onClick={() => void confirm()}>
                Đã nhận được tiền — ghi nhận thu
              </Button>
            )}
          </>
        ) : undefined
      }
    >
      {!ready || !settings ? (
        <NeedBankSetup onClose={() => onOpenChange(false)} />
      ) : (
        <div className="space-y-3">
          {/* Chọn đợt: có nhiều đợt còn nợ thì phải nói rõ tiền vào đợt nào */}
          <Field
            label="Trả cho đợt thu nào?"
            hint={selection === ALL
              ? 'Một mã QR cho tổng số tiền; khi xác nhận sẽ tách thành nhiều khoản thu theo từng đợt.'
              : undefined}
          >
            <Select
              id="qr-period"
              value={selection}
              onChange={(e) => {
                const v = e.target.value;
                setSelection(v);
                setAmount(v === ALL
                  ? totalOwing
                  : owing.find((o) => o.period.id === v)?.remaining
                    ?? toInt(periods.find((p) => p.id === v)?.amount_per_student ?? 0));
              }}
            >
              {owing.length > 1 && (
                <option value={ALL}>Tất cả {owing.length} đợt còn nợ · tổng {fmtVnd(totalOwing)}</option>
              )}
              {periods.map((p) => {
                const left = student ? remainingOf(student.id, p.id) : 0;
                return (
                  <option key={p.id} value={p.id}>
                    {p.name} — {FUNDS[p.fund].label} · {left > 0 ? `còn thiếu ${fmtVnd(left)}` : 'đã nộp đủ'}
                  </option>
                );
              })}
            </Select>
          </Field>

          <div className="grid gap-4 sm:grid-cols-[190px_1fr]">
            <div className="qr-svg rounded-[10px] border border-lineStrong bg-white p-2"
              // eslint-disable-next-line react/no-danger -- SVG do chính app sinh từ payload, không phải dữ liệu người dùng
              dangerouslySetInnerHTML={{ __html: svg }}
            />
            <div>
              <Field label="Số tiền chuyển (₫)">
                <MoneyInput value={amount} onChange={setAmount} aria-label="Số tiền chuyển khoản" />
              </Field>
              <dl className="text-sm">
                {[
                  ['Ngân hàng', settings.bank_name || settings.bank_bin],
                  ['Số tài khoản', settings.account_no],
                  ...(settings.account_name ? [['Chủ tài khoản', settings.account_name]] : []),
                  ['Nội dung', note || '(không có)'],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-3 border-b border-dashed border-line py-1">
                    <dt className="whitespace-nowrap text-ink3">{k}</dt>
                    <dd className="num text-right font-semibold">{v}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-2 text-xs text-ink3">
                Quét bằng app ngân hàng có hỗ trợ VietQR. Số tiền và nội dung đã nằm sẵn trong mã.
              </p>
            </div>
          </div>

          {/* Tiền sẽ được ghi vào đâu — quan trọng khi gộp nhiều đợt của hai quỹ khác nhau */}
          {allocation.length > 0 && (
            <div className="rounded-[10px] bg-surface2 p-3">
              <div className="mb-1.5 text-[13px] font-semibold text-ink2">Sẽ ghi vào</div>
              <ul className="space-y-1 text-sm">
                {allocation.map((r) => (
                  <li key={r.period.id} className="flex items-center gap-2">
                    <FundBadge fund={r.period.fund} />
                    <span className="min-w-0 flex-1 truncate">{r.period.name}</span>
                    <b className="num">{fmtVnd(r.amount)}</b>
                  </li>
                ))}
              </ul>
              {fundTotals.length > 1 && (
                <p className="mt-2 border-t border-line pt-2 text-xs text-ink3">
                  Một lần chuyển khoản này sẽ được chia cho {fundTotals.length} quỹ:{' '}
                  {fundTotals.map(([f, v]) => `${FUNDS[f as keyof typeof FUNDS].label} ${fmtVnd(v)}`).join(' · ')}
                </p>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button size="sm" icon={<Copy className="h-4 w-4" />}
              onClick={() => void copyText(note, () => toast.ok('Đã sao chép nội dung chuyển khoản', note))}>
              Sao chép nội dung
            </Button>
            <Button size="sm" icon={<Copy className="h-4 w-4" />}
              onClick={() => void copyText(settings.account_no, () => toast.ok('Đã sao chép số tài khoản'))}>
              Sao chép số tài khoản
            </Button>
            <Button size="sm" variant="ghost" icon={<Printer className="h-4 w-4" />}
              onClick={() => {
                if (!student) return;
                const done = printQrCards(settings, [{ student, note, amount }], periodLabel || 'Chuyển khoản quỹ lớp');
                if (!done) toast.err('Trình duyệt đã chặn cửa sổ in', 'Cho phép pop-up rồi thử lại.');
                else void logEvent('VIEW_QR', `Đã in QR cho ${student.full_name}`);
              }}>
              In / lưu ảnh
            </Button>
          </div>

          {!can.confirmTransfer(role) && (
            <Note tone="info">
              <span>
                Bạn quét mã và chuyển khoản, sau đó <b>thủ quỹ</b> sẽ đối chiếu sao kê rồi xác nhận.
                Tiền chỉ được cộng vào quỹ khi có người xác nhận.
              </span>
            </Note>
          )}
        </div>
      )}
    </Modal>
  );
}

export function QrSheetDialog({
  open, onOpenChange, period, periods, students, remainingOf,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Đợt được mở từ trang Đợt thu; null khi mở ở chế độ tất cả. */
  period: Period | null;
  periods: Period[];
  students: Student[];
  remainingOf: (studentId: string, periodId: string) => number;
}) {
  const { role } = useAuth();
  const toast = useToast();
  const { data: settings } = useSettings(role);
  const ready = bankReady(settings);
  const [mode, setMode] = useState<'period' | 'all'>('period');

  useEffect(() => {
    if (open) setMode('period');
  }, [open, period?.id]);

  /** Mỗi sinh viên một mã: hoặc cho đúng đợt đang mở, hoặc gộp mọi đợt còn nợ. */
  const cards = useMemo(() => {
    if (!ready || !settings) return [];
    return students
      .map((student) => {
        const targets = (mode === 'all' ? periods : period ? [period] : [])
          .map((p) => ({ p, left: remainingOf(student.id, p.id) }))
          .filter((x) => x.left > 0);
        const amount = targets.reduce((a, x) => a + x.left, 0);
        if (amount <= 0) return null;
        const label = mode === 'all' && targets.length > 1 ? `${targets.length} DOT` : targets[0]!.p.name;
        const note = noteFor(settings, student, label);
        return { student, amount, note, count: targets.length, svg: qrSvg(buildVietQr({
          bin: settings.bank_bin, accountNo: settings.account_no, amount, description: note,
        }), 3) };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, settings, mode, period?.id, periods, students, remainingOf]);

  const title = mode === 'all' ? 'tất cả đợt còn nợ' : (period?.name ?? '');
  const total = cards.reduce((a, c) => a + c.amount, 0);

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      wide
      title={`QR cả lớp — ${title}`}
      sub={`${cards.length}/${students.length} sinh viên còn phải nộp · mỗi mã đã gắn sẵn số tiền và nội dung riêng`}
      footer={<Button onClick={() => onOpenChange(false)}>Đóng</Button>}
    >
      {!ready || !settings ? (
        <NeedBankSetup onClose={() => onOpenChange(false)} />
      ) : (
        <div className="space-y-3">
          <Field label="Mã QR cho đợt nào?" group>
            <div className="flex flex-wrap gap-2">
              {([['period', period ? `Chỉ đợt “${period.name}”` : 'Đợt đang chọn'], ['all', 'Tất cả đợt còn nợ']] as const)
                .map(([v, label]) => (
                  <button
                    key={v}
                    type="button"
                    disabled={v === 'period' && !period}
                    onClick={() => setMode(v)}
                    className={`rounded-full border px-3 py-1.5 text-[13px] transition-colors disabled:opacity-50
                      ${mode === v
                        ? 'border-transparent bg-brand font-semibold text-white'
                        : 'border-lineStrong bg-surface hover:bg-surface2'}`}
                  >
                    {label}
                  </button>
                ))}
            </div>
          </Field>

          {cards.length === 0 ? (
            <Note tone="ok"><span>Cả lớp đã nộp đủ, không cần tạo QR.</span></Note>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  icon={<Printer className="h-4 w-4" />}
                  onClick={() => {
                    const done = printQrCards(settings, cards, title);
                    if (!done) toast.err('Trình duyệt đã chặn cửa sổ in', 'Cho phép pop-up rồi thử lại.');
                    else void logEvent('VIEW_QR', `Đã in ${cards.length} mã QR — ${title}`);
                  }}
                >
                  In tất cả
                </Button>
                <span className="text-[13px] text-ink3">
                  Mẹo: in ra dán bảng, hoặc chụp từng ô gửi vào nhóm lớp — mỗi người quét mã của mình.
                </span>
              </div>
              <div className="grid max-h-[54vh] gap-3 overflow-auto p-0.5
                [grid-template-columns:repeat(auto-fill,minmax(158px,1fr))]">
                {cards.map((c) => (
                  <figure key={c.student.id} className="m-0 rounded-[10px] border border-line bg-surface p-2 text-center">
                    <div className="qr-svg rounded bg-white p-1"
                      // eslint-disable-next-line react/no-danger -- SVG do app tự sinh
                      dangerouslySetInnerHTML={{ __html: c.svg }}
                    />
                    <figcaption className="mt-1.5">
                      <div className="text-[13px] font-semibold leading-tight">{c.student.full_name}</div>
                      <div className="num text-xs text-ink3">{c.student.code} · <b>{fmtVnd(c.amount)}</b></div>
                      {c.count > 1 && <Badge className="mt-1">{c.count} đợt</Badge>}
                    </figcaption>
                  </figure>
                ))}
              </div>
              <p className="text-xs text-ink3">
                Tổng còn phải thu: <b className="num text-ink2">{fmtVnd(total)}</b>
              </p>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
