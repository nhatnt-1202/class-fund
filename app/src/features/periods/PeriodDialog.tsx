import { useEffect, useState } from 'react';
import { useToast } from '@/app/ToastProvider';
import { Button, Field, Input, Modal, MoneyInput, Select } from '@/components/ui';
import { useSavePeriod } from '@/data/api';
import { fmtVnd } from '@/lib/format';
import { FUNDS, FUND_KEYS, type Fund, type Period, type PeriodStatus } from '@/types/db';

export default function PeriodDialog({
  open, onOpenChange, editing, activeStudents,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing?: Period | null;
  activeStudents: number;
}) {
  const toast = useToast();
  const save = useSavePeriod();
  const [name, setName] = useState('');
  const [fund, setFund] = useState<Fund>('QUY_LOP');
  const [amount, setAmount] = useState(0);
  const [openDate, setOpenDate] = useState(new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState('');
  const [status, setStatus] = useState<PeriodStatus>('OPEN');
  const [note, setNote] = useState('');
  const [err, setErr] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setErr({});
    setName(editing?.name ?? '');
    setFund(editing?.fund ?? 'QUY_LOP');
    setAmount(editing?.amount_per_student ?? 0);
    setOpenDate(editing?.open_date ?? new Date().toISOString().slice(0, 10));
    setDueDate(editing?.due_date ?? '');
    setStatus(editing?.status ?? 'OPEN');
    setNote(editing?.note ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing?.id]);

  const submit = async () => {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = 'Nhập tên đợt thu';
    if (amount <= 0) e.amount = 'Mức thu phải lớn hơn 0';
    if (dueDate && dueDate < openDate) e.due = 'Hạn nộp phải sau ngày mở';
    setErr(e);
    if (Object.keys(e).length > 0) return;
    try {
      await save.mutateAsync({
        id: editing?.id,
        values: {
          name: name.trim(),
          fund,
          amount_per_student: amount,
          open_date: openDate,
          due_date: dueDate || null,
          status,
          note: note.trim(),
        },
      });
      toast.ok(editing ? 'Đã lưu đợt thu' : 'Đã tạo đợt thu', `${name.trim()} · ${FUNDS[fund].label}`);
      onOpenChange(false);
    } catch (ex) {
      toast.err('Không lưu được đợt thu', ex instanceof Error ? ex.message : undefined);
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? 'Sửa đợt thu' : 'Tạo đợt thu'}
      sub="Một đợt thu thuộc đúng một quỹ và có một mức thu cho mỗi sinh viên."
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Huỷ</Button>
          <Button variant="primary" loading={save.isPending} onClick={() => void submit()}>
            {editing ? 'Lưu' : 'Tạo đợt thu'}
          </Button>
        </>
      }
    >
      <Field label="Thu vào quỹ nào?" required>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Chọn quỹ">
          {FUND_KEYS.map((f) => {
            const on = fund === f;
            const tone = f === 'QUY_LOP' ? 'border-lop bg-lopSoft text-lopInk' : 'border-doan bg-doanSoft text-doanInk';
            return (
              <button
                key={f}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setFund(f)}
                className={`flex min-h-[48px] flex-1 basis-[130px] items-center justify-center gap-2 rounded-[10px]
                  border-2 px-3 font-semibold transition-all duration-200 ease-out hover:-translate-y-px
                  ${on ? tone : 'border-line bg-surface text-ink2'}`}
              >
                <span className={`h-2 w-2 rounded-full ${f === 'QUY_LOP' ? 'bg-lop' : 'bg-doan'}`} aria-hidden />
                {FUNDS[f].label}
              </button>
            );
          })}
        </div>
      </Field>

      <div className={`rounded-[10px] border border-line border-l-4 p-3
        ${fund === 'QUY_LOP' ? 'border-l-lop' : 'border-l-doan'}`}>
        <Field label="Tên đợt thu" required error={err.name}>
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus
            placeholder="VD: Quỹ lớp học kỳ I 2026-2027" />
        </Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Mức thu / SV (₫)" required error={err.amount}>
            <MoneyInput value={amount} onChange={setAmount} />
          </Field>
          <Field label="Ngày mở">
            <Input type="date" value={openDate} onChange={(e) => setOpenDate(e.target.value)} />
          </Field>
          <Field label="Hạn nộp" error={err.due}>
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Ghi chú">
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          {editing && (
            <Field label="Trạng thái">
              <Select value={status} onChange={(e) => setStatus(e.target.value as PeriodStatus)}>
                <option value="OPEN">Đang mở</option>
                <option value="CLOSED">Đã đóng</option>
              </Select>
            </Field>
          )}
        </div>
        <p className="text-xs text-ink3">
          Dự kiến thu: <b>{activeStudents}</b> SV × <b>{fmtVnd(amount)}</b> ={' '}
          <b className="num">{fmtVnd(activeStudents * amount)}</b>
        </p>
      </div>
    </Modal>
  );
}
