import { motion } from 'framer-motion';
import { Download, FileDown, RotateCcw, Upload } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { useAuth } from '@/app/AuthProvider';
import { useKlassContext } from '@/app/ClassProvider';
import { useToast } from '@/app/ToastProvider';
import {
  Badge, Button, Card, CardHead, Chip, Field, Input, Modal, Note, Select, TableWrap,
} from '@/components/ui';
import {
  logEvent, useBalances, useDebts, useExpenses, useImportStudents, useIncomes, useLedger,
  usePeriods, useSaveKlass, useStudents, useUndoImport, type ImportResult,
} from '@/data/api';
import {
  autoMapping, buildTemplateWorkbook, buildWorkbook, detectHeaderRow, detectMeta, exportFileName,
  extractRows, IMPORT_FIELDS, readWorkbook, sheetToAoa, validateRows,
  type Aoa, type ExportScope, type ImportField, type ParsedRow,
} from '@/lib/excel';
import { fmtDate, fmtVnd } from '@/lib/format';
import { can } from '@/lib/permissions';
import { pageVariants } from '@/lib/motion';
import { FUNDS, FUND_KEYS, type Fund } from '@/types/db';

type Step = 0 | 1 | 2;

export default function ImportExportPage() {
  const { profile } = useAuth();
  const { role, classId, klass } = useKlassContext();
  const toast = useToast();
  const students = useStudents(classId, role);
  const periods = usePeriods(classId);
  const debts = useDebts(classId, role);
  const incomes = useIncomes(classId, role);
  const expenses = useExpenses(classId, role);
  const balances = useBalances(classId);
  const ledger = useLedger(classId, role);
  const saveKlass = useSaveKlass(classId);
  const doImport = useImportStudents(classId);
  const undoImport = useUndoImport();

  /* ---------- import ---------- */
  const fileRef = useRef<HTMLInputElement>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [step, setStep] = useState<Step>(0);
  const [fileName, setFileName] = useState('');
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [sheet, setSheet] = useState('');
  const [wb, setWb] = useState<XLSX.WorkBook | null>(null);
  const [aoa, setAoa] = useState<Aoa>([]);
  const [headerRow, setHeaderRow] = useState(-1);
  const [mapping, setMapping] = useState<Record<number, ImportField>>({});
  const [meta, setMeta] = useState<Record<string, string>>({});
  const [dedupe, setDedupe] = useState<'skip' | 'update' | 'insert'>('skip');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const existingCodes = useMemo(
    () => new Set((students.data ?? []).map((s) => s.code)),
    [students.data],
  );

  const parsed = useMemo(() => {
    if (headerRow < 0 || aoa.length === 0) return { rows: [] as ParsedRow[], footerTotal: null as number | null };
    const ex = extractRows(aoa, headerRow, mapping);
    validateRows(ex.rows, existingCodes);
    return ex;
  }, [aoa, headerRow, mapping, existingCodes]);

  const loadSheet = (book: XLSX.WorkBook, name: string) => {
    const rows = sheetToAoa(book, name);
    const hr = detectHeaderRow(rows);
    setAoa(rows);
    setHeaderRow(hr);
    setMapping(autoMapping(rows, hr));
    const m = detectMeta(rows, hr < 0 ? 10 : hr);
    setMeta({
      class_name: m.class_name ?? klass?.code ?? '',
      faculty: m.faculty ?? klass?.faculty ?? '',
      term: m.term ?? klass?.term ?? '',
      school_year: m.school_year ?? klass?.school_year ?? '',
    });
  };

  const openFile = async (file: File) => {
    try {
      const book = readWorkbook(await file.arrayBuffer());
      setWb(book);
      setSheetNames(book.SheetNames);
      const first = book.SheetNames[0] ?? '';
      setSheet(first);
      loadSheet(book, first);
      setFileName(file.name);
      setResult(null);
      setStep(1);
      setWizardOpen(true);
    } catch (e) {
      toast.err('Không đọc được file', e instanceof Error ? e.message : undefined);
    }
  };

  const confirmImport = async () => {
    const rows = parsed.rows.filter((r) => r.errors.length === 0);
    try {
      const res = await doImport.mutateAsync({
        dedupe,
        rows: rows.map((r) => ({
          stt: r.stt, code: r.code, last_name: r.last_name, first_name: r.first_name,
          dob: r.dob || null, class_code: r.class_code || meta.class_name || '', note: r.note,
        })),
      });
      setResult(res);
      // Chỉ điền phần còn trống của lớp: không ghi đè cấu hình lớp bằng dữ liệu trong file
      if (can.editSettings(role) && klass) {
        const patch: Record<string, string> = {};
        if (!klass.faculty && meta.faculty) patch.faculty = meta.faculty;
        if (!klass.term && meta.term) patch.term = meta.term;
        if (!klass.school_year && meta.school_year) patch.school_year = meta.school_year;
        if (Object.keys(patch).length > 0) saveKlass.mutate(patch);
      }
      void logEvent('IMPORT', `Đã nhập danh sách lớp từ ${fileName}`, classId, { file: fileName, ...res });
      toast.ok(`Đã nhập ${res.added} sinh viên`, 'Tạo đợt thu rồi dùng QR để thu tiền.');
    } catch (e) {
      toast.err('Import thất bại', e instanceof Error ? e.message : undefined);
    }
  };

  const downloadErrors = () => {
    const errs = parsed.rows.filter((r) => r.errors.length > 0);
    if (errs.length === 0) return;
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
      ['Dòng trong file', 'STT', 'Mã SV', 'Họ và tên', 'Ngày sinh', 'Lý do lỗi'],
      ...errs.map((r) => [r.row, r.stt ?? '', r.code, r.full_name, r.dob, r.errors.join('; ')]),
    ]), 'Dong loi');
    XLSX.writeFile(book, `DongLoi_Import_${Date.now()}.xlsx`);
  };

  /* ---------- export ---------- */
  const [scopeMode, setScopeMode] = useState<'all' | 'range' | 'day'>('all');
  const [from, setFrom] = useState(new Date().toISOString().slice(0, 10));
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [fundFilter, setFundFilter] = useState<Fund | ''>('');
  const [exporting, setExporting] = useState(false);

  const scope: ExportScope = scopeMode === 'all'
    ? { mode: 'all', fund: fundFilter }
    : scopeMode === 'day'
      ? { mode: 'day', from, fund: fundFilter }
      : { mode: 'range', from, to, fund: fundFilter };

  const scopedCount = useMemo(() => {
    const inRange = (d: string) => scopeMode === 'all' ? true
      : scopeMode === 'day' ? d === from
        : d >= from && d <= to;
    const i = (incomes.data ?? []).filter((r) => inRange(r.date) && (!fundFilter || r.fund === fundFilter)).length;
    const e = (expenses.data ?? []).filter((r) => inRange(r.date) && (!fundFilter || r.fund === fundFilter)).length;
    return { i, e };
  }, [incomes.data, expenses.data, scopeMode, from, to, fundFilter]);

  const runExport = async () => {
    setExporting(true);
    try {
      const book = buildWorkbook({
        meta: {
          class_name: klass?.code ?? '', faculty: klass?.faculty ?? '',
          term: klass?.term ?? '', school_year: klass?.school_year ?? '',
        },
        bank: klass && klass.bank_bin && klass.account_no
          ? {
            bin: klass.bank_bin, bank_name: klass.bank_name,
            account_no: klass.account_no, note_template: klass.note_template,
          }
          : null,
        balances: balances.data ?? [],
        incomes: incomes.data ?? [],
        expenses: expenses.data ?? [],
        students: students.data ?? [],
        periods: periods.data ?? [],
        debts: debts.data ?? [],
        ledger: (ledger.data ?? []).map((r) => ({
          date: r.date, fund: r.fund, kind: r.kind, amount: r.amount,
          label: r.label, detail: r.detail, running_balance: r.running_balance,
        })),
        exportedBy: profile?.full_name || profile?.email || 'Khách',
      }, scope);
      const name = exportFileName(klass?.code ?? '', scope);
      XLSX.writeFile(book, name);
      void logEvent('EXPORT', `Đã xuất Excel (${scopeMode}) — ${name}`, classId, { scope, rows: scopedCount });
      toast.ok('Đã xuất Excel', name);
    } catch (e) {
      toast.err('Xuất Excel thất bại', e instanceof Error ? e.message : undefined);
    } finally {
      setExporting(false);
    }
  };

  const news = parsed.rows.filter((r) => r.errors.length === 0 && !existingCodes.has(r.code));
  const dups = parsed.rows.filter((r) => r.errors.length === 0 && existingCodes.has(r.code));
  const errs = parsed.rows.filter((r) => r.errors.length > 0);
  const fileSum = parsed.rows.reduce((a, r) => a + r.amount, 0);

  return (
    <motion.div variants={pageVariants} initial="hidden" animate="show" className="grid gap-4 xl:grid-cols-2">
      {can.importStudents(role) && (
        <Card>
          <CardHead title="Nhập danh sách lớp" sub="Tự dò dòng tiêu đề · tự ghép họ + tên · tự đổi ngày sinh · tự bỏ dòng tổng" />
          <div className="p-4">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              onDragEnter={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const f = e.dataTransfer.files[0];
                if (f) void openFile(f);
              }}
              className={`w-full rounded-xl2 border-2 border-dashed p-7 text-center transition-all duration-200
                ${dragOver ? 'scale-[1.02] border-brand bg-brandSoft' : 'border-lineStrong hover:border-brand hover:bg-brandSoft'}`}
            >
              <Upload className="mx-auto h-10 w-10 text-brand" aria-hidden />
              <div className="mt-2 text-sm"><b>Kéo file Excel vào đây</b> hoặc bấm để chọn</div>
              <div className="text-xs text-ink3">.xlsx · .xls · .csv</div>
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void openFile(f);
                e.target.value = '';
              }}
            />
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" icon={<FileDown className="h-4 w-4" />}
                onClick={() => {
                  XLSX.writeFile(buildTemplateWorkbook(klass?.code ?? ''), 'FileMau_DanhSachLop.xlsx');
                  toast.ok('Đã tải file mẫu', 'Điền theo đúng các cột rồi nhập lại.');
                }}>
                Tải file mẫu import
              </Button>
              {result && (
                <Button
                  size="sm"
                  variant="danger"
                  icon={<RotateCcw className="h-4 w-4" />}
                  loading={undoImport.isPending}
                  onClick={() => undoImport.mutate(result.batch_id, {
                    onSuccess: (r) => { toast.ok('Đã hoàn tác lần nhập', `${r.students} sinh viên`); setResult(null); },
                    onError: (e) => toast.err('Không hoàn tác được', e instanceof Error ? e.message : undefined),
                  })}
                >
                  Hoàn tác lần nhập trước ({result.added} SV)
                </Button>
              )}
            </div>
            <Note tone="info">
              <span>
                Import <b>chỉ tạo danh sách sinh viên</b>. Cột “Trạng thái”/“Số tiền” trong file chỉ để đối chiếu —
                tiền vào quỹ phải qua <b>QR chuyển khoản</b> hoặc thu tay có người xác nhận.
              </span>
            </Note>
          </div>
        </Card>
      )}

      <Card>
        <CardHead
          title="Xuất Excel"
          sub={`Tổng quan · Thu · Chi · Công nợ · Ma trận đợt thu · Danh sách lớp · Nhật ký theo ngày${
            klass?.bank_bin && klass?.account_no ? ' · QR chuyển khoản' : ''}`}
        />
        <div className="p-4">
          <Field label="Phạm vi" group>
            <div className="flex flex-wrap gap-2">
              {([['all', 'Tất cả'], ['range', 'Theo khoảng ngày'], ['day', 'Theo một ngày']] as const).map(([v, l]) => (
                <Chip key={v} on={scopeMode === v} onClick={() => setScopeMode(v)}>{l}</Chip>
              ))}
            </div>
          </Field>
          {scopeMode !== 'all' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={scopeMode === 'day' ? 'Ngày' : 'Từ ngày'}>
                <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              </Field>
              {scopeMode === 'range' && (
                <Field label="Đến ngày">
                  <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
                </Field>
              )}
            </div>
          )}
          <Field label="Quỹ">
            <Select value={fundFilter} onChange={(e) => setFundFilter(e.target.value as Fund | '')}>
              <option value="">Cả {FUND_KEYS.length} quỹ (tách cột riêng)</option>
              {FUND_KEYS.map((f) => <option key={f} value={f}>Chỉ {FUNDS[f].label}</option>)}
            </Select>
          </Field>
          <p className="mb-3 text-[13px] text-ink3">
            Phạm vi này có <b className="text-ink2">{scopedCount.i}</b> khoản thu và{' '}
            <b className="text-ink2">{scopedCount.e}</b> khoản chi.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" icon={<Download className="h-4 w-4" />} loading={exporting}
              disabled={!can.exportExcel(role)} onClick={() => void runExport()}>
              Tải file .xlsx
            </Button>
            <Button variant="ghost" onClick={() => window.print()}>In / Xuất PDF báo cáo</Button>
          </div>
          {!can.exportExcel(role) && (
            <Note tone="warn"><span>Đăng nhập để xuất file Excel.</span></Note>
          )}
        </div>
      </Card>

      {/* Trình hướng dẫn nhập: khớp cột → xem trước → xác nhận */}
      <Modal
        open={wizardOpen}
        onOpenChange={(v) => { setWizardOpen(v); if (!v) setStep(0); }}
        wide
        title="Nhập danh sách lớp từ Excel"
        sub={fileName}
        footer={
          result ? (
            <Button variant="primary" onClick={() => setWizardOpen(false)}>Xong</Button>
          ) : (
            <>
              {step === 2 && <Button className="mr-auto" onClick={() => setStep(1)}>Quay lại</Button>}
              <Button onClick={() => setWizardOpen(false)}>Đóng</Button>
              {step === 1 && (
                <Button
                  variant="primary"
                  disabled={headerRow < 0 || parsed.rows.length === 0}
                  onClick={() => setStep(2)}
                >
                  Tiếp tục
                </Button>
              )}
              {step === 2 && (
                <Button variant="income" loading={doImport.isPending} onClick={() => void confirmImport()}>
                  Xác nhận import
                </Button>
              )}
            </>
          )
        }
      >
        {result ? (
          <div className="space-y-3">
            <Note tone="ok"><span>Đọc được <b>{parsed.rows.length}</b> dòng dữ liệu từ file.</span></Note>
            <TableWrap className="rounded-[10px] border border-line">
              <table>
                <caption className="sr-only">Kết quả import</caption>
                <tbody>
                  <tr><td>Thêm mới</td><td className="text-right"><b>{result.added}</b> sinh viên</td></tr>
                  <tr><td>Cập nhật</td><td className="text-right"><b>{result.updated}</b></td></tr>
                  <tr><td>Bỏ qua (đã có)</td><td className="text-right"><b>{result.skipped}</b></td></tr>
                  <tr><td>Lỗi</td><td className="text-right"><b>{result.failed + errs.length}</b></td></tr>
                </tbody>
              </table>
            </TableWrap>
            <Note tone="warn">
              <span>
                Bước tiếp theo: tạo <b>đợt thu</b> (mức thu mỗi SV, thuộc Quỹ Lớp hay Quỹ Đoàn), rồi bấm{' '}
                <b>“QR cả lớp”</b> để mỗi sinh viên quét mã chuyển khoản đúng số tiền của mình.
              </span>
            </Note>
          </div>
        ) : step === 1 ? (
          <div className="space-y-3">
            {sheetNames.length > 1 && (
              <Field label="Sheet">
                <Select value={sheet} onChange={(e) => { setSheet(e.target.value); if (wb) loadSheet(wb, e.target.value); }}>
                  {sheetNames.map((n) => <option key={n} value={n}>{n}</option>)}
                </Select>
              </Field>
            )}
            {headerRow < 0 ? (
              <Note tone="warn">
                <span>Không tìm thấy dòng tiêu đề có “STT” và “Mã SV”. Kiểm tra lại file hoặc chọn sheet khác.</span>
              </Note>
            ) : (
              <Note tone="ok">
                <span>
                  Đã tìm thấy dòng tiêu đề ở <b>dòng {headerRow + 1}</b> · đọc được{' '}
                  <b>{parsed.rows.length} sinh viên</b>
                  {parsed.footerTotal != null && <> · đã bỏ qua dòng tổng ({fmtVnd(parsed.footerTotal)})</>}
                </span>
              </Note>
            )}

            {Object.values(meta).some(Boolean) && (
              <div className="rounded-[10px] border border-line p-3">
                <b className="text-sm">Thông tin lớp đọc được từ file</b>
                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  {([['class_name', 'Mã lớp'], ['faculty', 'Khoa'], ['term', 'Học kỳ'], ['school_year', 'Năm học']] as const)
                    .map(([k, label]) => (
                      <Field key={k} label={label}>
                        <Input value={meta[k] ?? ''} onChange={(e) => setMeta((m) => ({ ...m, [k]: e.target.value }))} />
                      </Field>
                    ))}
                </div>
                <p className="text-xs text-ink3">Sẽ được lưu vào Cài đặt sau khi import.</p>
              </div>
            )}

            <div>
              <h3 className="mb-1 text-sm font-semibold">Khớp cột</h3>
              <p className="mb-2 text-xs text-ink3">
                Hệ thống đã tự đoán. Sửa lại nếu sai — “Họ và tên đệm” + “Tên” là hai cột riêng khi ô tiêu đề bị gộp.
              </p>
              <TableWrap className="max-h-[38vh] overflow-y-auto rounded-[10px] border border-line">
                <table>
                  <caption className="sr-only">Khớp cột trong file với trường dữ liệu</caption>
                  <thead>
                    <tr><th>Cột</th><th>Tiêu đề trong file</th><th>Dữ liệu mẫu</th><th>Đưa vào trường</th></tr>
                  </thead>
                  <tbody>
                    {Object.keys(mapping).map(Number).sort((a, b) => a - b).map((c) => (
                      <tr key={c}>
                        <td className="num text-ink3">{XLSX.utils.encode_col(c)}</td>
                        <td>{String((aoa[headerRow] ?? [])[c] ?? '')}</td>
                        <td className="text-xs text-ink3">
                          {aoa.slice(headerRow + 1, headerRow + 4)
                            .map((r) => String((r ?? [])[c] ?? '').slice(0, 22))
                            .filter(Boolean).join(' · ') || '—'}
                        </td>
                        <td>
                          <Select
                            className="min-w-[190px]"
                            aria-label={`Trường cho cột ${XLSX.utils.encode_col(c)}`}
                            value={mapping[c] ?? 'skip'}
                            onChange={(e) => {
                              const v = e.target.value as ImportField;
                              setMapping((m) => {
                                const next = { ...m };
                                if (v !== 'skip') {
                                  for (const k of Object.keys(next).map(Number)) if (next[k] === v && k !== c) next[k] = 'skip';
                                }
                                next[c] = v;
                                return next;
                              });
                            }}
                          >
                            {IMPORT_FIELDS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                          </Select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            </div>

            <Field label="Nếu sinh viên đã có trong hệ thống" group>
              <div className="flex flex-wrap gap-2">
                {([['skip', 'Bỏ qua dòng trùng'], ['update', 'Cập nhật thông tin SV đã có'], ['insert', 'Thêm mới hết']] as const)
                  .map(([v, l]) => <Chip key={v} on={dedupe === v} onClick={() => setDedupe(v)}>{l}</Chip>)}
              </div>
            </Field>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Badge tone="ok">{news.length} thêm mới</Badge>
              <Badge tone="warn">
                {dups.length} đã tồn tại → {dedupe === 'skip' ? 'bỏ qua' : dedupe === 'update' ? 'cập nhật' : 'thêm mới'}
              </Badge>
              <Badge tone={errs.length ? 'bad' : 'neutral'}>{errs.length} lỗi</Badge>
            </div>
            <Note tone="info">
              <span>
                Chỉ danh sách sinh viên được ghi vào hệ thống. Cột “Số tiền” trong file
                (tổng <b>{fmtVnd(fileSum)}</b>
                {parsed.footerTotal != null && <>, dòng tổng ghi <b>{fmtVnd(parsed.footerTotal)}</b></>})
                {' '}<b>không</b> được dùng để cộng vào quỹ.
              </span>
            </Note>
            {errs.length > 0 && (
              <Note tone="warn">
                <span>
                  {errs.slice(0, 4).map((r) => <span key={r.row} className="block">Dòng {r.row}: {r.errors.join(', ')}</span>)}
                  {errs.length > 4 && <span className="block">…và {errs.length - 4} dòng lỗi khác</span>}
                  <Button size="sm" className="mt-2" onClick={downloadErrors}>Tải danh sách dòng lỗi (.xlsx)</Button>
                </span>
              </Note>
            )}
            <TableWrap className="max-h-[44vh] overflow-y-auto rounded-[10px] border border-line">
              <table>
                <caption className="sr-only">Xem trước dữ liệu sẽ được nhập</caption>
                <thead>
                  <tr>
                    <th>Dòng</th><th>STT</th><th>Mã SV</th><th>Họ và tên</th><th>Ngày sinh</th>
                    <th>Lớp</th><th>Trạng thái</th><th className="text-right">Số tiền</th><th>Kết quả</th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.rows.slice(0, 20).map((r) => (
                    <tr key={r.row}>
                      <td className="num text-xs text-ink3">{r.row}</td>
                      <td className="num text-ink3">{r.stt ?? ''}</td>
                      <td className="num">{r.code}</td>
                      <td className="font-semibold">{r.full_name}</td>
                      <td className="num text-xs">{fmtDate(r.dob)}</td>
                      <td className="text-xs text-ink3">{r.class_code}</td>
                      <td className="text-xs">
                        {r.status.startsWith('da dong')
                          ? <Badge tone="ok">Đã đóng</Badge>
                          : r.status ? <Badge>Chưa đóng</Badge> : '—'}
                      </td>
                      <td className="num text-right">{r.amount ? fmtVnd(r.amount) : '—'}</td>
                      <td>
                        {r.errors.length > 0
                          ? <span title={r.errors.join(', ')}><Badge tone="bad">Lỗi</Badge></span>
                          : existingCodes.has(r.code) ? <Badge tone="warn">Đã có</Badge> : <Badge tone="ok">Mới</Badge>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
            <p className="text-xs text-ink3">
              {parsed.rows.length > 20 && `Xem trước 20/${parsed.rows.length} dòng. `}
              Dữ liệu chỉ được ghi khi bạn bấm “Xác nhận import”.
            </p>
          </div>
        )}
      </Modal>
    </motion.div>
  );
}
