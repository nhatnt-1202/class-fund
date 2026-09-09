import { useEffect, useMemo, useState } from 'react';
import { useToast } from '@/app/ToastProvider';
import { Button, Field, Input, Modal, Money, MoneyInput, Select, TableWrap } from '@/components/ui';
import { useKlassContext } from '@/app/ClassProvider';
import { useSaveIncomesBatch } from '@/data/api';
import { fmtVnd, toInt } from '@/lib/format';
import { FUNDS, type Period, type Student } from '@/types/db';

/** Thu theo lô: tick nhiều sinh viên, mỗi người vẫn tạo một bản ghi riêng để không mất dấu ai nộp bao nhiêu. */
export default function BatchCollectDialog({
  open, onOpenChange, students, periods, paidOf,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  students: Student[];
  periods: Period[];
  paidOf: (studentId: string, periodId: string) => number;
}) {
  const toast = useToast();
  const { classId } = useKlassContext();
  const save = useSaveIncomesBatch(classId);
  const [periodId, setPeriodId] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [collectedBy, setCollectedBy] = useState('Thủ quỹ');
  const [picked, setPicked] = useState<Record<string, number>>({});

  const period = periods.find((p) => p.id === periodId) ?? null;

  const rows = useMemo(() => students.map((s) => {
    const paid = period ? paidOf(s.id, period.id) : 0;
    const remaining = period ? Math.max(toInt(period.amount_per_student) - paid, 0) : 0;
    return { s, paid, remaining };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [students, period?.id, paidOf]);

  useEffect(() => {
    if (!open) return;
    const p = periods.find((x) => x.status !== 'CLOSED') ?? periods[0];
    setPeriodId(p?.id ?? '');
    setDate(new Date().toISOString().slice(0, 10));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Mặc định tick sẵn những người còn thiếu, số tiền = số còn thiếu
  useEffect(() => {
    const next: Record<string, number> = {};
    for (const r of rows) if (r.remaining > 0) next[r.s.id] = r.remaining;
    setPicked(next);
  }, [rows]);

  const chosen = Object.entries(picked).filter(([, v]) => v > 0);
  const sum = chosen.reduce((a, [, v]) => a + v, 0);

  const submit = async () => {
    if (!period || chosen.length === 0) return;
    try {
      await save.mutateAsync(chosen.map(([studentId, amount]) => ({
        date,
        fund: period.fund,
        period_id: period.id,
        student_id: studentId,
        payer_name: students.find((s) => s.id === studentId)?.full_name ?? '',
        amount,
        method: 'CASH' as const,
        collected_by: collectedBy.trim(),
        note: 'Thu theo lô',
      })));
      toast.ok(`Đã ghi nhận ${chosen.length} khoản thu`, `${FUNDS[period.fund].label} · tổng ${fmtVnd(sum)}`);
      onOpenChange(false);
    } catch (e) {
      toast.err('Không ghi được', e instanceof Error ? e.message : undefined);
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      wide
      title="Thu theo lô"
      sub="Tick những sinh viên đã nộp — mỗi người sẽ tạo một bản ghi thu riêng."
      footer={
        <>
          <span className="mr-auto text-sm text-ink3">
            Đã chọn <b className="text-ink">{chosen.length}</b> SV · tổng <b className="num text-ink">{fmtVnd(sum)}</b>
          </span>
          <Button onClick={() => onOpenChange(false)}>Huỷ</Button>
          <Button variant="income" loading={save.isPending} disabled={chosen.length === 0} onClick={() => void submit()}>
            Ghi nhận
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Đợt thu">
          <Select value={periodId} onChange={(e) => setPeriodId(e.target.value)}>
            {periods.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} — {FUNDS[p.fund].label} ({fmtVnd(p.amount_per_student)}/SV)
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Ngày nộp">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Người thu">
          <Input value={collectedBy} onChange={(e) => setCollectedBy(e.target.value)} />
        </Field>
      </div>

      <div className="mb-2 flex flex-wrap gap-2">
        <Button size="sm" onClick={() => {
          const next: Record<string, number> = {};
          for (const r of rows) if (r.remaining > 0) next[r.s.id] = r.remaining;
          setPicked(next);
        }}>
          Chọn tất cả người còn thiếu
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setPicked({})}>Bỏ chọn hết</Button>
      </div>

      <div className="max-h-[46vh] overflow-y-auto rounded-[10px] border border-line">
        <TableWrap>
          <table>
            <caption className="sr-only">Chọn sinh viên để ghi nhận thu theo lô</caption>
            <thead>
              <tr>
                <th className="w-9" />
                <th>Sinh viên</th>
                <th className="text-right">Đã nộp</th>
                <th className="text-right">Còn thiếu</th>
                <th className="w-[140px] text-right">Ghi nhận (₫)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const on = (picked[r.s.id] ?? 0) > 0;
                return (
                  <tr key={r.s.id}>
                    <td>
                      <input
                        type="checkbox"
                        className="h-[18px] w-[18px] min-h-0 accent-[rgb(var(--c-brand))]"
                        aria-label={`Chọn ${r.s.full_name}`}
                        checked={on}
                        disabled={r.remaining === 0 && !on}
                        onChange={(e) => setPicked((p) => {
                          const next = { ...p };
                          if (e.target.checked) next[r.s.id] = r.remaining || toInt(period?.amount_per_student ?? 0);
                          else delete next[r.s.id];
                          return next;
                        })}
                      />
                    </td>
                    <td>
                      <div>{r.s.full_name}</div>
                      <div className="num text-xs text-ink3">{r.s.code}</div>
                    </td>
                    <td className="num text-right text-income">{r.paid ? fmtVnd(r.paid) : '—'}</td>
                    <td className="text-right">
                      <Money value={r.remaining} kind={r.remaining ? 'out' : undefined} />
                    </td>
                    <td>
                      <MoneyInput
                        value={picked[r.s.id] ?? 0}
                        onChange={(v) => setPicked((p) => ({ ...p, [r.s.id]: v }))}
                        aria-label={`Số tiền của ${r.s.full_name}`}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableWrap>
      </div>
    </Modal>
  );
}
