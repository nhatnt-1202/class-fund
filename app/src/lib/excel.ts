/**
 * Đọc / ghi Excel.
 *
 * §IMPORT — file danh sách lớp thật (Danh sách đóng góp quỹ lớp DCXDXD69_03B) có 5 cái bẫy:
 *   1. 9 dòng tiêu đề hành chính trước bảng      → tự dò dòng header
 *   2. Ô "Họ và tên SV" merge 2 cột (C10:D10)    → ghép cột họ đệm + cột tên
 *   3. Mã SV lưu dạng số (2.400000001E9)         → normCode() ép về chuỗi nguyên
 *   4. Ngày sinh là serial Excel (38918)         → hệ 1900, gốc 1899-12-30 → 20/07/2006
 *   5. Dòng cuối "Tổng quỹ : 1000000" cách bảng 4 dòng trống → không thành sinh viên,
 *      nhưng vẫn đọc riêng để đối chiếu
 *
 * Cột "Trạng thái"/"Số tiền" trong file CHỈ để đối chiếu — không bao giờ tạo khoản thu.
 */
import * as XLSX from 'xlsx';
import { fmtNum, fmtVnd, noAccent, normCode, parseMoney, toInt } from './format';
import type { Expense, Fund, Income, Period, Student, StudentDebt } from '@/types/db';
import { FUNDS, METHOD_LABEL } from '@/types/db';

/* ============================== NGÀY THÁNG ============================== */

/**
 * Serial Excel (hệ 1900) → 'YYYY-MM-DD'. Mốc gốc 1899-12-30 xử lý luôn bug năm nhuận 1900.
 * Kiểm chứng: 38918 → 2006-07-20 · 38873 → 2006-06-05 · 38399 → 2005-02-16
 */
export function excelSerialToIso(serial: unknown): string {
  const n = Number(serial);
  if (!Number.isFinite(n) || n <= 0 || n > 60000) return '';
  return new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000).toISOString().slice(0, 10);
}

/** ISO → serial Excel (số nguyên). Tự tính để ô ngày không dính phân số do lệch múi giờ. */
export function isoToSerial(iso: string | null | undefined): number | '' {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''));
  if (!m) return '';
  return Math.round((Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!) - Date.UTC(1899, 11, 30)) / 86400000);
}

/** Nhận Date | serial | 'dd/MM/yyyy' | 'd/M/yy' | 'yyyy-MM-dd' → 'YYYY-MM-DD'. */
export function parseDateFlexible(v: unknown): string {
  if (v === null || v === undefined || v === '') return '';
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    // SheetJS có thể trả Date lệch vài giây trước nửa đêm (2006-07-19T16:59:56Z ở TZ+7 nghĩa là
    // ngày 20/07/2006) ⇒ phải làm tròn về mốc nửa đêm gần nhất, nếu không sẽ lùi mất một ngày.
    const localMs = v.getTime() - v.getTimezoneOffset() * 60000;
    return new Date(Math.round(localMs / 86400000) * 86400000).toISOString().slice(0, 10);
  }
  if (typeof v === 'number') return excelSerialToIso(v);
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  if (/^\d{3,5}(\.\d+)?$/.test(s)) return excelSerialToIso(Number(s));
  const m = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/.exec(s);
  if (m) {
    let y = Number(m[3]);
    if (y < 100) y += y > 40 ? 1900 : 2000;
    const p = (n: number) => String(n).padStart(2, '0');
    return `${y}-${p(Number(m[2]))}-${p(Number(m[1]))}`;
  }
  return '';
}

/* ============================== IMPORT ============================== */

export type ImportField =
  | 'skip' | 'stt' | 'code' | 'last_name' | 'first_name'
  | 'dob' | 'class_code' | 'status' | 'amount' | 'pay_date' | 'note';

