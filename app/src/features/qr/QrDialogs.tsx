/**
 * Thu tiền bằng QR chuyển khoản.
 *
 * Mỗi sinh viên × mỗi đợt thu có một mã riêng, đã gắn sẵn đúng số tiền còn phải nộp và
 * nội dung chuyển khoản chứa mã SV ⇒ không ai chuyển nhầm, thủ quỹ đối chiếu sao kê được.
 * Mã được vẽ NGAY TRÊN MÁY người dùng: số tài khoản không đi tới dịch vụ sinh QR nào.
 *
 * Tiền chỉ vào quỹ khi thủ quỹ bấm "Đã nhận được tiền" — app không tự động xác nhận
 * (đối soát tự động với ngân hàng là việc của bước sau).
 */
import { Copy, Printer, Wallet } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/app/AuthProvider';
import { useToast } from '@/app/ToastProvider';
import { Button, Field, MoneyInput, Modal, Note } from '@/components/ui';
import { logEvent, useSaveIncome, useSettings } from '@/data/api';
import { fmtVnd, toInt } from '@/lib/format';
import { can } from '@/lib/permissions';
import { buildVietQr, qrSvg, transferNote } from '@/lib/vietqr';
import { FUNDS, type ClassSettings, type Period, type Student } from '@/types/db';

function noteFor(settings: ClassSettings, student: Student | null, period: Period | null) {
  return transferNote(settings.note_template, {
    code: student?.code ?? '',
    name: student?.full_name ?? '',
    period: period?.name ?? '',
    fund: period ? FUNDS[period.fund].label : '',
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
  items: Array<{ student: Student; period: Period | null; amount: number }>,
  title: string,
) {
  const cards = items.map(({ student, period, amount }) => {
    const note = noteFor(settings, student, period);
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

export function QrDialog({
  open, onOpenChange, student, period, defaultAmount, onCash,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  student: Student | null;
  period: Period | null;
  defaultAmount: number;
  onCash?: () => void;
}) {
  const { role } = useAuth();
  const toast = useToast();
  const { data: settings } = useSettings(role);
  const [amount, setAmount] = useState(defaultAmount);
  const saveIncome = useSaveIncome();

  // Số tiền mặc định đổi khi mở cho sinh viên / đợt thu khác
  useEffect(() => {
    setAmount(defaultAmount);
  }, [defaultAmount, student?.id, period?.id]);

  const ready = bankReady(settings);
  const note = ready && settings ? noteFor(settings, student, period) : '';
  const payload = ready && settings
    ? buildVietQr({ bin: settings.bank_bin, accountNo: settings.account_no, amount, description: note })
    : '';
  const svg = qrSvg(payload, 5);

  const confirm = async () => {
    if (!student || amount <= 0) return;
    const fund = period?.fund ?? 'QUY_LOP';
    try {
      await saveIncome.mutateAsync({
        values: {
          date: new Date().toISOString().slice(0, 10),
          fund,
          period_id: period?.id ?? null,
          student_id: student.id,
          payer_name: student.full_name,
          amount,
          method: 'TRANSFER',
          collected_by: settings?.account_name || '',
          note: 'Chuyển khoản QR',
        },
      });
      toast.ok(`Đã ghi nhận chuyển khoản ${fmtVnd(amount)}`, `${student.full_name} · ${FUNDS[fund].label}`);
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
      sub={period ? `${period.name} · ${FUNDS[period.fund].label}` : 'Không thuộc đợt thu nào'}
      footer={
        ready ? (
          <>
            {onCash && can.confirmTransfer(role) && (
              <Button variant="ghost" className="mr-auto" icon={<Wallet className="h-4 w-4" />}
                onClick={() => { onOpenChange(false); onCash(); }}>
                Nộp tiền mặt…
              </Button>
            )}
            <Button onClick={() => onOpenChange(false)}>Đóng</Button>
            {can.confirmTransfer(role) && (
              <Button variant="income" loading={saveIncome.isPending} onClick={() => void confirm()}>
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
                const done = printQrCards(settings, [{ student, period, amount }], period?.name ?? 'Chuyển khoản quỹ lớp');
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
  open, onOpenChange, period, rows,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  period: Period | null;
  rows: Array<{ student: Student; remaining: number }>;
}) {
  const { role } = useAuth();
  const toast = useToast();
  const { data: settings } = useSettings(role);
  const ready = bankReady(settings);
  const unpaid = rows.filter((r) => r.remaining > 0);

  const cards = useMemo(() => {
    if (!ready || !settings || !period) return [];
    return unpaid.map((r) => ({
      ...r,
      note: noteFor(settings, r.student, period),
      svg: qrSvg(buildVietQr({
        bin: settings.bank_bin, accountNo: settings.account_no,
        amount: r.remaining, description: noteFor(settings, r.student, period),
      }), 3),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, settings, period?.id, unpaid.length]);

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      wide
      title={`QR cả lớp — ${period?.name ?? ''}`}
      sub={`${unpaid.length}/${rows.length} sinh viên còn phải nộp · mỗi mã đã gắn sẵn số tiền và nội dung riêng`}
      footer={<Button onClick={() => onOpenChange(false)}>Đóng</Button>}
    >
      {!ready || !settings ? (
        <NeedBankSetup onClose={() => onOpenChange(false)} />
      ) : unpaid.length === 0 ? (
        <Note tone="ok"><span>Cả lớp đã nộp đủ đợt này, không cần tạo QR.</span></Note>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              icon={<Printer className="h-4 w-4" />}
              onClick={() => {
                const done = printQrCards(
                  settings,
                  unpaid.map((r) => ({ student: r.student, period, amount: r.remaining })),
                  period?.name ?? '',
                );
                if (!done) toast.err('Trình duyệt đã chặn cửa sổ in', 'Cho phép pop-up rồi thử lại.');
                else void logEvent('VIEW_QR', `Đã in ${unpaid.length} mã QR cho đợt ${period?.name ?? ''}`);
              }}
            >
              In tất cả
            </Button>
            <span className="text-[13px] text-ink3">
              Mẹo: in ra dán bảng, hoặc chụp từng ô gửi vào nhóm lớp — mỗi người quét mã của mình.
            </span>
          </div>
          <div className="grid max-h-[58vh] gap-3 overflow-auto p-0.5
            [grid-template-columns:repeat(auto-fill,minmax(158px,1fr))]">
            {cards.map((c) => (
              <figure key={c.student.id} className="m-0 rounded-[10px] border border-line bg-surface p-2 text-center">
                <div className="qr-svg rounded bg-white p-1"
                  // eslint-disable-next-line react/no-danger -- SVG do app tự sinh
                  dangerouslySetInnerHTML={{ __html: c.svg }}
                />
                <figcaption className="mt-1.5">
                  <div className="text-[13px] font-semibold leading-tight">{c.student.full_name}</div>
                  <div className="num text-xs text-ink3">{c.student.code} · <b>{fmtVnd(c.remaining)}</b></div>
                </figcaption>
              </figure>
            ))}
          </div>
          <p className="text-xs text-ink3">
            Tổng còn phải thu của đợt này: <b className="num text-ink2">
              {fmtVnd(unpaid.reduce((a, r) => a + toInt(r.remaining), 0))}
            </b>
          </p>
        </div>
      )}
    </Modal>
  );
}
