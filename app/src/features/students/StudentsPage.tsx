import { motion } from 'framer-motion';
import { FileSpreadsheet, Pencil, QrCode, UserPlus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useKlassContext } from '@/app/ClassProvider';
import {
  Badge, Button, Card, EmptyState, Input, Money, Select, TableSkeleton, TableWrap,
} from '@/components/ui';
import { useClassOfficers, useDebts, usePeriods, useStudents } from '@/data/api';
import { fmtDate, fmtNum, fmtVnd, noAccent, toInt } from '@/lib/format';
import { can } from '@/lib/permissions';
import { pageVariants, rowStagger } from '@/lib/motion';
import { FUNDS, ROLE_LABEL, type ClassOfficer, type Fund, type Student } from '@/types/db';
import IncomeDialog from '@/features/incomes/IncomeDialog';
import { QrDialog } from '@/features/qr/QrDialogs';
import StudentDialog from './StudentDialog';

type SortKey = 'stt' | 'code' | 'full_name' | 'dob' | 'paid' | 'remaining';

export default function StudentsPage() {
  const { role, classId, myStudentId, klass } = useKlassContext();
  const students = useStudents(classId, role);
  const periods = usePeriods(classId);
  const debts = useDebts(classId, role);
  const officers = useClassOfficers(classId);

  const [q, setQ] = useState('');
  const [fundFilter, setFundFilter] = useState<Fund | ''>('');
  const [periodFilter, setPeriodFilter] = useState('');
  const [status, setStatus] = useState<'' | 'debt' | 'paid'>('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'stt', dir: 1 });

  const [studentDialog, setStudentDialog] = useState<{ open: boolean; editing: Student | null }>({ open: false, editing: null });
  const [qr, setQr] = useState<{ open: boolean; student: Student | null; periodId: string }>(
    { open: false, student: null, periodId: '' },
  );
  const [income, setIncome] = useState<{ open: boolean; studentId: string; periodId: string }>(
    { open: false, studentId: '', periodId: '' },
  );

  /**
   * Ai trong danh sách đang giữ vai gì. Đọc từ view v_class_officers nên thành viên và cả
   * khách cũng thấy — đúng thứ họ cần biết để liên hệ khi nộp tiền hay khi số liệu sai.
   */
  const officerOf = useMemo(() => {
    const m = new Map<string, ClassOfficer>();
    for (const o of officers.data ?? []) if (o.student_id) m.set(o.student_id, o);
    return m;
  }, [officers.data]);
  const officersOutside = (officers.data ?? []).filter((o) => !o.in_student_list);
  /*
   * Khách được quét QR để chuyển khoản (họ chính là người phải nộp tiền), trừ khi lớp bật
   * che tên: lúc đó mã SV trong nội dung chuyển khoản cũng bị che nên tiền về không đối
   * chiếu được với ai.
   */
  const guestQr = Boolean(klass?.account_no) && !klass?.hide_student_names_from_guest;

  const paidMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of debts.data ?? []) m.set(`${d.student_id}|${d.period_id}`, d.paid);
    return m;
  }, [debts.data]);
  const paidOf = (studentId: string, periodId: string) => paidMap.get(`${studentId}|${periodId}`) ?? 0;
  /** Số còn thiếu của một sinh viên ở một đợt — QrDialog cần để gộp nhiều đợt. */
  const remainingOf = (studentId: string, periodId: string) => {
    const p = (periods.data ?? []).find((x) => x.id === periodId);
    if (!p) return 0;
    return Math.max(toInt(p.amount_per_student) - paidOf(studentId, periodId), 0);
  };

  const cols = (periods.data ?? [])
    .filter((p) => !fundFilter || p.fund === fundFilter)
    .filter((p) => !periodFilter || p.id === periodFilter);

  const rows = useMemo(() => {
    const byStudent = new Map<string, { paid: number; remaining: number }>();
    for (const d of debts.data ?? []) {
      if (fundFilter && d.fund !== fundFilter) continue;
      if (periodFilter && d.period_id !== periodFilter) continue;
      const cur = byStudent.get(d.student_id) ?? { paid: 0, remaining: 0 };
      cur.paid += d.paid;
      cur.remaining += d.remaining;
      byStudent.set(d.student_id, cur);
    }
    let list = (students.data ?? [])
      .filter((s) => s.is_active)
      .map((s) => ({ s, ...(byStudent.get(s.id) ?? { paid: 0, remaining: 0 }) }));

    const query = noAccent(q);
    if (query) {
      list = list.filter((r) => noAccent(r.s.full_name).includes(query) || r.s.code.includes(q.trim()));
    }
    if (status === 'debt') list = list.filter((r) => r.remaining > 0);
    if (status === 'paid') list = list.filter((r) => r.remaining === 0);

    const val = (r: typeof list[number]) => {
      switch (sort.key) {
        case 'code': return r.s.code;
        case 'full_name': return r.s.full_name;
        case 'dob': return r.s.dob ?? '';
        case 'paid': return r.paid;
        case 'remaining': return r.remaining;
        default: return toInt(r.s.stt);
      }
    };
    return [...list].sort((a, b) => {
      const x = val(a);
      const y = val(b);
      if (typeof x === 'number' && typeof y === 'number') return (x - y) * sort.dir;
      return String(x).localeCompare(String(y), 'vi') * sort.dir;
    });
  }, [students.data, debts.data, q, status, sort, fundFilter, periodFilter]);

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 }));

  const Th = ({ k, children, right }: { k: SortKey; children: React.ReactNode; right?: boolean }) => (
    <th className={right ? 'text-right' : undefined}>
      <button type="button" onClick={() => toggleSort(k)}
        className={`inline-flex items-center gap-1 hover:text-ink ${sort.key === k ? 'text-brand' : ''}`}>
        {children}
        <span aria-hidden>{sort.key === k ? (sort.dir === 1 ? '▲' : '▼') : '↕'}</span>
      </button>
    </th>
  );

  const totals = rows.reduce((a, r) => ({ paid: a.paid + r.paid, remaining: a.remaining + r.remaining }), { paid: 0, remaining: 0 });

  return (
    <motion.div variants={pageVariants} initial="hidden" animate="show">
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <div className="filter-field">
            <label className="sr-only" htmlFor="stu-q">Tìm sinh viên</label>
            {/* Ô lọc rộng cố định 200px nên chữ gợi ý phải ngắn; phần "bỏ dấu vẫn tìm được"
                chuyển vào title để không bị cắt cụt giữa chừng. */}
            <Input id="stu-q" type="search" value={q} onChange={(e) => setQ(e.target.value)}
              title="Gõ không dấu vẫn tìm được"
              placeholder="Tìm tên hoặc mã SV…" />
          </div>
          <label className="sr-only" htmlFor="stu-fund">Lọc theo quỹ</label>
          <Select id="stu-fund" className="filter-field" value={fundFilter} onChange={(e) => setFundFilter(e.target.value as Fund | '')}>
            <option value="">Mọi quỹ</option>
            {Object.entries(FUNDS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </Select>
          <label className="sr-only" htmlFor="stu-period">Lọc theo đợt thu</label>
          <Select id="stu-period" className="filter-field" value={periodFilter} onChange={(e) => setPeriodFilter(e.target.value)}>
            <option value="">Mọi đợt thu</option>
            {(periods.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
          <label className="sr-only" htmlFor="stu-status">Lọc theo tình trạng nộp</label>
          <Select id="stu-status" className="filter-field" value={status} onChange={(e) => setStatus(e.target.value as '' | 'debt' | 'paid')}>
            <option value="">Tất cả SV</option>
            <option value="debt">Chỉ SV còn nợ</option>
            <option value="paid">Chỉ SV đã đủ</option>
          </Select>
          {/* Một khối riêng cho nút: thanh lọc xuống dòng thì cả khối xuống cùng nhau,
              không để một nút mắc lại ở cuối dòng trên. */}
          <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto">
            {can.importStudents(role) && (
              <Link to="/import-export" className="filter-action">
                <Button size="sm" className="w-full" icon={<FileSpreadsheet className="h-4 w-4" />}>Nhập từ Excel</Button>
              </Link>
            )}
            {can.writeStudent(role) && (
              <Button size="sm" variant="primary" className="filter-action" icon={<UserPlus className="h-4 w-4" />}
                onClick={() => setStudentDialog({ open: true, editing: null })}>
                Thêm sinh viên
              </Button>
            )}
          </div>
        </div>

        {/*
          * Người giữ quỹ có thể không nằm trong danh sách sinh viên (giáo viên, lớp trưởng đã
          * chuyển lớp), nên ngoài nhãn trên từng dòng còn cần một chỗ nêu đủ ban quản lý.
          */}
        {(officers.data ?? []).length > 0 && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line bg-surface2
            px-4 py-2 text-[13px]">
            <span className="font-semibold text-ink2">Ban quản lý lớp:</span>
            {(officers.data ?? []).map((o) => (
              <span key={`${o.role}-${o.person_name}`} className="flex items-center gap-1.5">
                <Badge tone={o.role === 'admin' ? 'brand' : 'ok'}>{ROLE_LABEL[o.role]}</Badge>
                {o.person_name}
                {!o.in_student_list && <span className="text-ink3">(ngoài danh sách)</span>}
              </span>
            ))}
            {officersOutside.length === (officers.data ?? []).length && (
              <span className="text-ink3">— chưa ai trong danh sách được gắn quyền</span>
            )}
          </div>
        )}

        {students.isLoading || debts.isLoading ? (
          <TableSkeleton rows={8} cols={6} />
        ) : rows.length === 0 ? (
          <EmptyState
            title={q || status ? 'Không có sinh viên khớp bộ lọc' : 'Chưa có sinh viên nào'}
            hint={q || status ? undefined : 'Nhập danh sách lớp từ file Excel hoặc thêm tay từng người.'}
            action={can.writeStudent(role) && !q && !status
              ? <Button variant="primary" size="sm" onClick={() => setStudentDialog({ open: true, editing: null })}>Thêm tay</Button>
              : undefined}
          />
        ) : (
          <TableWrap>
            <table>
              <caption className="sr-only">Danh sách sinh viên và tình trạng nộp quỹ từng đợt</caption>
              <thead>
                <tr>
                  <Th k="stt">STT</Th>
                  <Th k="code">Mã SV</Th>
                  <Th k="full_name">Họ và tên</Th>
                  {can.viewStudentDob(role) && <Th k="dob">Ngày sinh</Th>}
                  <th>Lớp</th>
                  {cols.map((p) => (
                    <th key={p.id} title={`${FUNDS[p.fund].label} · ${fmtVnd(p.amount_per_student)}/SV`}>
                      {p.name}
                      <div className="text-[11px] font-medium normal-case tracking-normal text-ink3">
                        {FUNDS[p.fund].short} · {fmtNum(p.amount_per_student)}
                      </div>
                    </th>
                  ))}
                  <Th k="paid" right>Đã nộp</Th>
                  <Th k="remaining" right>Còn nợ</Th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const officer = officerOf.get(r.s.id);
                  return (
                  <motion.tr key={r.s.id} {...rowStagger(i)}>
                    <td className="num text-ink3">{r.s.stt ?? ''}</td>
                    <td className="num">{r.s.code}</td>
                    <td className="font-semibold">
                      <span className="flex flex-wrap items-center gap-1.5">
                        {r.s.full_name}
                        {officer && (
                          <Badge tone={officer.role === 'admin' ? 'brand' : 'ok'}>
                            {ROLE_LABEL[officer.role]}
                          </Badge>
                        )}
                        {r.s.id === myStudentId && <Badge>bạn</Badge>}
                      </span>
                    </td>
                    {can.viewStudentDob(role) && <td className="num text-xs text-ink3">{fmtDate(r.s.dob)}</td>}
                    <td className="text-xs text-ink3">{r.s.class_code}</td>
                    {cols.map((p) => {
                      const paid = paidOf(r.s.id, p.id);
                      const must = toInt(p.amount_per_student);
                      const remaining = Math.max(must - paid, 0);
                      if (must === 0) return <td key={p.id} className="text-xs text-ink3">—</td>;
                      const tone = remaining === 0 ? 'ok' : paid > 0 ? 'warn' : 'neutral';
                      const label = remaining === 0 ? 'Đã đóng' : paid > 0 ? `Thiếu ${fmtNum(remaining)}` : 'Chưa đóng';
                      return (
                        <td key={p.id}>
                          {can.showQrFor(role, myStudentId, r.s.id, guestQr) ? (
                            <button
                              type="button"
                              title={`Mở QR chuyển khoản cho đợt ${p.name}`}
                              onClick={() => setQr({ open: true, student: r.s, periodId: p.id })}
                              className="rounded transition-transform hover:scale-105"
                            >
                              <Badge tone={tone}>{label}</Badge>
                            </button>
                          ) : (
                            <Badge tone={tone}>{label}</Badge>
                          )}
                        </td>
                      );
                    })}
                    <td className="text-right"><Money value={r.paid} kind={r.paid ? 'in' : undefined} /></td>
                    <td className="text-right">
                      <Money value={r.remaining} kind={r.remaining ? 'out' : undefined} />
                    </td>
                    <td>
                      <div className="flex justify-end gap-1 opacity-40 transition-opacity hover:opacity-100 focus-within:opacity-100">
                        {can.showQrFor(role, myStudentId, r.s.id, guestQr) && (
                          <Button size="sm" variant="ghost" aria-label={`QR chuyển khoản của ${r.s.full_name}`}
                            // Không truyền đợt cụ thể: hộp thoại sẽ mặc định gộp tất cả đợt
                            // còn nợ. Bấm vào ô công nợ của một đợt thì mới chọn đúng đợt đó.
                            onClick={() => setQr({ open: true, student: r.s, periodId: '' })}>
                            <QrCode className="h-4 w-4" />
                          </Button>
                        )}
                        {can.writeStudent(role) && (
                          <Button size="sm" variant="ghost" aria-label={`Sửa ${r.s.full_name}`}
                            onClick={() => setStudentDialog({ open: true, editing: r.s })}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </motion.tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={(can.viewStudentDob(role) ? 5 : 4) + cols.length}>Tổng {rows.length} sinh viên</td>
                  <td className="text-right"><Money value={totals.paid} kind="in" /></td>
                  <td className="text-right"><Money value={totals.remaining} kind="out" /></td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </TableWrap>
        )}
      </Card>

      <StudentDialog
        open={studentDialog.open}
        onOpenChange={(v) => setStudentDialog((s) => ({ ...s, open: v }))}
        editing={studentDialog.editing}
        defaultClassCode={klass?.code ?? ''}
        existingCodes={new Map((students.data ?? []).map((s) => [s.code, s.id]))}
      />

      <QrDialog
        open={qr.open}
        onOpenChange={(v) => setQr((s) => ({ ...s, open: v }))}
        student={qr.student}
        periods={periods.data ?? []}
        remainingOf={remainingOf}
        initialPeriodId={qr.periodId}
        onCash={(periodId) => setIncome({ open: true, studentId: qr.student?.id ?? '', periodId })}
      />

      <IncomeDialog
        open={income.open}
        onOpenChange={(v) => setIncome((s) => ({ ...s, open: v }))}
        students={(students.data ?? []).filter((s) => s.is_active)}
        periods={periods.data ?? []}
        paidOf={paidOf}
        presetStudentId={income.studentId}
        presetPeriodId={income.periodId}
      />
    </motion.div>
  );
}