export const IMPORT_FIELDS: Array<{ key: ImportField; label: string; aliases: string[] }> = [
  { key: 'skip', label: '— Bỏ qua cột này —', aliases: [] },
  { key: 'stt', label: 'STT', aliases: ['stt', 'so tt', 'sott', 'no', '#'] },
  { key: 'code', label: 'Mã SV', aliases: ['ma sv', 'masv', 'mssv', 'ma sinh vien', 'student code', 'ma so sv'] },
  { key: 'last_name', label: 'Họ và tên đệm', aliases: ['ho va ten sv', 'ho va ten', 'ho ten', 'ho va ten dem', 'ho', 'fullname', 'full name', 'ten sinh vien'] },
  { key: 'first_name', label: 'Tên (cột tách riêng)', aliases: ['ten'] },
  { key: 'dob', label: 'Ngày sinh', aliases: ['ngay sinh', 'ngaysinh', 'dob', 'ns', 'sinh ngay'] },
  { key: 'class_code', label: 'Lớp', aliases: ['lop', 'class', 'lop hoc'] },
  { key: 'status', label: 'Trạng thái nộp (chỉ đối chiếu)', aliases: ['trang thai', 'tinh trang', 'trang thai nop'] },
  { key: 'amount', label: 'Số tiền trong file (chỉ đối chiếu)', aliases: ['so tien', 'so tien da nop', 'da nop', 'so tien nop'] },
  { key: 'pay_date', label: 'Ngày nộp (chỉ đối chiếu)', aliases: ['ngay', 'ngay nop', 'ngay dong'] },
  { key: 'note', label: 'Ghi chú', aliases: ['ghi chu', 'note', 'phat sinh', 'mua', 'ghichu'] },
];

export function guessField(header: unknown): ImportField {
  const h = noAccent(header);
  if (!h) return 'skip';
  for (const f of IMPORT_FIELDS) if (f.key !== 'skip' && f.aliases.some((a) => h === a)) return f.key;
  for (const f of IMPORT_FIELDS) if (f.key !== 'skip' && f.aliases.some((a) => h.includes(a))) return f.key;
  return 'skip';
}

export type Aoa = unknown[][];
export const isEmptyCell = (c: unknown) => c === null || c === undefined || String(c).trim() === '';

/** Dò dòng tiêu đề bảng trong 30 dòng đầu: phải có 'STT' và ('Mã SV' hoặc 'Họ và tên'). */
export function detectHeaderRow(aoa: Aoa): number {
  const lim = Math.min(aoa.length, 30);
  for (let r = 0; r < lim; r++) {
    const cells = (aoa[r] ?? []).map(noAccent);
    const hasStt = cells.some((c) => c === 'stt' || c.startsWith('stt'));
    const hasName = cells.some((c) => c.includes('ma sv') || c.includes('masv') || c.includes('mssv') || c.includes('ho va ten'));
    if (hasStt && hasName) return r;
  }
  for (let r = 0; r < lim; r++) {
    const cells = (aoa[r] ?? []).map(noAccent);
    if (cells.some((c) => c.includes('ma sv') || c.includes('ho va ten'))) return r;
  }
  return -1;
}

export interface DetectedMeta {
  class_name?: string;
  faculty?: string;
  term?: string;
  school_year?: string;
}

/** Rút thông tin lớp từ các dòng tiêu đề hành chính phía trên bảng. */
export function detectMeta(aoa: Aoa, headerRow: number): DetectedMeta {
  const text = aoa.slice(0, Math.max(headerRow, 0)).flat().filter((c): c is string => typeof c === 'string').join(' | ');
  const out: DetectedMeta = {};
  let m: RegExpExecArray | null;
  if ((m = /KHOA\s*:\s*([^|\-–—]+)/i.exec(text))) out.faculty = m[1]!.trim();
  if ((m = /L.P\s*:\s*([A-Za-z0-9_.\-]+)/i.exec(text))) out.class_name = m[1]!.trim().toUpperCase();
  if ((m = /H.C\s*K.\s*([IVX]+)/i.exec(text))) out.term = `Học kỳ ${m[1]!.toUpperCase()}`;
  if ((m = /(\d{4})\s*[-–]\s*(\d{4})/.exec(text))) out.school_year = `${m[1]}-${m[2]}`;
  return out;
}

