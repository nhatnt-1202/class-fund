import { QrCode } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/app/AuthProvider';
import { useToast } from '@/app/ToastProvider';
import { Button, Field, Input, Modal, MoneyInput, Note, Select } from '@/components/ui';
import { useSaveIncome, type IncomeRow } from '@/data/api';
import { fmtVnd, noAccent, toInt } from '@/lib/format';
import { can } from '@/lib/permissions';
import { FUNDS, FUND_KEYS, METHOD_LABEL, type Fund, type PayMethod, type Period, type Student } from '@/types/db';

/** Chọn quỹ dạng nút lớn — quỹ là thông tin dễ nhầm nhất nên phải nổi bật, không ẩn trong dropdown. */
function FundPicker({ value, onChange, disabled }: { value: Fund; onChange: (f: Fund) => void; disabled?: boolean }) {
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Chọn quỹ">
      {FUND_KEYS.map((f) => {
        const on = value === f;
        const tone = f === 'QUY_LOP'
          ? 'border-lop bg-lopSoft text-lopInk'
          : 'border-doan bg-doanSoft text-doanInk';
        return (
          <button
            key={f}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            onClick={() => onChange(f)}
            className={`flex min-h-[48px] flex-1 basis-[130px] items-center justify-center gap-2 rounded-[10px]
              border-2 px-3 font-semibold transition-all duration-200 ease-out hover:-translate-y-px
              disabled:opacity-60 ${on ? tone : 'border-line bg-surface text-ink2'}`}
          >
            <span className={`h-2 w-2 rounded-full ${f === 'QUY_LOP' ? 'bg-lop' : 'bg-doan'}`} aria-hidden />
            {FUNDS[f].label}
          </button>
        );
      })}
    </div>
  );
}

