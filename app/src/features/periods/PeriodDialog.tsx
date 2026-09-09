import { useEffect, useState } from 'react';
import { useToast } from '@/app/ToastProvider';
import { Button, Field, Input, Modal, Select } from '@/components/ui';
import { AmountField, FundPicker, Section, SummaryBar } from '@/components/form';
import { useSavePeriod } from '@/data/api';
import { fmtVnd } from '@/lib/format';
import { FUNDS, type Fund, type Period, type PeriodStatus } from '@/types/db';

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
      <Field label="Thu vào quỹ nào?" required group>
        <FundPicker value={fund} onChange={setFund} />
      </Field>

      <Section title="Chi tiết đợt thu" accent={fund}>
        <Field label="Tên đợt thu" required error={err.name}>
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus
            placeholder="VD: Quỹ lớp học kỳ I 2026-2027" />
        </Field>
        <div className="grid gap-3">
          <Field label="Mức thu mỗi SV" required error={err.amount}>
            <AmountField
              id="p-amount"
              value={amount}
              onChange={setAmount}
              quick={[
                { label: 'Quỹ lớp', value: 50000 },
                { label: 'Quỹ đoàn', value: 20000 },
                { label: '100.000', value: 100000 },
              ]}
            />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Ngày mở">
            <Input type="date" value={openDate} onChange={(e) => setOpenDate(e.target.value)} />
          </Field>
          <Field label="Hạn nộp" error={err.due}>
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </Field>
        </div>
        <div className={`grid gap-3 ${editing ? 'sm:grid-cols-2' : ''}`}>
          <Field label="Ghi chú">
            <Input value={note} onChange={(e) => setNote(e.target.value)}
              placeholder="VD: thu để mua quà 20/11" />
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
        <SummaryBar items={[
          { label: 'Số sinh viên', value: String(activeStudents) },
          { label: 'Mức thu mỗi người', value: fmtVnd(amount) },
          { label: 'Dự kiến thu cả đợt', value: fmtVnd(activeStudents * amount), tone: 'ok' },
        ]} />
      </Section>
    </Modal>
  );
}