export interface ParsedRow {
  row: number;
  stt: number | null;
  code: string;
  last_name: string;
  first_name: string;
  full_name: string;
  dob: string;
  class_code: string;
  note: string;
  /** Chỉ để đối chiếu, không dùng để tạo khoản thu. */
  status: string;
  amount: number;
  pay_date: string;
  errors: string[];
  warns: string[];
  duplicateOfRow?: number;
}

export interface ExtractResult {
  rows: ParsedRow[];
  footerTotal: number | null;
  stoppedAtRow: number;
}

/**
 * Dò dòng tổng cuối bảng. Phải quét riêng trên toàn sheet: trong file thật dòng
 * "Tổng quỹ" cách bảng 4 dòng trống nên vòng đọc dữ liệu (dừng ở 2 dòng trống)
 * không bao giờ chạm tới nó.
 */
export function findFooterTotal(aoa: Aoa, fromRow: number): number | null {
  for (let r = Math.max(fromRow, 0); r < aoa.length; r++) {
    const row = aoa[r] ?? [];
    const first = row.find((c) => !isEmptyCell(c));
    if (isEmptyCell(first)) continue;
    if (/^(tong|cong)\b/.test(noAccent(first))) {
      const nums = row.filter((c): c is number => typeof c === 'number');
      if (nums.length) return toInt(nums[nums.length - 1]);
      const parsed = row.map((c) => parseMoney(c)).filter((n) => n > 0);
      if (parsed.length) return parsed[parsed.length - 1]!;
    }
  }
  return null;
}

export function extractRows(aoa: Aoa, headerRow: number, mapping: Record<number, ImportField>): ExtractResult {
  const rows: ParsedRow[] = [];
  let blank = 0;
  let stoppedAtRow = aoa.length;
  const colOf = (key: ImportField) => Object.keys(mapping).map(Number).find((i) => mapping[i] === key);

  for (let r = headerRow + 1; r < aoa.length; r++) {
    const row = aoa[r] ?? [];
    if (row.length === 0 || row.every(isEmptyCell)) {
      blank += 1;
      if (blank >= 2) { stoppedAtRow = r; break; }
      continue;
    }
    blank = 0;
    const firstText = row.find((c) => !isEmptyCell(c));
    if (/^(tong|cong)\b/.test(noAccent(firstText))) { stoppedAtRow = r; break; }
    if (noAccent(row.map((c) => c ?? '').join(' ')).includes('ma sv')) continue;   // header lặp lại

    const get = (key: ImportField) => {
      const idx = colOf(key);
      return idx === undefined ? null : row[idx] ?? null;
    };
    const rawLast = get('last_name');
    const rawFirst = get('first_name');
    let last_name: string;
    let first_name: string;
    if (!isEmptyCell(rawFirst)) {
      last_name = String(rawLast ?? '').trim().replace(/\s+/g, ' ');
      first_name = String(rawFirst).trim().replace(/\s+/g, ' ');
    } else {
      const parts = String(rawLast ?? '').trim().replace(/\s+/g, ' ').split(' ');
      first_name = parts.length > 1 ? parts[parts.length - 1]! : (parts[0] ?? '');
      last_name = parts.length > 1 ? parts.slice(0, -1).join(' ') : '';
    }
    const sttRaw = get('stt');
    const rec: ParsedRow = {
      row: r + 1,
      stt: sttRaw === null ? null : (Number.parseInt(String(sttRaw).replace(/\.0+$/, ''), 10) || null),
      code: normCode(get('code')),
      last_name,
      first_name,
      full_name: `${last_name} ${first_name}`.replace(/\s+/g, ' ').trim(),
      dob: parseDateFlexible(get('dob')),
      class_code: String(get('class_code') ?? '').trim(),
      note: String(get('note') ?? '').trim(),
      status: noAccent(get('status')),
      amount: parseMoney(get('amount')),
      pay_date: parseDateFlexible(get('pay_date')),
      errors: [],
      warns: [],
    };
    if (!rec.code && !rec.full_name) continue;                                    // dòng chỉ có STT
    rows.push(rec);
  }
  return { rows, footerTotal: findFooterTotal(aoa, headerRow + 1), stoppedAtRow };
}

