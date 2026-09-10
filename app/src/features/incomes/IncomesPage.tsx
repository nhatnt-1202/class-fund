import { motion } from 'framer-motion';
import { Layers, Pencil, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useKlassContext } from '@/app/ClassProvider';
import { useToast } from '@/app/ToastProvider';
import {
  Badge, Button, Card, ConfirmModal, DateBox, EmptyState, FundBadge, Money, Select, TableSkeleton, TableWrap,
} from '@/components/ui';
import { useDebts, useIncomes, usePeriods, useSoftDelete, useStudents, type IncomeRow } from '@/data/api';
import { fmtDate, fmtVnd, toInt } from '@/lib/format';
import { can } from '@/lib/permissions';
import { pageVariants, rowStagger } from '@/lib/motion';
import { FUNDS, FUND_KEYS, METHOD_LABEL, type Fund } from '@/types/db';
import BatchCollectDialog from './BatchCollectDialog';
import IncomeDialog from './IncomeDialog';

export default function IncomesPage() {
  const { role, classId } = useKlassContext();
  const toast = useToast();
  const incomes = useIncomes(classId, role);
  const students = useStudents(classId, role);
  const periods = usePeriods(classId);
  const debts = useDebts(classId, role);
  const softDelete = useSoftDelete('incomes', classId);

  const [fund, setFund] = useState<Fund | ''>('');
  const [periodId, setPeriodId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [dialog, setDialog] = useState<{ open: boolean; editing: IncomeRow | null }>({ open: false, editing: null });
  const [batch, setBatch] = useState(false);
  const [confirmDel, setConfirmDel] = useState<IncomeRow | null>(null);

  const paidMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of debts.data ?? []) m.set(`${d.student_id}|${d.period_id}`, d.paid);
    return m;
  }, [debts.data]);
  const paidOf = (s: string, p: string) => paidMap.get(`${s}|${p}`) ?? 0;

  const collectors = useMemo(
    () => [...new Set((incomes.data ?? []).map((r) => r.collected_by).filter(Boolean))],
    [incomes.data],
  );

  const rows = useMemo(() => (incomes.data ?? []).filter((r) =>
    (!fund || r.fund === fund)
    && (!periodId || (periodId === '__none' ? !r.period_id : r.period_id === periodId))
    && (!from || r.date >= from)
    && (!to || r.date <= to)), [incomes.data, fund, periodId, from, to]);

  const byFund = FUND_KEYS.map((f) => ({
    fund: f,
    total: rows.filter((r) => r.fund === f).reduce((a, r) => a + toInt(r.amount), 0),
  }));
  const total = rows.reduce((a, r) => a + toInt(r.amount), 0);
  const hasFilter = Boolean(fund || periodId || from || to);

  return (
    <motion.div variants={pageVariants} initial="hidden" animate="show">
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <label className="sr-only" htmlFor="inc-fund">Lọc quỹ</label>
          <Select id="inc-fund" className="filter-field" value={fund} onChange={(e) => setFund(e.target.value as Fund | '')}>
            <option value="">Mọi quỹ</option>
            {FUND_KEYS.map((f) => <option key={f} value={f}>{FUNDS[f].label}</option>)}
          </Select>
          <label className="sr-only" htmlFor="inc-period">Lọc đợt thu</label>
          <Select id="inc-period" className="filter-field" value={periodId} onChange={(e) => setPeriodId(e.target.value)}>
            <option value="">Mọi đợt</option>
            {(periods.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            <option value="__none">Thu ngoài đợt</option>
          </Select>
          <DateBox id="inc-from" className="filter-field" label="Từ ngày" value={from} onChange={setFrom} />
          <DateBox id="inc-to" className="filter-field" label="Đến ngày" value={to} onChange={setTo} />
          {hasFilter && (
            <Button size="sm" variant="ghost" className="filter-action"
              onClick={() => { setFund(''); setPeriodId(''); setFrom(''); setTo(''); }}>
              Xoá lọc
            </Button>
          )}
          <div className="hidden flex-1 sm:block" />
          {can.writeIncome(role) && (
            <>
              <Button size="sm" className="filter-action" icon={<Layers className="h-4 w-4" />}
                onClick={() => setBatch(true)}>
                Thu theo lô
              </Button>
              <Button size="sm" variant="income" className="filter-action" icon={<Plus className="h-4 w-4" />}
                onClick={() => setDialog({ open: true, editing: null })}>
                Thêm thu
              </Button>
            </>
          )}
        </div>

        {incomes.isLoading ? (
          <TableSkeleton rows={8} cols={7} />
        ) : rows.length === 0 ? (
          <EmptyState
            title="Chưa có khoản thu nào trong phạm vi lọc"
            hint={can.writeIncome(role) ? 'Dùng “Thu theo lô” để ghi nhận cả đợt, hoặc mở QR cho từng sinh viên ở trang Danh sách lớp.' : undefined}
          />
        ) : (
          <>
            <TableWrap>
              <table>
                <caption className="sr-only">Lịch sử các khoản thu</caption>
                <thead>
                  <tr>
                    <th>Ngày</th><th>Quỹ</th><th>Đợt thu</th><th>Người nộp</th>
                    <th className="text-right">Số tiền</th><th>Hình thức</th><th>Người thu</th><th>Ghi chú</th><th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <motion.tr key={r.id} {...rowStagger(i)}>
                      <td className="num whitespace-nowrap">{fmtDate(r.date)}</td>
                      <td><FundBadge fund={r.fund} /></td>
                      <td className="text-[13px]">{r.period_name ?? 'Ngoài đợt'}</td>
                      <td>
                        <div className="font-semibold">{r.student_name || r.payer_name || 'Nguồn khác'}</div>
                        {r.student_code
                          ? <div className="num text-xs text-ink3">{r.student_code}</div>
                          : <div className="text-xs text-ink3">Nguồn khác</div>}
                      </td>
                      <td className="text-right"><Money value={r.amount} kind="in" /></td>
                      <td className="text-[13px]">
                        {r.method === 'TRANSFER' ? <Badge tone="brand">{METHOD_LABEL[r.method]}</Badge> : METHOD_LABEL[r.method]}
                      </td>
                      <td className="text-[13px]">{r.collected_by}</td>
                      <td className="text-[13px] text-ink3">{r.note}</td>
                      <td>
                        {can.writeIncome(role) && (
                          <div className="flex justify-end gap-1 opacity-40 transition-opacity hover:opacity-100 focus-within:opacity-100">
                            <Button size="sm" variant="ghost" aria-label="Sửa khoản thu"
                              onClick={() => setDialog({ open: true, editing: r })}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button size="sm" variant="ghost" aria-label="Xoá khoản thu" onClick={() => setConfirmDel(r)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        )}
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={4}>Tổng {rows.length} khoản thu</td>
                    <td className="text-right"><Money value={total} kind="in" /></td>
                    <td colSpan={4} />
                  </tr>
                </tfoot>
              </table>
            </TableWrap>
            <div className="flex flex-wrap items-center gap-4 rounded-b-xl2 border-t border-line bg-surface2 px-4 py-3 text-sm">
              {byFund.map((b) => (
                <span key={b.fund} className="flex items-center gap-2">
                  <FundBadge fund={b.fund} /> <b className="num">{fmtVnd(b.total)}</b>
                </span>
              ))}
              <span className="ml-auto">Tổng cộng <b className="num">{fmtVnd(total)}</b></span>
            </div>
          </>
        )}
      </Card>

      <IncomeDialog
        open={dialog.open}
        onOpenChange={(v) => setDialog((s) => ({ ...s, open: v }))}
        editing={dialog.editing}
        students={(students.data ?? []).filter((s) => s.is_active)}
        periods={periods.data ?? []}
        paidOf={paidOf}
        collectors={collectors}
      />

      <BatchCollectDialog
        open={batch}
        onOpenChange={setBatch}
        students={(students.data ?? []).filter((s) => s.is_active)}
        periods={periods.data ?? []}
        paidOf={paidOf}
      />

      <ConfirmModal
        open={Boolean(confirmDel)}
        onOpenChange={(v) => !v && setConfirmDel(null)}
        title="Xoá khoản thu?"
        danger
        okLabel="Xoá"
        loading={softDelete.isPending}
        message={
          <>
            Xoá khoản thu <b>{fmtVnd(confirmDel?.amount ?? 0)}</b> của{' '}
            <b>{confirmDel?.student_name || confirmDel?.payer_name}</b> ngày {fmtDate(confirmDel?.date)}?
            <br />Bản ghi được đánh dấu đã xoá (vẫn giữ trong lịch sử thao tác) và tồn quỹ được tính lại ngay.
          </>
        }
        onConfirm={() => {
          const row = confirmDel;
          if (!row) return;
          softDelete.mutate({ id: row.id }, {
            onSuccess: () => {
              toast.toast('warn', 'Đã xoá khoản thu', `${fmtVnd(row.amount)} · ${row.student_name ?? row.payer_name}`, {
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
    </motion.div>
  );
}
