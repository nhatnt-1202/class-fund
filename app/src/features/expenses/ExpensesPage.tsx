import { motion } from 'framer-motion';
import { AlertTriangle, Pencil, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useKlassContext } from '@/app/ClassProvider';
import { useToast } from '@/app/ToastProvider';
import {
  Badge, Button, Card, ConfirmModal, DateBox, EmptyState, FundBadge, Money, Select, TableSkeleton, TableWrap,
} from '@/components/ui';
import { useExpenses, useSoftDelete } from '@/data/api';
import { fmtDate, fmtVnd, noAccent, toInt } from '@/lib/format';
import { can } from '@/lib/permissions';
import { pageVariants, rowStagger } from '@/lib/motion';
import { FUNDS, FUND_KEYS, type Expense, type Fund } from '@/types/db';
import ExpenseDialog from './ExpenseDialog';

export default function ExpensesPage() {
  const { role, classId } = useKlassContext();
  const toast = useToast();
  const expenses = useExpenses(classId, role);
  const softDelete = useSoftDelete('expenses', classId);

  const [fund, setFund] = useState<Fund | ''>('');
  const [category, setCategory] = useState('');
  const [buyer, setBuyer] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [dialog, setDialog] = useState<{ open: boolean; editing: Expense | null }>({ open: false, editing: null });
  const [confirmDel, setConfirmDel] = useState<Expense | null>(null);

  const all = expenses.data ?? [];
  const categories = useMemo(() => [...new Set(all.map((e) => e.category).filter(Boolean))], [all]);
  const buyers = useMemo(() => [...new Set(all.map((e) => e.buyer).filter(Boolean))], [all]);

  const rows = useMemo(() => all.filter((r) =>
    (!fund || r.fund === fund)
    && (!category || r.category === category)
    && (!buyer || noAccent(r.buyer).includes(noAccent(buyer)))
    && (!from || r.date >= from)
    && (!to || r.date <= to)), [all, fund, category, buyer, from, to]);

  const byFund = FUND_KEYS.map((f) => ({
    fund: f,
    total: rows.filter((r) => r.fund === f).reduce((a, r) => a + toInt(r.amount), 0),
  }));
  const total = rows.reduce((a, r) => a + toInt(r.amount), 0);
  const hasFilter = Boolean(fund || category || buyer || from || to);

  return (
    <motion.div variants={pageVariants} initial="hidden" animate="show">
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <label className="sr-only" htmlFor="exp-fund">Lọc quỹ</label>
          <Select id="exp-fund" className="filter-field" value={fund} onChange={(e) => setFund(e.target.value as Fund | '')}>
            <option value="">Mọi quỹ</option>
            {FUND_KEYS.map((f) => <option key={f} value={f}>{FUNDS[f].label}</option>)}
          </Select>
          <label className="sr-only" htmlFor="exp-cat">Lọc danh mục</label>
          <Select id="exp-cat" className="filter-field" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">Mọi danh mục</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
          <label className="sr-only" htmlFor="exp-buyer">Lọc người đi mua</label>
          <Select id="exp-buyer" className="filter-field" value={buyer} onChange={(e) => setBuyer(e.target.value)}>
            <option value="">Mọi người mua</option>
            {buyers.map((b) => <option key={b} value={b}>{b}</option>)}
          </Select>
          <DateBox id="exp-from" className="filter-field" label="Từ ngày" value={from} onChange={setFrom} />
          <DateBox id="exp-to" className="filter-field" label="Đến ngày" value={to} onChange={setTo} />
          {hasFilter && (
            <Button size="sm" variant="ghost"
              onClick={() => { setFund(''); setCategory(''); setBuyer(''); setFrom(''); setTo(''); }}>
              Xoá lọc
            </Button>
          )}
          <div className="flex-1" />
          {can.writeExpense(role) && (
            <Button size="sm" variant="expense" icon={<Plus className="h-4 w-4" />}
              onClick={() => setDialog({ open: true, editing: null })}>
              Thêm chi
            </Button>
          )}
        </div>

        {expenses.isLoading ? (
          <TableSkeleton rows={8} cols={7} />
        ) : rows.length === 0 ? (
          <EmptyState
            title="Chưa có khoản chi nào trong phạm vi lọc"
            hint="Mỗi lần mua gì cho lớp, ghi lại ngay để cuối kỳ không phải nhớ."
          />
        ) : (
          <>
            <TableWrap>
              <table>
                <caption className="sr-only">Nhật ký mua sắm — các khoản chi</caption>
                <thead>
                  <tr>
                    <th>Ngày</th><th>Rút từ quỹ</th><th>Nội dung / Mua món gì</th><th>Danh mục</th>
                    <th>Người đi mua</th><th className="text-right">Số tiền</th><th>HĐ</th><th>Ghi chú</th><th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <motion.tr key={r.id} {...rowStagger(i)}>
                      <td className="num whitespace-nowrap">{fmtDate(r.date)}</td>
                      <td><FundBadge fund={r.fund} /></td>
                      <td>
                        <span className="font-semibold">{r.item}</span>
                        {r.overdraft && (
                          <Badge tone="warn" className="ml-2">
                            <AlertTriangle className="h-3 w-3" aria-hidden /> vượt quỹ
                          </Badge>
                        )}
                      </td>
                      <td className="text-[13px]">{r.category}</td>
                      <td>{r.buyer}</td>
                      <td className="text-right"><Money value={r.amount} kind="out" /></td>
                      <td className="text-[13px]">{r.has_receipt ? '✓' : '—'}</td>
                      <td className="text-[13px] text-ink3">{r.note}</td>
                      <td>
                        {can.writeExpense(role) && (
                          <div className="flex justify-end gap-1 opacity-40 transition-opacity hover:opacity-100 focus-within:opacity-100">
                            <Button size="sm" variant="ghost" aria-label="Sửa khoản chi"
                              onClick={() => setDialog({ open: true, editing: r })}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button size="sm" variant="ghost" aria-label="Xoá khoản chi" onClick={() => setConfirmDel(r)}>
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
                    <td colSpan={5}>Tổng {rows.length} khoản chi</td>
                    <td className="text-right"><Money value={total} kind="out" /></td>
                    <td colSpan={3} />
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

      <ExpenseDialog
        open={dialog.open}
        onOpenChange={(v) => setDialog((s) => ({ ...s, open: v }))}
        editing={dialog.editing}
        buyers={buyers}
      />

      <ConfirmModal
        open={Boolean(confirmDel)}
        onOpenChange={(v) => !v && setConfirmDel(null)}
        title="Xoá khoản chi?"
        danger
        okLabel="Xoá"
        loading={softDelete.isPending}
        message={
          <>
            Xoá khoản chi <b>{fmtVnd(confirmDel?.amount ?? 0)}</b> — <b>{confirmDel?.item}</b>{' '}
            ({confirmDel ? FUNDS[confirmDel.fund].label : ''}) ngày {fmtDate(confirmDel?.date)}?
            <br />Tồn quỹ sẽ được tính lại ngay sau khi xoá.
          </>
        }
        onConfirm={() => {
          const row = confirmDel;
          if (!row) return;
          softDelete.mutate({ id: row.id }, {
            onSuccess: () => {
              toast.toast('warn', 'Đã xoá khoản chi', `${fmtVnd(row.amount)} · ${row.item}`, {
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