export function validateRows(rows: ParsedRow[], existingCodes: Set<string>): ParsedRow[] {
  const seen = new Map<string, number>();
  for (const r of rows) {
    r.errors = [];
    r.warns = [];
    if (!r.code) r.errors.push('Thiếu mã SV');
    if (!r.full_name) r.errors.push('Thiếu họ tên');
    if (r.dob) {
      const y = Number(r.dob.slice(0, 4));
      if (y < 1990 || y > 2015) r.warns.push(`Ngày sinh ${r.dob} trông không hợp lý`);
    }
    const key = r.code || `${noAccent(r.full_name)}|${r.dob}`;
    const prev = seen.get(key);
    if (prev !== undefined) {
      r.errors.push(`Trùng với dòng ${prev}`);
      r.duplicateOfRow = prev;
    } else {
      seen.set(key, r.row);
    }
    if (r.code && existingCodes.has(r.code)) r.warns.push('Đã có trong hệ thống');
  }
  return rows;
}

export function sheetToAoa(wb: XLSX.WorkBook, sheetName: string): Aoa {
  const ws = wb.Sheets[sheetName];
  if (!ws) return [];
  // KHÔNG dùng cellDates: giữ ô ngày ở dạng serial rồi tự quy đổi để không phụ thuộc múi giờ máy.
  return XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null, blankrows: true });
}

export function readWorkbook(data: ArrayBuffer): XLSX.WorkBook {
  return XLSX.read(new Uint8Array(data), { type: 'array' });
}

/** Tự đoán khớp cột, xử lý cả trường hợp ô "Họ và tên SV" bị merge 2 cột. */
export function autoMapping(aoa: Aoa, headerRow: number): Record<number, ImportField> {
  const mapping: Record<number, ImportField> = {};
  if (headerRow < 0) return mapping;
  const hdr = aoa[headerRow] ?? [];
  const width = Math.max(hdr.length, ...aoa.slice(headerRow + 1, headerRow + 12).map((r) => (r ?? []).length), 0);
  for (let c = 0; c < width; c++) mapping[c] = guessField(hdr[c]);
  for (let c = 0; c < width; c++) {
    if (mapping[c] === 'last_name' && isEmptyCell(hdr[c + 1])) {
      const hasText = aoa
        .slice(headerRow + 1, headerRow + 8)
        .some((r) => r && !isEmptyCell(r[c + 1]) && typeof r[c + 1] === 'string');
      if (hasText && (mapping[c + 1] === 'skip' || mapping[c + 1] === undefined)) mapping[c + 1] = 'first_name';
    }
  }
  const used = new Set<ImportField>();
  for (const key of Object.keys(mapping).map(Number)) {
    const v = mapping[key]!;
    if (v === 'skip') continue;
    if (used.has(v)) mapping[key] = 'skip';
    else used.add(v);
  }
  return mapping;
}

/* ============================== EXPORT ============================== */

export type ExportScope =
  | { mode: 'all'; fund?: Fund | '' }
  | { mode: 'day'; from: string; fund?: Fund | '' }
  | { mode: 'range'; from: string; to: string; fund?: Fund | '' };

export const scopeLabel = (sc: ExportScope) =>
  sc.mode === 'all' ? 'Tất cả' : sc.mode === 'day' ? `Ngày ${sc.from}` : `${sc.from} → ${sc.to}`;

