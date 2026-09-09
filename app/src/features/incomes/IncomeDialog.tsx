import { QrCode, Users, Wallet } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/app/AuthProvider';
import { useKlassContext } from '@/app/ClassProvider';
import { useToast } from '@/app/ToastProvider';
import { Badge, Button, Field, Input, Modal, Note, Select } from '@/components/ui';
import {
  AmountField, FundPicker, PersonField, Section, StudentPicker, SummaryBar,
} from '@/components/form';
import { useSaveIncome, type IncomeRow } from '@/data/api';
import { fmtVnd, toInt } from '@/lib/format';
import { can } from '@/lib/permissions';
import { FUNDS, METHOD_LABEL, type Fund, type PayMethod, type Period, type Student } from '@/types/db';

export default function IncomeDialog({
  open, onOpenChange, editing, students, periods, paidOf, presetStudentId, presetPeriodId,
  onShowQr, collectors = [],
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
  /** Những người đã từng đứng tên thu, để gợi ý trong ô "người thu". */
  collectors?: string[];
}) {
  const { profile } = useAuth();
  const { role, classId, klass } = useKlassContext();
  const toast = useToast();
  const save = useSaveIncome(classId);


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

  const openPeriods = useMemo(() => periods.filter((p) => p.status !== 'CLOSED'), [periods]);

  useEffect(() => {
    if (!open) return;
    setErr({});
    if (editing) {
      setPeriodId(editing.period_id ?? '');
      setFund(editing.fund);
      setPayerMode(editing.student_id ? 'student' : 'other');
      setStudentId(editing.student_id ?? '');
      setPayerName(editing.student_id ? '' : (editing.payer_name ?? ''));
      setDate(editing.date);
      setAmount(toInt(editing.amount));
      setMethod(editing.method);
      setCollectedBy(editing.collected_by ?? '');
      setNote(editing.note ?? '');
      return;
    }
    const p = presetPeriodId ? periods.find((x) => x.id === presetPeriodId) : (openPeriods[0] ?? periods[0]);
    setPeriodId(p?.id ?? '');
    setFund(p?.fund ?? 'QUY_LOP');
    setPayerMode('student');
    setStudentId(presetStudentId ?? '');
    setPayerName('');
    setDate(new Date().toISOString().slice(0, 10));
    setMethod('CASH');
    setCollectedBy(profile?.full_name || '');
    setNote('');
    const remaining = presetStudentId && p
      ? Math.max(toInt(p.amount_per_student) - paidOf(presetStudentId, p.id), 0)
      : 0;
    setAmount(remaining || toInt(p?.amount_per_student ?? 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing?.id, presetStudentId, presetPeriodId]);

  const period = periods.find((p) => p.id === periodId) ?? null;
  const student = students.find((s) => s.id === studentId) ?? null;

  const statusOf = (id: string) => {
    if (!period) return null;
    const must = toInt(period.amount_per_student);
    const paid = paidOf(id, period.id);
    return { paid, must, remaining: Math.max(must - paid, 0) };
  };

  const changePeriod = (id: string) => {
    setPeriodId(id);
    const p = periods.find((x) => x.id === id);
    if (!p) return;
    setFund(p.fund);                              // quỹ luôn đi theo đợt thu, DB cũng chặn nếu lệch
    if (!editing) {
      const remaining = studentId ? Math.max(toInt(p.amount_per_student) - paidOf(studentId, p.id), 0) : 0;
      setAmount(remaining || toInt(p.amount_per_student));
    }
  };

  const pickStudent = (id: string) => {
    setStudentId(id);
    if (editing || !period) return;
    const remaining = Math.max(toInt(period.amount_per_student) - paidOf(id, period.id), 0);
    setAmount(remaining || toInt(period.amount_per_student));
  };

  /** Số đã nộp trước khoản này (khi sửa thì trừ chính nó ra để không đếm hai lần). */
  const paidBefore = student && period
    ? paidOf(student.id, period.id)
      - (editing && editing.student_id === student.id && editing.period_id === period.id ? toInt(editing.amount) : 0)
    : 0;
  const must = toInt(period?.amount_per_student ?? 0);
  const after = paidBefore + amount;
  const overpay = must > 0 && after > must ? after - must : 0;

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

  const collectorGroups = [
    ...(profile?.full_name ? [{ label: 'Tôi', names: [profile.full_name] }] : []),
    { label: 'Đã từng thu', names: collectors },
    { label: 'Sinh viên trong lớp', names: students.map((s) => s.full_name) },
  ];

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      wide
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
      {/*
        * Lưới 2×2 thay vì hai cột dựng dọc: xếp theo cột thì một bên luôn cao hơn hẳn
        * (danh sách sinh viên rất cao), làm hộp thoại vượt chiều cao màn hình.
        * Thứ tự khi màn hình hẹp: số tiền → ai nộp → đợt thu → chi tiết.
        */}
      <div className="grid items-start gap-3 lg:grid-cols-2">
        <Section title="Số tiền" accent={fund}>
            <Field label="Số tiền nộp" required error={err.amount}>
              <AmountField
                id="in-amount"
                value={amount}
                onChange={setAmount}
                autoFocus
                quick={period ? [
                  { label: 'Còn thiếu', value: Math.max(must - paidBefore, 0) },
                  { label: 'Cả đợt', value: must },
                  { label: 'Một nửa', value: Math.round(must / 2) },
                ] : []}
              />
            </Field>
            {student && period && (
              <SummaryBar items={[
                { label: 'Đã nộp trước đó', value: fmtVnd(paidBefore) },
                { label: 'Sau khoản này', value: `${fmtVnd(after)} / ${fmtVnd(must)}`,
                  tone: after >= must ? 'ok' : 'warn' },
                ...(overpay > 0 ? [{ label: 'Nộp thừa', value: fmtVnd(overpay), tone: 'warn' as const }] : []),
              ]} />
            )}
          </Section>
        <Section title="Ai nộp">
            <div className="mb-2 flex gap-2">
              {([['student', 'Sinh viên trong lớp', Users], ['other', 'Nguồn khác', Wallet]] as const).map(
                ([m, label, Icon]) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setPayerMode(m)}
                    className={`flex flex-1 items-center justify-center gap-1.5 rounded-[10px] border px-3 py-2
                      text-[13px] transition-colors ${payerMode === m
                        ? 'border-transparent bg-brand font-semibold text-white'
                        : 'border-lineStrong bg-surface hover:bg-surface2'}`}
                  >
                    <Icon className="h-4 w-4" aria-hidden /> {label}
                  </button>
                ),
              )}
            </div>
            {payerMode === 'student' ? (
              <Field label="Sinh viên" required group error={err.student}>
                <StudentPicker
                  students={students}
                  value={studentId}
                  onChange={pickStudent}
                  statusOf={statusOf}
                />
              </Field>
            ) : (
              <Field label="Người / đơn vị nộp" required error={err.payer}>
                <Input value={payerName} onChange={(e) => setPayerName(e.target.value)}
                  placeholder="VD: Hội phụ huynh, thầy chủ nhiệm…" />
              </Field>
            )}
          </Section>
        <Section title="Thuộc đợt thu nào">
            <Field
              label="Đợt thu"
              hint={period
                ? `${FUNDS[period.fund].label} · ${fmtVnd(period.amount_per_student)}/SV`
                : 'Không thuộc đợt nào — chọn quỹ thủ công bên dưới'}
            >
              <Select value={periodId} onChange={(e) => changePeriod(e.target.value)}>
                <option value="">— Thu ngoài đợt (tài trợ, nguồn khác) —</option>
                {periods.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {fmtVnd(p.amount_per_student)}/SV{p.status === 'CLOSED' ? ' · đã đóng' : ''}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Thu vào quỹ nào?" required group error={err.fund}>
              <FundPicker
                value={fund}
                onChange={setFund}
                disabled={Boolean(period)}
                disabledHint="Quỹ đi theo đợt thu đã chọn — muốn đổi quỹ thì chọn đợt khác hoặc “Thu ngoài đợt”."
              />
            </Field>
          </Section>
        <Section title="Chi tiết ghi nhận">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Ngày nộp" required error={err.date}>
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </Field>
              <Field label="Hình thức">
                <Select value={method} onChange={(e) => setMethod(e.target.value as PayMethod)}>
                  {Object.entries(METHOD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </Select>
              </Field>
            </div>
            <Field label="Người thu" group hint="Chọn từ danh sách hoặc bấm “Nhập tay” để gõ tên khác.">
              <PersonField
                id="in-collector"
                value={collectedBy}
                onChange={setCollectedBy}
                groups={collectorGroups}
                placeholder="Tên người thu tiền"
              />
            </Field>
            <Field label="Ghi chú">
              <Input value={note} onChange={(e) => setNote(e.target.value)}
                placeholder="VD: nộp bù đợt trước" />
            </Field>
          </Section>
        <div className="space-y-2 lg:col-span-2">
          {method === 'TRANSFER' && !editing && (
            <Note tone="info">
              <span>
                Chọn <b>Chuyển khoản</b> nghĩa là bạn đã thấy tiền về tài khoản
                {klass?.account_no ? ` ${klass.account_no}` : ''}. Nếu chưa, hãy dùng
                {' '}<b>Xem QR chuyển khoản</b> để gửi mã cho sinh viên trước.
              </span>
            </Note>
          )}
          {overpay > 0 && student && period && (
            <Note tone="warn">
              <span>
                Sau khoản này {student.full_name} nộp thừa <b>{fmtVnd(overpay)}</b> so với mức
                {' '}<b>{fmtVnd(must)}</b> của đợt. Vẫn lưu được nếu đây là nộp hộ người khác.
              </span>
            </Note>
          )}
          {!can.writeIncome(role) && (
            <Note tone="warn"><span>Bạn không có quyền ghi khoản thu — hãy nhờ thủ quỹ hoặc quản trị.</span></Note>
          )}
          {editing && (
            <p className="mt-2 text-xs text-ink3">
              Mọi thay đổi đều được ghi vào <Badge>Lịch sử thao tác</Badge> kèm giá trị trước và sau.
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
}
