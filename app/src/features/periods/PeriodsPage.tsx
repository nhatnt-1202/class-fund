import { motion } from 'framer-motion';
import { Lock, LockOpen, Pencil, Plus, QrCode, Trash2, Users, Wallet } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useKlassContext } from '@/app/ClassProvider';
import { useToast } from '@/app/ToastProvider';
import {
  Badge, Button, Card, ConfirmModal, EmptyState, FundBadge, Modal, Money, Progress, TableSkeleton, TableWrap,
} from '@/components/ui';
import { useDebts, usePeriodProgress, usePeriods, useSavePeriod, useSoftDelete, useStudents } from '@/data/api';
import { fmtDate, fmtVnd, toInt } from '@/lib/format';
import { can } from '@/lib/permissions';
import { pageVariants } from '@/lib/motion';
import { FUNDS, type Period, type Student } from '@/types/db';
import BatchCollectDialog from '@/features/incomes/BatchCollectDialog';
import IncomeDialog from '@/features/incomes/IncomeDialog';
import { QrDialog, QrSheetDialog } from '@/features/qr/QrDialogs';
import PeriodDialog from './PeriodDialog';

export default function PeriodsPage() {
  const { role, classId, myStudentId, klass } = useKlassContext();
  const toast = useToast();
  const periods = usePeriods(classId);
  const progress = usePeriodProgress(classId);
  const students = useStudents(classId, role);
  const debts = useDebts(classId, role);
  const savePeriod = useSavePeriod(classId);
  const softDelete = useSoftDelete('periods', classId);

  const [dialog, setDialog] = useState<{ open: boolean; editing: Period | null }>({ open: false, editing: null });
  const [detail, setDetail] = useState<Period | null>(null);
  const [sheet, setSheet] = useState<Period | null>(null);
  const [batch, setBatch] = useState(false);
  const [confirmDel, setConfirmDel] = useState<Period | null>(null);
  const [qr, setQr] = useState<{ open: boolean; student: Student | null; periodId: string }>(
    { open: false, student: null, periodId: '' },
  );
  const [income, setIncome] = useState<{ open: boolean; studentId: string; periodId: string }>(
    { open: false, studentId: '', periodId: '' },
  );

  const paidMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of debts.data ?? []) m.set(`${d.student_id}|${d.period_id}`, d.paid);
    return m;
  }, [debts.data]);
  const paidOf = (s: string, p: string) => paidMap.get(`${s}|${p}`) ?? 0;
  // Khách chuyển khoản được, trừ khi lớp che tên sinh viên (xem can.showQrFor)
  const guestQr = Boolean(klass?.account_no) && !klass?.hide_student_names_from_guest;
  const remainingOf = (studentId: string, periodId: string) => {
    const p = (periods.data ?? []).find((x) => x.id === periodId);
    if (!p) return 0;
    return Math.max(toInt(p.amount_per_student) - paidOf(studentId, periodId), 0);
  };

  const rowsOf = (period: Period) =>
    (students.data ?? []).filter((s) => s.is_active).map((s) => {
      const paid = paidOf(s.id, period.id);
      const must = toInt(period.amount_per_student);
      return { student: s, paid, remaining: Math.max(must - paid, 0), must };
    });

  const toggleStatus = (p: Period) => {
    savePeriod.mutate(
      { id: p.id, values: { status: p.status === 'CLOSED' ? 'OPEN' : 'CLOSED' } },
      {
        onSuccess: () => toast.ok(p.status === 'CLOSED' ? 'Đã mở lại đợt thu' : 'Đã đóng đợt thu', p.name),
        onError: (e) => toast.err('Không đổi được trạng thái', e instanceof Error ? e.message : undefined),
      },
    );
  };

  if (periods.isLoading) {
    return <Card><TableSkeleton rows={4} cols={3} /></Card>;
  }

  const list = periods.data ?? [];

  return (
    <motion.div variants={pageVariants} initial="hidden" animate="show" className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="flex-1" />
        {can.writePeriod(role) && (
          <Button variant="primary" size="sm" icon={<Plus className="h-4 w-4" />}
            onClick={() => setDialog({ open: true, editing: null })}>
            Tạo đợt thu
          </Button>
        )}
      </div>

      {list.length === 0 ? (
        <Card>
          <EmptyState
            title="Chưa có đợt thu nào"
            hint="Một đợt thu = một lần cả lớp phải nộp một khoản, thuộc đúng một quỹ."
            action={can.writePeriod(role)
              ? <Button variant="primary" size="sm" onClick={() => setDialog({ open: true, editing: null })}>Tạo đợt thu</Button>
              : undefined}
          />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {list.map((p) => {
            const st = progress.data?.find((x) => x.period_id === p.id);
            const pct = st && st.expected ? st.collected / st.expected : 0;
            const deletable = st?.collected === 0;
            return (
              <Card key={p.id} className="p-4">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-[1.05rem] font-semibold">{p.name}</h3>
                      <FundBadge fund={p.fund} />
                      {p.status === 'CLOSED' ? <Badge>Đã đóng</Badge> : <Badge tone="ok">Đang mở</Badge>}
                    </div>
                    <div className="text-[13px] text-ink3">
                      {fmtVnd(p.amount_per_student)}/SV · mở {fmtDate(p.open_date)}
                      {p.due_date ? ` · hạn ${fmtDate(p.due_date)}` : ''}
                    </div>
                  </div>
                  {can.writePeriod(role) && (
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" aria-label="Sửa đợt thu"
                        onClick={() => setDialog({ open: true, editing: p })}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button size="sm" variant="ghost"
                        aria-label={p.status === 'CLOSED' ? 'Mở lại đợt thu' : 'Đóng đợt thu'}
                        onClick={() => toggleStatus(p)}>
                        {p.status === 'CLOSED' ? <LockOpen className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
                      </Button>
                      {deletable && (
                        <Button size="sm" variant="ghost" aria-label="Xoá đợt thu" onClick={() => setConfirmDel(p)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  )}
                </div>

                <div className="mb-1.5 mt-3 flex items-baseline gap-2 text-sm">
                  <b className="num">{fmtVnd(st?.collected ?? 0)}</b>
                  <span className="text-ink3">/ {fmtVnd(st?.expected ?? 0)}</span>
                  <span className="ml-auto text-ink3">{Math.round(pct * 100)}%</span>
                </div>
                <Progress value={pct} fund={p.fund} />
                <div className="mt-3 flex flex-wrap gap-2 text-[13px]">
                  <Badge tone="ok">{st?.paid_count ?? 0} đã đóng</Badge>
                  <Badge tone="warn">{st?.partial_count ?? 0} thiếu</Badge>
                  <Badge>{st?.unpaid_count ?? 0} chưa</Badge>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" icon={<Users className="h-4 w-4" />} onClick={() => setDetail(p)}>Xem chi tiết</Button>
                  {can.confirmTransfer(role) && (
                    <Button size="sm" variant="primary" icon={<QrCode className="h-4 w-4" />} onClick={() => setSheet(p)}>
                      QR cả lớp
                    </Button>
                  )}
                  {can.writeIncome(role) && (
                    <Button size="sm" variant="ghost" icon={<Wallet className="h-4 w-4" />} onClick={() => setBatch(true)}>
                      Thu tay theo lô
                    </Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Chi tiết đợt thu: chia nhóm chưa đóng / đóng thiếu / đã đủ */}
      <Modal
        open={Boolean(detail)}
        onOpenChange={(v) => !v && setDetail(null)}
        wide
        title={detail?.name ?? ''}
        sub={detail
          ? `${FUNDS[detail.fund].label} · ${fmtVnd(detail.amount_per_student)}/SV · thu được ${fmtVnd(progress.data?.find((x) => x.period_id === detail.id)?.collected ?? 0)}`
          : ''}
        footer={<Button onClick={() => setDetail(null)}>Đóng</Button>}
      >
        {detail && (
          <div className="space-y-4">
            {([
              ['Chưa đóng', (r: { paid: number; remaining: number }) => r.paid === 0 && r.remaining > 0],
              ['Đóng thiếu', (r: { paid: number; remaining: number }) => r.paid > 0 && r.remaining > 0],
              ['Đã đóng đủ', (r: { remaining: number }) => r.remaining === 0],
            ] as const).map(([label, pick]) => {
              const group = rowsOf(detail).filter(pick);
              if (group.length === 0) return null;
              return (
                <section key={label}>
                  <h3 className="mb-1 text-sm font-semibold">
                    {label} <Badge tone={label === 'Đã đóng đủ' ? 'ok' : label === 'Đóng thiếu' ? 'warn' : 'neutral'}>{group.length}</Badge>
                  </h3>
                  <TableWrap className="rounded-[10px] border border-line">
                    <table>
                      <caption className="sr-only">{label}</caption>
                      <tbody>
                        {group.map((r) => (
                          <tr key={r.student.id}>
                            <td className="num text-xs text-ink3">{r.student.code}</td>
                            <td>{r.student.full_name}</td>
                            {/* Một cột tiền duy nhất: còn thiếu thì −, đã đủ thì +.
                                Riêng nhóm đóng thiếu ghi thêm phần đã đóng cho khỏi mất dấu. */}
                            <td className="text-right">
                              {r.remaining > 0
                                ? <Money value={r.remaining} kind="out" />
                                : <Money value={r.paid} kind="in" />}
                              {r.paid > 0 && r.remaining > 0 && (
                                <div className="num text-xs text-ink3">đã đóng {fmtVnd(r.paid)}</div>
                              )}
                            </td>
                            <td className="text-right">
                              <div className="flex justify-end gap-1">
                                {can.showQrFor(role, myStudentId, r.student.id, guestQr) && r.remaining > 0 && (
                                  <Button size="sm" variant="primary"
                                    onClick={() => { setDetail(null); setQr({ open: true, student: r.student, periodId: detail.id }); }}>
                                    QR
                                  </Button>
                                )}
                                {can.writeIncome(role) && r.remaining > 0 && (
                                  <Button size="sm"
                                    onClick={() => { setDetail(null); setIncome({ open: true, studentId: r.student.id, periodId: detail.id }); }}>
                                    Thu tay
                                  </Button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </TableWrap>
                </section>
              );
            })}
          </div>
        )}
      </Modal>

      <PeriodDialog
        open={dialog.open}
        onOpenChange={(v) => setDialog((s) => ({ ...s, open: v }))}
        editing={dialog.editing}
        activeStudents={(students.data ?? []).filter((s) => s.is_active).length}
      />

      <ConfirmModal
        open={Boolean(confirmDel)}
        onOpenChange={(v) => !v && setConfirmDel(null)}
        title="Xoá đợt thu?"
        danger
        okLabel="Xoá"
        loading={softDelete.isPending}
        message={
          <>
            Xoá đợt thu <b>{confirmDel?.name}</b> — chưa có ai đóng nên xoá không ảnh hưởng công nợ.
          </>
        }
        onConfirm={() => {
          const row = confirmDel;
          if (!row) return;
          softDelete.mutate({ id: row.id }, {
            onSuccess: () => {
              toast.toast('warn', 'Đã xoá đợt thu', row.name, {
                label: 'Hoàn tác',
                run: () => softDelete.mutate({ id: row.id, restore: true }, {
                  onSuccess: () => toast.ok('Đã hoàn tác'),
                  onError: (e) => toast.err('Không hoàn tác được', e instanceof Error ? e.message : undefined),
                }),
              });
              setConfirmDel(null);
            },
            onError: (e) => {
              toast.err('Không xoá được', e instanceof Error ? e.message : undefined);
              setConfirmDel(null);
            },
          });
        }}
      />

      <QrSheetDialog
        open={Boolean(sheet)}
        onOpenChange={(v) => !v && setSheet(null)}
        period={sheet}
        periods={list}
        students={(students.data ?? []).filter((s) => s.is_active)}
        remainingOf={remainingOf}
      />

      <QrDialog
        open={qr.open}
        onOpenChange={(v) => setQr((s) => ({ ...s, open: v }))}
        student={qr.student}
        periods={list}
        remainingOf={remainingOf}
        initialPeriodId={qr.periodId}
        onCash={(periodId) => setIncome({ open: true, studentId: qr.student?.id ?? '', periodId })}
      />

      <IncomeDialog
        open={income.open}
        onOpenChange={(v) => setIncome((s) => ({ ...s, open: v }))}
        students={(students.data ?? []).filter((s) => s.is_active)}
        periods={list}
        paidOf={paidOf}
        presetStudentId={income.studentId}
        presetPeriodId={income.periodId}
      />

      <BatchCollectDialog
        open={batch}
        onOpenChange={setBatch}
        students={(students.data ?? []).filter((s) => s.is_active)}
        periods={list}
        paidOf={paidOf}
      />
    </motion.div>
  );
}