export const scopeTag = (sc: ExportScope) =>
  sc.mode === 'all' ? 'TatCa'
    : sc.mode === 'day' ? sc.from.replace(/-/g, '')
      : `${sc.from.replace(/-/g, '')}-${sc.to.replace(/-/g, '')}`;

export function inScope(row: { date: string; fund: Fund }, sc: ExportScope): boolean {
  if (sc.fund && row.fund !== sc.fund) return false;
  if (sc.mode === 'day') return row.date === sc.from;
  if (sc.mode === 'range') return (!sc.from || row.date >= sc.from) && (!sc.to || row.date <= sc.to);
  return true;
}

interface SheetOpts {
  money?: number[];
  dates?: number[];
  headerRow?: number;
  widths?: number[];
  autofilter?: boolean;
}

/** Cột tiền ghi số thật + format #,##0 để Excel SUM được; cột ngày ghi serial + dd/mm/yyyy. */
function mkSheet(aoa: (string | number | boolean | null | '')[][], o: SheetOpts = {}): XLSX.WorkSheet {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1');
  const headerRow = o.headerRow ?? 0;
  for (let R = range.s.r; R <= range.e.r; R++) {
    for (const C of o.money ?? []) {
      const cell = ws[XLSX.utils.encode_cell({ r: R, c: C })];
      if (cell && cell.t === 'n') cell.z = '#,##0';
    }
    for (const C of o.dates ?? []) {
      const cell = ws[XLSX.utils.encode_cell({ r: R, c: C })];
      if (cell && cell.t === 'n' && R > headerRow) cell.z = 'dd/mm/yyyy';
    }
  }
  ws['!cols'] = (o.widths ?? (aoa[headerRow] ?? []).map((_, i) => {
    const lens = aoa.slice(0, 60).map((r) => String(r[i] ?? '').length + 2);
    return Math.min(Math.max(...lens, 8), 42);
  })).map((wch) => ({ wch }));
  if (o.autofilter && aoa.length > 1) {
    ws['!autofilter'] = {
      ref: XLSX.utils.encode_range(
        { r: headerRow, c: 0 },
        { r: aoa.length - 1, c: Math.max((aoa[headerRow] ?? []).length - 1, 0) },
      ),
    };
  }
  return ws;
}

export interface ExportData {
  meta: { class_name: string; faculty: string; term: string; school_year: string };
  bank: { bin: string; bank_name: string; account_no: string; note_template: string } | null;
  balances: Array<{ fund: Fund; total_income: number; total_expense: number; balance: number }>;
  incomes: Array<Income & { student_code?: string; student_name?: string; period_name?: string }>;
  expenses: Expense[];
  students: Student[];
  periods: Period[];
  debts: StudentDebt[];
  ledger: Array<{ date: string; fund: Fund; kind: 'THU' | 'CHI'; amount: number; label: string; detail: string; running_balance: number }>;
  audit?: Array<{ at: string; actor_name: string; action: string; table_name: string; summary: string }>;
  exportedBy: string;
}

const NO_DATA = [['Không có dữ liệu trong khoảng đã chọn']];