export default function IncomeDialog({
  open, onOpenChange, editing, students, periods, paidOf, presetStudentId, presetPeriodId, onShowQr,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing?: IncomeRow | null;
  students: Student[];
  periods: Period[];
  paidOf: (studentId: string, periodId: string) => number;
  presetStudentId?: string;
  presetPeriodId?: string;
  onShowQr?: (studentId: string, periodId: string, amount: number) => void;
}) {
  const { role } = useAuth();
  const toast = useToast();
  const save = useSaveIncome();

  const openPeriods = periods.filter((p) => p.status !== 'CLOSED');
  const [periodId, setPeriodId] = useState('');
  const [fund, setFund] = useState<Fund>('QUY_LOP');
  const [payerMode, setPayerMode] = useState<'student' | 'other'>('student');
  const [studentId, setStudentId] = useState('');
  const [payerName, setPayerName] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState(0);
  const [method, setMethod] = useState<PayMethod>('CASH');
  const [collectedBy, setCollectedBy] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState<Record<string, string>>({});
  const [query, setQuery] = useState('');

  // Nạp lại giá trị mỗi lần mở hộp thoại
  useEffect(() => {
    if (!open) return;
    setErr({});
    if (editing) {
      setPeriodId(editing.period_id ?? '');
      setFund(editing.fund);
      setPayerMode(editing.student_id ? 'student' : 'other');
      setStudentId(editing.student_id ?? '');
      setPayerName(editing.payer_name ?? '');
      setDate(editing.date);
      setAmount(toInt(editing.amount));
      setMethod(editing.method);
      setCollectedBy(editing.collected_by ?? '');
      setNote(editing.note ?? '');
      setQuery('');
      return;
    }
    const p = presetPeriodId
      ? periods.find((x) => x.id === presetPeriodId)
      : openPeriods[0] ?? periods[0];
    setPeriodId(p?.id ?? '');
    setFund(p?.fund ?? 'QUY_LOP');
    setPayerMode('student');
    setStudentId(presetStudentId ?? '');
    setPayerName('');
    setDate(new Date().toISOString().slice(0, 10));
    setMethod('CASH');
    setCollectedBy('');
    setNote('');
    setQuery('');
    const remaining = presetStudentId && p
      ? Math.max(toInt(p.amount_per_student) - paidOf(presetStudentId, p.id), 0)
      : 0;
    setAmount(remaining || toInt(p?.amount_per_student ?? 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing?.id, presetStudentId, presetPeriodId]);

  const period = periods.find((p) => p.id === periodId) ?? null;
  const student = students.find((s) => s.id === studentId) ?? null;

  // Đổi đợt thu ⇒ quỹ đi theo đợt (DB cũng chặn nếu lệch, đây chỉ là để đỡ sai từ đầu)
  const changePeriod = (id: string) => {
    setPeriodId(id);
    const p = periods.find((x) => x.id === id);
    if (p) {
      setFund(p.fund);
      if (!editing) {
        const remaining = studentId ? Math.max(toInt(p.amount_per_student) - paidOf(studentId, p.id), 0) : 0;
        setAmount(remaining || toInt(p.amount_per_student));
      }
    }
  };

  const filtered = useMemo(() => {
    const q = noAccent(query);
    if (!q) return students.slice(0, 40);
    return students
      .filter((s) => noAccent(s.full_name).includes(q) || s.code.includes(query.trim()))
      .slice(0, 40);
  }, [query, students]);

  const overpay = useMemo(() => {
    if (!student || !period) return 0;
    const already = paidOf(student.id, period.id) - (editing && editing.student_id === student.id && editing.period_id === period.id ? toInt(editing.amount) : 0);
    const after = already + amount;
    return after > toInt(period.amount_per_student) ? after - toInt(period.amount_per_student) : 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [student?.id, period?.id, amount, editing?.id]);

  const submit = async () => {
    const e: Record<string, string> = {};
    if (!date) e.date = 'Chọn ngày nộp';
    if (amount <= 0) e.amount = 'Số tiền phải lớn hơn 0';
    if (payerMode === 'student' && !studentId) e.student = 'Chọn một sinh viên trong danh sách';
    if (payerMode === 'other' && !payerName.trim()) e.payer = 'Nhập tên người/đơn vị nộp';
    if (period && period.fund !== fund) {
      e.fund = `Đợt “${period.name}” thuộc ${FUNDS[period.fund].label}, không ghi vào ${FUNDS[fund].label} được`;
    }
    setErr(e);
    if (Object.keys(e).length > 0) return;

    try {
      await save.mutateAsync({
        id: editing?.id,
        values: {
          date,
          fund,
          period_id: periodId || null,
          student_id: payerMode === 'student' ? studentId : null,
          payer_name: payerMode === 'student' ? (student?.full_name ?? '') : payerName.trim(),
          amount,
          method,
          collected_by: collectedBy.trim(),
          note: note.trim(),
        },
      });
      toast.ok(editing ? 'Đã lưu thay đổi' : `Đã ghi nhận thu ${fmtVnd(amount)}`,
        `${FUNDS[fund].label} · ${payerMode === 'student' ? student?.full_name : payerName}`);
      onOpenChange(false);
    } catch (ex) {
      toast.err('Không lưu được khoản thu', ex instanceof Error ? ex.message : undefined);
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? 'Sửa khoản thu' : 'Thêm khoản thu'}
      sub="Mỗi khoản thu bắt buộc thuộc đúng một quỹ."
      footer={
        <>
          {!editing && onShowQr && studentId && (
            <Button
              variant="ghost"
              className="mr-auto"
              icon={<QrCode className="h-4 w-4" />}
              onClick={() => { onOpenChange(false); onShowQr(studentId, periodId, amount); }}
            >
              Xem QR chuyển khoản
            </Button>
          )}
          <Button onClick={() => onOpenChange(false)}>Huỷ</Button>
          <Button variant="income" loading={save.isPending} onClick={() => void submit()}>
            {editing ? 'Lưu thay đổi' : 'Ghi nhận thu'}
          </Button>
        </>
      }
    >
      <Field label="Thu vào quỹ nào?" required error={err.fund}>
        <FundPicker value={fund} onChange={setFund} disabled={Boolean(period)} />
      </Field>

      <div className={`rounded-[10px] border border-line border-l-4 p-3 transition-colors duration-200
        ${fund === 'QUY_LOP' ? 'border-l-lop' : 'border-l-doan'}`}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Ngày nộp" required error={err.date}>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field
            label="Đợt thu"
            hint={period
              ? `Đợt này thuộc ${FUNDS[period.fund].label} · ${fmtVnd(period.amount_per_student)}/SV`
              : 'Không thuộc đợt nào — chọn quỹ thủ công bên trên'}
          >
            <Select value={periodId} onChange={(e) => changePeriod(e.target.value)}>
              <option value="">— Thu ngoài đợt (tài trợ, nguồn khác) —</option>
              {periods.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({fmtVnd(p.amount_per_student)}/SV){p.status === 'CLOSED' ? ' · đã đóng' : ''}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="Người nộp" required error={err.student ?? err.payer}>
          <div className="mb-2 flex gap-2">
            {(['student', 'other'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setPayerMode(m)}
                className={`rounded-full border px-3 py-1 text-[13px] ${
                  payerMode === m ? 'border-transparent bg-brand font-semibold text-white' : 'border-lineStrong bg-surface'
                }`}
              >
                {m === 'student' ? 'Sinh viên trong lớp' : 'Nguồn khác'}
              </button>
            ))}
          </div>
          {payerMode === 'student' ? (
            <>
              <Input
                type="search"
                placeholder="Tìm theo tên hoặc mã SV (bỏ dấu vẫn tìm được)…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Tìm sinh viên"
              />
              <Select
                className="mt-2"
                value={studentId}
                size={Math.min(Math.max(filtered.length, 3), 6)}
                onChange={(e) => {
                  setStudentId(e.target.value);
                  const p = period;
                  if (p && !editing) {
                    const remaining = Math.max(toInt(p.amount_per_student) - paidOf(e.target.value, p.id), 0);
                    setAmount(remaining || toInt(p.amount_per_student));
                  }
                }}
                aria-label="Chọn sinh viên"
              >
                {filtered.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.full_name} — {s.code}
                    {period ? ` · đã nộp ${fmtVnd(paidOf(s.id, period.id))}` : ''}
                  </option>
                ))}
              </Select>
            </>
          ) : (
            <Input
              placeholder="Tên người/đơn vị nộp"
              value={payerName}
              onChange={(e) => setPayerName(e.target.value)}
            />
          )}
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Số tiền (₫)" required error={err.amount}>
            <MoneyInput value={amount} onChange={setAmount} autoFocus />
          </Field>
          <Field label="Hình thức">
            <Select value={method} onChange={(e) => setMethod(e.target.value as PayMethod)}>
              {Object.entries(METHOD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Người thu">
            <Input value={collectedBy} onChange={(e) => setCollectedBy(e.target.value)} placeholder="Thủ quỹ" />
          </Field>
          <Field label="Ghi chú">
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>

        {overpay > 0 && period && student && (
          <Note tone="warn">
            <span>
              Sau khoản này, {student.full_name} sẽ nộp thừa <b>{fmtVnd(overpay)}</b> so với mức
              {' '}<b>{fmtVnd(period.amount_per_student)}</b> của đợt. Vẫn lưu được nếu đây là nộp hộ người khác.
            </span>
          </Note>
        )}
        {!can.writeIncome(role) && (
          <Note tone="warn"><span>Bạn không có quyền ghi khoản thu — hãy nhờ thủ quỹ hoặc quản trị.</span></Note>
        )}
      </div>
    </Modal>
  );
}
