import { motion } from 'framer-motion';
import { ArrowDownRight, ArrowUpRight, Download } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useKlassContext } from '@/app/ClassProvider';
import {
  Badge, Button, Card, CardHead, CountUp, DateBox, EmptyState, FundBadge, Money, Note, Progress, TableSkeleton, TableWrap,
} from '@/components/ui';
import { useBalances, useDebts, useExpenses, useIncomes, usePeriodProgress } from '@/data/api';
import { fmtDate, fmtVnd, fmtVndSigned, toInt } from '@/lib/format';
import { can } from '@/lib/permissions';
import { pageVariants, rowStagger } from '@/lib/motion';
import { FUNDS, FUND_KEYS, type Fund } from '@/types/db';
import MonthlyFacets, { type MonthPoint } from './MonthlyFacets';

type RangeMode = 'all' | 'month' | 'range' | 'day';

export default function DashboardPage() {
  const { role, classId } = useKlassContext();
  const [mode, setMode] = useState<RangeMode>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const balances = useBalances(classId);
  const progress = usePeriodProgress(classId);
  const incomes = useIncomes(classId, role);
  const expenses = useExpenses(classId, role);
  const debts = useDebts(classId, role);

  const inRange = (date: string) => {
    if (mode === 'all') return true;
    if (mode === 'month') return date.slice(0, 7) === new Date().toISOString().slice(0, 7);
    if (mode === 'day') return !from || date === from;
    return (!from || date >= from) && (!to || date <= to);
  };

  const scoped = useMemo(() => {
    const out = {} as Record<Fund, { income: number; expense: number; balance: number }>;
    for (const f of FUND_KEYS) out[f] = { income: 0, expense: 0, balance: 0 };
    for (const i of incomes.data ?? []) if (inRange(i.date)) out[i.fund].income += toInt(i.amount);
    for (const e of expenses.data ?? []) if (inRange(e.date)) out[e.fund].expense += toInt(e.amount);
    for (const f of FUND_KEYS) out[f].balance = out[f].income - out[f].expense;
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomes.data, expenses.data, mode, from, to]);

  const lifetime = (f: Fund) => balances.data?.find((b) => b.fund === f)?.balance ?? 0;
  const filtering = mode !== 'all';

  const months = useMemo<MonthPoint[]>(() => {
    const map = new Map<string, MonthPoint>();
    const touch = (m: string) => {
      if (!map.has(m)) {
        map.set(m, {
          month: m,
          income: { QUY_LOP: 0, QUY_DOAN: 0 },
          expense: { QUY_LOP: 0, QUY_DOAN: 0 },
        });
      }
      return map.get(m)!;
    };
    for (const i of incomes.data ?? []) if (i.date) touch(i.date.slice(0, 7)).income[i.fund] += toInt(i.amount);
    for (const e of expenses.data ?? []) if (e.date) touch(e.date.slice(0, 7)).expense[e.fund] += toInt(e.amount);
    return [...map.values()].sort((a, b) => (a.month < b.month ? -1 : 1)).slice(-8);
  }, [incomes.data, expenses.data]);

  const topDebt = useMemo(() => {
    const byStudent = new Map<string, { name: string; code: string; total: number; periods: string[] }>();
    for (const d of debts.data ?? []) {
      if (d.remaining <= 0) continue;
      const cur = byStudent.get(d.student_id) ?? { name: d.full_name, code: d.code, total: 0, periods: [] };
      cur.total += d.remaining;
      cur.periods.push(`${d.period_name} (${fmtVnd(d.remaining)})`);
      byStudent.set(d.student_id, cur);
    }
    return [...byStudent.values()].sort((a, b) => b.total - a.total).slice(0, 10);
  }, [debts.data]);

  const totalScoped = FUND_KEYS.reduce(
    (acc, f) => ({
      income: acc.income + scoped[f].income,
      expense: acc.expense + scoped[f].expense,
      balance: acc.balance + scoped[f].balance,
    }),
    { income: 0, expense: 0, balance: 0 },
  );
  const totalLifetime = FUND_KEYS.reduce((a, f) => a + lifetime(f), 0);
  // Quỹ nào đang âm — xét trên số luỹ kế, không theo bộ lọc thời gian: đó mới là tiền thật
  const negativeFunds = FUND_KEYS.filter((f) => lifetime(f) < 0);

  const rangeChips: Array<[RangeMode, string]> = [
    ['all', 'Tất cả'], ['month', 'Tháng này'], ['range', 'Khoảng ngày'], ['day', 'Một ngày'],
  ];

  return (
    <motion.div variants={pageVariants} initial="hidden" animate="show" className="space-y-4">
      {/* Bộ lọc thời gian: một hàng, ngay trên các con số mà nó ảnh hưởng */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-2">
          {rangeChips.map(([m, label]) => (
            <button
              key={m}
              type="button"
              onClick={() => { setMode(m); if (m === 'day' && !from) setFrom(new Date().toISOString().slice(0, 10)); }}
              className={`rounded-full border px-3 py-1 text-[13px] transition-colors ${
                mode === m ? 'border-transparent bg-brand font-semibold text-white' : 'border-lineStrong bg-surface hover:bg-surface2'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {(mode === 'range' || mode === 'day') && (
          <div className="flex items-center gap-2">
            <DateBox id="dash-from" label={mode === 'day' ? 'Ngày' : 'Từ ngày'} value={from} onChange={setFrom} />
            {mode === 'range' && (
              <>
                <span className="text-sm text-ink3">→</span>
                <DateBox id="dash-to" label="Đến ngày" value={to} onChange={setTo} />
              </>
            )}
          </div>
        )}
        <div className="flex-1" />
        {can.exportExcel(role) && (
          <Link to="/import-export">
            <Button size="sm" icon={<Download className="h-4 w-4" />}>Xuất Excel</Button>
          </Link>
        )}
      </div>

      {/*
        * Quỹ âm là chuyện có thật: ai đó ứng tiền của mình mua trước rồi lớp thu bù sau. App
        * cho phép (bản ghi chi được đánh dấu ⚠ vượt quỹ) nhưng phải nói to, vì đây là món nợ
        * lớp đang mắc với một người cụ thể — không phải chỉ là một con số đỏ trên thẻ.
        */}
      {negativeFunds.length > 0 && (
        <Note tone="warn">
          <span>
            {negativeFunds.map((f) => (
              <span key={f} className="mr-3">
                <b>{FUNDS[f].label}</b> đang âm <b>{fmtVnd(Math.abs(lifetime(f)))}</b>
              </span>
            ))}
            — có người đã ứng tiền mua trước, lớp cần thu bù cho đủ. Xem các khoản chi có dấu
            {' '}<b>⚠ vượt quỹ</b> ở trang Chi để biết ai đang ứng.
          </span>
        </Note>
      )}

      {/* KPI: mỗi quỹ một thẻ + thẻ tổng. Con số chính là tồn quỹ. */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {FUND_KEYS.map((f) => (
          <Card key={f} className="relative overflow-hidden p-4">
            <span className={`absolute inset-x-0 top-0 h-[3px] ${f === 'QUY_LOP' ? 'bg-lop' : 'bg-doan'}`} aria-hidden />
            <h3 className="flex items-center gap-2 text-[0.95rem] font-semibold text-ink2">
              <span className={`h-2 w-2 rounded-full ${f === 'QUY_LOP' ? 'bg-lop' : 'bg-doan'}`} aria-hidden />
              {FUNDS[f].label}
            </h3>
            <div className="mt-2 text-[0.78rem] font-semibold uppercase tracking-wider text-ink3">Tồn quỹ hiện tại</div>
            <CountUp
              value={scoped[f].balance}
              className={`block font-head text-[2.05rem] font-bold leading-tight ${scoped[f].balance < 0 ? 'text-expense' : ''}`}
            />
            <dl className="mt-3 flex gap-5 border-t border-dashed border-line pt-3">
              <div className="flex-1">
                <dt className="flex items-center gap-1 text-xs text-ink3"><ArrowUpRight className="h-3.5 w-3.5" aria-hidden />Tổng thu</dt>
                <dd className="num font-semibold text-income">{fmtVnd(scoped[f].income)}</dd>
              </div>
              <div className="flex-1">
                <dt className="flex items-center gap-1 text-xs text-ink3"><ArrowDownRight className="h-3.5 w-3.5" aria-hidden />Tổng chi</dt>
                <dd className="num font-semibold text-expense">{fmtVnd(scoped[f].expense)}</dd>
              </div>
            </dl>
            {filtering && (
              <p className="mt-2 text-[13px] text-ink3">
                Luỹ kế toàn thời gian: <b className="text-ink2">{fmtVndSigned(lifetime(f))}</b>
              </p>
            )}
          </Card>
        ))}
        <Card className="relative overflow-hidden p-4">
          <span className="absolute inset-x-0 top-0 h-[3px] bg-ink3" aria-hidden />
          <h3 className="text-[0.95rem] font-semibold text-ink2">Tổng cộng cả {FUND_KEYS.length} quỹ</h3>
          <div className="mt-2 text-[0.78rem] font-semibold uppercase tracking-wider text-ink3">Tồn quỹ hiện tại</div>
          <CountUp
            value={totalScoped.balance}
            className={`block font-head text-[2.05rem] font-bold leading-tight ${totalScoped.balance < 0 ? 'text-expense' : ''}`}
          />
          <dl className="mt-3 flex gap-5 border-t border-dashed border-line pt-3">
            <div className="flex-1">
              <dt className="text-xs text-ink3">Tổng thu</dt>
              <dd className="num font-semibold text-income">{fmtVnd(totalScoped.income)}</dd>
            </div>
            <div className="flex-1">
              <dt className="text-xs text-ink3">Tổng chi</dt>
              <dd className="num font-semibold text-expense">{fmtVnd(totalScoped.expense)}</dd>
            </div>
          </dl>
          {filtering && (
            <p className="mt-2 text-[13px] text-ink3">
              Luỹ kế toàn thời gian: <b className="text-ink2">{fmtVndSigned(totalLifetime)}</b>
            </p>
          )}
        </Card>
      </div>

      {filtering && (
        <Note tone="warn">
          <span>
            Đang lọc theo thời gian — các thẻ trên chỉ tính bản ghi trong phạm vi đã chọn.
            Số tiền lớp <b>thực tế đang giữ</b> là dòng “Luỹ kế toàn thời gian”.
          </span>
        </Note>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHead
            title="Tiến độ các đợt thu"
            actions={can.writePeriod(role) ? <Link to="/periods"><Button size="sm" variant="ghost">Quản lý</Button></Link> : undefined}
          />
          {progress.isLoading ? (
            <TableSkeleton rows={3} cols={2} />
          ) : (progress.data ?? []).length === 0 ? (
            <EmptyState
              title="Chưa có đợt thu nào"
              hint="Tạo đợt thu để theo dõi ai đã nộp, ai còn nợ."
              action={can.writePeriod(role) ? <Link to="/periods"><Button variant="primary" size="sm">Tạo đợt thu</Button></Link> : undefined}
            />
          ) : (
            <ul className="divide-y divide-line">
              {(progress.data ?? []).map((p) => (
                <li key={p.period_id} className="px-4 py-3">
                  <div className="mb-1.5 flex flex-wrap items-baseline gap-2">
                    <span className="font-semibold">{p.name}</span>
                    <FundBadge fund={p.fund} />
                    {p.status === 'CLOSED' && <Badge>Đã đóng</Badge>}
                    <span className="num ml-auto text-sm text-ink2">
                      {fmtVnd(p.collected)} / {fmtVnd(p.expected)}
                    </span>
                  </div>
                  <Progress value={p.expected ? p.collected / p.expected : 0} fund={p.fund} />
                  <div className="mt-1.5 flex flex-wrap gap-3 text-[13px] text-ink3">
                    <span><b className="text-income">{p.paid_count}</b> đã đóng</span>
                    <span><b className="text-warn">{p.partial_count}</b> đóng thiếu</span>
                    <span><b className="text-expense">{p.unpaid_count}</b> chưa đóng</span>
                    <span className="ml-auto">Còn thiếu <b className="text-ink2">{fmtVnd(p.remaining)}</b></span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHead title="Thu – chi theo tháng" sub="Số liệu chi tiết xem ở trang Thu và trang Chi" />
          <div className="p-4">
            {incomes.isLoading || expenses.isLoading ? <TableSkeleton rows={4} cols={3} /> : <MonthlyFacets points={months} />}
          </div>
        </Card>
      </div>

      <Card>
        <CardHead
          title="Top công nợ"
          sub={topDebt.length ? `${topDebt.length} sinh viên còn nợ nhiều nhất` : undefined}
          actions={<Link to="/students"><Button size="sm" variant="ghost">Xem cả lớp</Button></Link>}
        />
        {debts.isLoading ? (
          <TableSkeleton rows={4} cols={3} />
        ) : topDebt.length === 0 ? (
          <div className="p-4"><Note tone="ok"><span>Không còn ai nợ quỹ. Cả lớp đã nộp đủ.</span></Note></div>
        ) : (
          <TableWrap>
            <table>
              <caption className="sr-only">Sinh viên còn nợ quỹ nhiều nhất</caption>
              <thead>
                <tr><th>Sinh viên</th><th>Còn thiếu ở đợt</th><th className="text-right">Còn nợ</th></tr>
              </thead>
              <tbody>
                {topDebt.map((d, i) => (
                  <motion.tr key={d.code} {...rowStagger(i)}>
                    <td>
                      <div className="font-semibold">{d.name}</div>
                      <div className="num text-xs text-ink3">{d.code}</div>
                    </td>
                    <td className="text-[13px] text-ink2">{d.periods.map((p) => <div key={p}>{p}</div>)}</td>
                    <td className="text-right"><Money value={d.total} kind="out" /></td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHead title="Khoản thu gần nhất" actions={<Link to="/incomes"><Button size="sm" variant="ghost">Tất cả</Button></Link>} />
          <TableWrap>
            <table>
              <caption className="sr-only">Năm khoản thu gần nhất</caption>
              <tbody>
                {(incomes.data ?? []).slice(0, 5).map((r, i) => (
                  <motion.tr key={r.id} {...rowStagger(i)}>
                    <td className="num whitespace-nowrap text-xs text-ink3">{fmtDate(r.date)}</td>
                    <td>
                      <div>{r.student_name || r.payer_name || 'Nguồn khác'}</div>
                      <div className="text-xs text-ink3">{r.period_name ?? 'Ngoài đợt'}</div>
                    </td>
                    <td><FundBadge fund={r.fund} /></td>
                    <td className="text-right"><Money value={r.amount} kind="in" /></td>
                  </motion.tr>
                ))}
                {(incomes.data ?? []).length === 0 && (
                  <tr><td className="py-6 text-center text-sm text-ink3">Chưa có khoản thu nào</td></tr>
                )}
              </tbody>
            </table>
          </TableWrap>
        </Card>

        <Card>
          <CardHead title="Khoản chi gần nhất" actions={<Link to="/expenses"><Button size="sm" variant="ghost">Tất cả</Button></Link>} />
          <TableWrap>
            <table>
              <caption className="sr-only">Năm khoản chi gần nhất</caption>
              <tbody>
                {(expenses.data ?? []).slice(0, 5).map((r, i) => (
                  <motion.tr key={r.id} {...rowStagger(i)}>
                    <td className="num whitespace-nowrap text-xs text-ink3">{fmtDate(r.date)}</td>
                    <td>
                      <div>{r.item}</div>
                      <div className="text-xs text-ink3">{r.buyer}</div>
                    </td>
                    <td><FundBadge fund={r.fund} /></td>
                    <td className="text-right"><Money value={r.amount} kind="out" /></td>
                  </motion.tr>
                ))}
                {(expenses.data ?? []).length === 0 && (
                  <tr><td className="py-6 text-center text-sm text-ink3">Chưa có khoản chi nào</td></tr>
                )}
              </tbody>
            </table>
          </TableWrap>
        </Card>
      </div>
    </motion.div>
  );
}