export function buildWorkbook(d: ExportData, sc: ExportScope): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const funds = sc.fund ? [sc.fund] : (Object.keys(FUNDS) as Fund[]);
  const inc = d.incomes.filter((r) => inScope(r, sc)).sort((a, b) => (a.date < b.date ? -1 : 1));
  const exp = d.expenses.filter((r) => inScope(r, sc)).sort((a, b) => (a.date < b.date ? -1 : 1));
  const sum = (rows: Array<{ fund: Fund; amount: number }>, f: Fund) =>
    rows.filter((x) => x.fund === f).reduce((a, x) => a + toInt(x.amount), 0);
  const lifetime = (f: Fund) => d.balances.find((b) => b.fund === f)?.balance ?? 0;

  /* 1. Tong quan */
  const rowIncome = funds.map((f) => sum(inc, f));
  const rowExpense = funds.map((f) => sum(exp, f));
  const t: (string | number)[][] = [
    ['BÁO CÁO THU CHI QUỸ LỚP'],
    ['Lớp', d.meta.class_name, '', 'Khoa', d.meta.faculty],
    ['Học kỳ', d.meta.term, '', 'Năm học', d.meta.school_year],
    ['Phạm vi xuất', scopeLabel(sc), '', 'Quỹ', sc.fund ? FUNDS[sc.fund].label : `Cả ${funds.length} quỹ`],
    ['Người xuất', d.exportedBy, '', 'Xuất lúc', new Date().toLocaleString('vi-VN')],
    [],
    ['Chỉ tiêu', ...funds.map((f) => FUNDS[f].label), 'Tổng cộng'],
    ['Tổng thu', ...rowIncome, rowIncome.reduce((a, b) => a + b, 0)],
    ['Tổng chi', ...rowExpense, rowExpense.reduce((a, b) => a + b, 0)],
    ['Tồn quỹ', ...funds.map((_, i) => rowIncome[i]! - rowExpense[i]!),
      rowIncome.reduce((a, b) => a + b, 0) - rowExpense.reduce((a, b) => a + b, 0)],
  ];
  if (sc.mode !== 'all') {
    t.push([], ['Tồn quỹ luỹ kế toàn thời gian', ...funds.map(lifetime), funds.reduce((a, f) => a + lifetime(f), 0)],
      ['(Đây là số tiền lớp thực tế đang giữ, không phụ thuộc phạm vi lọc)']);
  } else {
    // Lưới an toàn: khi xuất "tất cả", tổng tính từ các dòng phải trùng tồn quỹ do DB tính.
    // Lệch nghĩa là dữ liệu tải về bị thiếu (phân trang, mất mạng giữa đường) ⇒ phải nói ra
    // ngay trong file, tuyệt đối không im lặng xuất ra một con số sai.
    const mismatched = funds.filter((f, i) => rowIncome[i]! - rowExpense[i]! !== lifetime(f));
    if (mismatched.length > 0) {
      t.push([],
        ['⚠ LỆCH SỐ LIỆU — KHÔNG DÙNG FILE NÀY ĐỂ QUYẾT TOÁN'],
        ['Tổng tính từ các dòng trong file không trùng tồn quỹ do hệ thống tính:'],
        ['Quỹ', 'Tính từ các dòng', 'Tồn quỹ hệ thống', 'Lệch'],
        ...mismatched.map((f) => {
          const i = funds.indexOf(f);
          const fromRows = rowIncome[i]! - rowExpense[i]!;
          return [FUNDS[f].label, fromRows, lifetime(f), fromRows - lifetime(f)];
        }),
        ['Hãy tải lại trang rồi xuất lại. Nếu vẫn lệch, báo cho quản trị lớp.']);
    }
  }
  XLSX.utils.book_append_sheet(wb, mkSheet(t, { money: [1, 2, 3], headerRow: 6, widths: [34, 18, 18, 18, 18] }), 'Tong quan');

  /* 2. Thu */
  const hThu = ['Ngày', 'Quỹ', 'Đợt thu', 'Mã SV', 'Họ và tên', 'Số tiền', 'Hình thức', 'Người thu', 'Ghi chú'];
  const aThu = inc.length
    ? [hThu,
      ...inc.map((i) => [isoToSerial(i.date), FUNDS[i.fund].label, i.period_name ?? 'Ngoài đợt',
        i.student_code ?? '', i.student_name ?? i.payer_name ?? 'Nguồn khác', toInt(i.amount),
        METHOD_LABEL[i.method], i.collected_by, i.note]),
      [], ['TỔNG CỘNG', '', '', '', '', inc.reduce((a, x) => a + toInt(x.amount), 0)],
      ...funds.map((f) => [`Trong đó ${FUNDS[f].label}`, '', '', '', '', sum(inc, f)])]
    : [hThu, ...NO_DATA];
  XLSX.utils.book_append_sheet(wb, mkSheet(aThu, { money: [5], dates: [0], autofilter: true }), 'Thu');

  /* 3. Chi */
  const hChi = ['Ngày', 'Rút từ quỹ', 'Nội dung / Mua món gì', 'Danh mục', 'Người đi mua', 'Số tiền', 'Có hoá đơn', 'Vượt quỹ', 'Ghi chú'];
  const aChi = exp.length
    ? [hChi,
      ...exp.map((e) => [isoToSerial(e.date), FUNDS[e.fund].label, e.item, e.category, e.buyer,
        toInt(e.amount), e.has_receipt ? 'Có' : 'Không', e.overdraft ? 'CÓ' : '', e.note]),
      [], ['TỔNG CỘNG', '', '', '', '', exp.reduce((a, x) => a + toInt(x.amount), 0)],
      ...funds.map((f) => [`Trong đó ${FUNDS[f].label}`, '', '', '', '', sum(exp, f)])]
    : [hChi, ...NO_DATA];
  XLSX.utils.book_append_sheet(wb, mkSheet(aChi, { money: [5], dates: [0], autofilter: true }), 'Chi');

  /* 4. Cong no */
  const periods = d.periods.filter((p) => !sc.fund || p.fund === sc.fund);
  const byStudent = new Map<string, StudentDebt[]>();
  for (const row of d.debts) {
    if (!byStudent.has(row.student_id)) byStudent.set(row.student_id, []);
    byStudent.get(row.student_id)!.push(row);
  }
  const hNo = ['STT', 'Mã SV', 'Họ và tên', 'Lớp', ...periods.map((p) => `${p.name} (${FUNDS[p.fund].short})`),
    'Phải nộp', 'Đã nộp', 'Còn thiếu', 'Trạng thái'];
  const aNo = [hNo, ...d.students.filter((s) => s.is_active).map((s) => {
    const rows = byStudent.get(s.id) ?? [];
    const cells = periods.map((p) => rows.find((x) => x.period_id === p.id)?.paid ?? 0);
    const must = periods.reduce((a, p) => a + toInt(p.amount_per_student), 0);
    const paid = cells.reduce((a, b) => a + b, 0);
    return [s.stt ?? '', s.code, s.full_name, s.class_code, ...cells, must, paid,
      Math.max(must - paid, 0), paid >= must ? 'Đã đủ' : paid > 0 ? 'Còn thiếu' : 'Chưa nộp'];
  })];
  XLSX.utils.book_append_sheet(wb, mkSheet(aNo, {
    money: periods.map((_, i) => 4 + i).concat([4 + periods.length, 5 + periods.length, 6 + periods.length]),
    autofilter: true,
  }), 'Cong no');

  /* 5. Ma tran dot thu */
  const hMt = ['Mã SV', 'Họ và tên', ...periods.map((p) => p.name)];
  const aMt = [hMt, ...d.students.filter((s) => s.is_active).map((s) => {
    const rows = byStudent.get(s.id) ?? [];
    return [s.code, s.full_name, ...periods.map((p) => {
      const c = rows.find((x) => x.period_id === p.id);
      if (!c || toInt(c.must_pay) === 0) return '—';
      return c.remaining === 0 ? 'Đã đóng' : c.paid > 0 ? `Thiếu ${fmtNum(c.remaining)}` : 'Chưa đóng';
    })];
  })];
  XLSX.utils.book_append_sheet(wb, mkSheet(aMt, { autofilter: true }), 'Ma tran dot thu');

  /* 6. Danh sach lop */
  const hDs = ['STT', 'Mã SV', 'Họ và tên đệm', 'Tên', 'Ngày sinh', 'Lớp', 'Ghi chú', 'Còn học'];
  const aDs = [hDs, ...d.students.map((s) => [s.stt ?? '', s.code, s.last_name, s.first_name,
    isoToSerial(s.dob), s.class_code, s.note, s.is_active ? 'Có' : 'Không'])];
  XLSX.utils.book_append_sheet(wb, mkSheet(aDs, { dates: [4], autofilter: true }), 'Danh sach lop');

  /* 7. Nhat ky theo ngay */
  const led = d.ledger.filter((r) => inScope(r, sc));
  const hNk = ['Ngày', 'Loại', 'Quỹ', 'Nội dung / Người nộp', 'Chi tiết', 'Số tiền thu', 'Số tiền chi', 'Số dư luỹ kế của quỹ'];
  const aNk = led.length
    ? [hNk, ...led.map((r) => [isoToSerial(r.date), r.kind === 'THU' ? 'Thu' : 'Chi', FUNDS[r.fund].label,
      r.label, r.detail, r.kind === 'THU' ? r.amount : '', r.kind === 'CHI' ? r.amount : '', r.running_balance])]
    : [hNk, ...NO_DATA];
  XLSX.utils.book_append_sheet(wb, mkSheet(aNk, { money: [5, 6, 7], dates: [0], autofilter: true }), 'Nhat ky theo ngay');

  /* 8. QR chuyen khoan — để đối chiếu sao kê ngân hàng với từng sinh viên */
  if (d.bank && d.bank.bin && d.bank.account_no && periods.length) {
    const hQr = ['Mã SV', 'Họ và tên', 'Đợt thu', 'Quỹ', 'Còn phải nộp', 'Nội dung chuyển khoản',
      'Ngân hàng', 'Số tài khoản'];
    const aQr: (string | number)[][] = [hQr];
    for (const p of periods) {
      for (const row of d.debts.filter((x) => x.period_id === p.id && x.remaining > 0)) {
        aQr.push([row.code, row.full_name, p.name, FUNDS[p.fund].label, row.remaining,
          '(xem trong app — nội dung sinh theo mẫu ' + d.bank.note_template + ')',
          d.bank.bank_name, d.bank.account_no]);
      }
    }
    if (aQr.length === 1) aQr.push(['Cả lớp đã nộp đủ, không còn ai cần chuyển khoản']);
    XLSX.utils.book_append_sheet(wb, mkSheet(aQr, { money: [4], autofilter: true }), 'QR chuyen khoan');
  }

  /* 9. Audit log (chỉ khi người xuất là quản trị / chủ sở hữu) */
  if (d.audit && d.audit.length) {
    const hAu = ['Thời điểm', 'Người thực hiện', 'Hành động', 'Bảng', 'Diễn giải'];
    XLSX.utils.book_append_sheet(wb, mkSheet(
      [hAu, ...d.audit.map((a) => [new Date(a.at).toLocaleString('vi-VN'), a.actor_name, a.action, a.table_name, a.summary])],
      { autofilter: true },
    ), 'Audit log');
  }

  return wb;
}

export function exportFileName(className: string, sc: ExportScope): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  return `QuyLop_${(className || 'lop').replace(/\s+/g, '')}_${scopeTag(sc)}_${stamp}.xlsx`;
}

/** File mẫu để nhập danh sách lớp cho lần sau. */
export function buildTemplateWorkbook(className: string): XLSX.WorkBook {
  const aoa: (string | number)[][] = [
    ['DANH SÁCH LỚP — FILE MẪU IMPORT'],
    ['Giữ nguyên dòng tiêu đề bên dưới. Mã SV nên định dạng Text để Excel không đổi thành số.'],
    [],
    ['STT', 'Mã SV', 'Họ và tên đệm', 'Tên', 'Ngày sinh', 'Lớp', 'Ghi chú'],
    [1, '2400000001', 'Trần Văn', 'An', isoToSerial('2006-07-20') as number, className || 'DCXDXD69_03B', ''],
    [2, '2400000002', 'Lê Thị', 'Anh', isoToSerial('2006-06-05') as number, className || 'DCXDXD69_03B', ''],
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, mkSheet(aoa, { dates: [4], headerRow: 3 }), 'Danh sach lop');
  return wb;
}

export const moneyText = fmtVnd;
