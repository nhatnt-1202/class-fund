import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import {
  autoMapping, buildTemplateWorkbook, buildWorkbook, detectHeaderRow, detectMeta,
  excelSerialToIso, extractRows, findFooterTotal, inScope, isoToSerial, parseDateFlexible,
  sheetToAoa, validateRows, type Aoa, type ExportData,
} from './excel';
import type { Fund } from '@/types/db';

/** Dựng lại đúng hình dạng file danh sách lớp thật để kiểm thử parser. */
function fakeClassSheet(): Aoa {
  const rows: Aoa = [
    ['BỘ GIÁO DỤC VÀ ĐÀO TẠO', null, null, null, null, null, null, null, null, 'CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM'],
    ['TRƯỜNG ĐẠI HỌC MỎ - ĐỊA CHẤT', null, null, null, null, null, null, null, null, 'Độc lập - Tự do - Hạnh phúc'],
    [],
    [null, null, null, null, null, null, null, null, null, null, null, 'Hà Nội, ngày tháng năm 2026'],
    [],
    ['DANH SÁCH ĐÓNG GÓP QUỸ LỚP HỌC KỲ I - NĂM HỌC 2026-2027'],
    ['KHOA: XÂY DỰNG - LỚP: DCXDXD69_03B'],
    [],
    [],
    ['STT', 'Mã SV', 'Họ và tên SV', null, 'Ngày sinh', 'Lớp ', 'Trạng thái', 'Số tiền ', 'Ngày', 'Mua', 'Phát sinh'],
  ];
  const names: Array<[string, string, number]> = [
    ['Trần Văn', 'Mẫu', 38918], ['Lê Thị', 'Thử', 38873],
    ['Hoàng Văn', 'Bốn', 38515], ['Bùi Văn', 'Năm', 38746],
  ];
  for (let k = 0; k < 49; k++) {
    const n = names[k % names.length]!;
    rows.push([k + 1, 2400000001 + k, n[0], k > 3 ? `${n[1]}_${k}` : n[1], n[2] + k, 'DCXDXD69_03B',
      k % 2 ? 'Đã đóng ' : 'Chưa đóng ', k % 2 ? 50000 : null]);
  }
  rows.push([], [], ['Tổng quỹ :', null, null, null, null, null, null, 1000000]);
  return rows;
}

describe('quy đổi ngày Excel', () => {
  it('serial hệ 1900 ra đúng ngày Excel hiển thị', () => {
    expect(excelSerialToIso(38918)).toBe('2006-07-20');
    expect(excelSerialToIso(38873)).toBe('2006-06-05');
    expect(excelSerialToIso(38399)).toBe('2005-02-16');
    expect(excelSerialToIso(39077)).toBe('2006-12-26');
  });
  it('quay ngược lại ra đúng serial', () => {
    expect(isoToSerial('2006-07-20')).toBe(38918);
    expect(isoToSerial('')).toBe('');
  });
  it('ô kiểu Date lệch vài giây trước nửa đêm vẫn ra đúng ngày', () => {
    // SheetJS trả Date như thế này ở TZ+7 để biểu diễn ngày 20/07/2006
    const d = new Date(2006, 6, 20, 0, 0, 0);
    d.setSeconds(d.getSeconds() - 4);
    expect(parseDateFlexible(d)).toBe('2006-07-20');
  });
  it('nhận cả chuỗi dd/MM/yyyy và d/M/yy', () => {
    expect(parseDateFlexible('20/07/2006')).toBe('2006-07-20');
    expect(parseDateFlexible('5/6/06')).toBe('2006-06-05');
    expect(parseDateFlexible('lung tung')).toBe('');
  });
});

describe('parser danh sách lớp', () => {
  const aoa = fakeClassSheet();
  const headerRow = detectHeaderRow(aoa);
  const mapping = autoMapping(aoa, headerRow);
  const ex = extractRows(aoa, headerRow, mapping);

  it('bỏ qua 9 dòng tiêu đề hành chính, dò đúng dòng tiêu đề bảng', () => {
    expect(headerRow).toBe(9);   // dòng 10 trong Excel
  });
  it('đọc được thông tin lớp từ phần tiêu đề', () => {
    const meta = detectMeta(aoa, headerRow);
    expect(meta.class_name).toBe('DCXDXD69_03B');
    expect(meta.faculty).toMatch(/XÂY DỰNG/);
    expect(meta.term).toBe('Học kỳ I');
    expect(meta.school_year).toBe('2026-2027');
  });
  it('ô "Họ và tên SV" bị merge ⇒ ghép 2 cột thành họ đệm + tên', () => {
    expect(mapping[2]).toBe('last_name');
    expect(mapping[3]).toBe('first_name');
    expect(ex.rows[0]!.full_name).toBe('Trần Văn Mẫu');
    expect(ex.rows[0]!.last_name).toBe('Trần Văn');
    expect(ex.rows[0]!.first_name).toBe('Mẫu');
  });
  it('đọc đúng 49 sinh viên và không lấy dòng tổng', () => {
    expect(ex.rows).toHaveLength(49);
    expect(ex.rows.some((r) => /^(tong|cong)/i.test(r.full_name))).toBe(false);
  });
  it('vẫn bắt được dòng tổng để đối chiếu dù cách bảng 4 dòng trống', () => {
    expect(ex.footerTotal).toBe(1000000);
    expect(findFooterTotal(aoa, 0)).toBe(1000000);
  });
  it('mã SV luôn là chuỗi số nguyên', () => {
    expect(ex.rows[0]!.code).toBe('2400000001');
    expect(ex.rows.every((r) => /^\d+$/.test(r.code))).toBe(true);
  });
  it('cột Trạng thái có khoảng trắng cuối vẫn nhận đúng', () => {
    expect(ex.rows.filter((r) => r.status.startsWith('da dong'))).toHaveLength(24);
  });
  it('phát hiện trùng mã và thiếu dữ liệu', () => {
    // chèn dòng trùng NGAY TRONG khối dữ liệu (chèn sau khối là vô nghĩa vì parser
    // đã dừng ở 2 dòng trống trước dòng tổng)
    const withDup: Aoa = [
      ...aoa.slice(0, headerRow + 1),
      [1, 2400000001, 'Trần Văn', 'Mẫu', 38918, 'DCXDXD69_03B'],
      [2, 2400000001, 'Trần Văn', 'Mẫu', 38918, 'DCXDXD69_03B'],
      [3, null, '', '', null, 'DCXDXD69_03B'],
      [], [], ['Tổng quỹ :', null, null, null, null, null, null, 1000000],
    ];
    const hr = detectHeaderRow(withDup);
    const rows = validateRows(extractRows(withDup, hr, autoMapping(withDup, hr)).rows, new Set<string>());
    expect(rows).toHaveLength(2);                        // dòng trống chỉ có STT bị bỏ qua
    expect(rows[1]!.errors.join(' ')).toMatch(/Trùng với dòng/);
  });
  it('cảnh báo sinh viên đã có trong hệ thống', () => {
    const rows = validateRows(ex.rows.slice(), new Set(['2400000001']));
    expect(rows[0]!.warns.join(' ')).toMatch(/Đã có/);
  });
});

describe('xuất Excel', () => {
  const fund: Fund = 'QUY_LOP';
  const data: ExportData = {
    meta: { class_name: 'DCXDXD69_03B', faculty: 'Xây dựng', term: 'Học kỳ I', school_year: '2026-2027' },
    bank: { bin: '970436', bank_name: 'Vietcombank', account_no: '1021234567', note_template: '{ma} {dot}' },
    balances: [
      { fund: 'QUY_LOP', total_income: 50000, total_expense: 30000, balance: 20000 },
      { fund: 'QUY_DOAN', total_income: 0, total_expense: 0, balance: 0 },
    ],
    incomes: [{
      id: 'i1', class_id: 'c1', date: '2026-09-03', fund, period_id: 'p1', student_id: 's1', payer_name: 'Trần Văn Mẫu',
      amount: 50000, method: 'TRANSFER', collected_by: 'Thủ quỹ', note: 'Chuyển khoản QR', batch_id: null,
      deleted_at: null, created_at: '', created_by: null,
      student_code: '2400000001', student_name: 'Trần Văn Mẫu', period_name: 'Quỹ lớp HK1',
    }],
    expenses: [{
      id: 'e1', class_id: 'c1', date: '2026-09-05', fund, item: 'Nước + bánh', category: 'Sinh hoạt', buyer: 'Phạm Minh Ví',
      amount: 30000, has_receipt: false, receipt_url: null, overdraft: false, note: '',
      deleted_at: null, created_at: '', created_by: null,
    }],
    students: [{
      id: 's1', class_id: 'c1', stt: 1, code: '2400000001', last_name: 'Trần Văn', first_name: 'Mẫu', full_name: 'Trần Văn Mẫu',
      dob: '2005-01-15', class_code: 'DCXDXD69_03B', note: '', is_active: true, batch_id: null,
      deleted_at: null, created_at: '', created_by: null,
    }],
    periods: [{
      id: 'p1', class_id: 'c1', name: 'Quỹ lớp HK1', fund, amount_per_student: 50000, open_date: '2026-09-01',
      due_date: null, status: 'OPEN', note: '', deleted_at: null, created_at: '', created_by: null,
    }],
    debts: [{
      class_id: 'c1', student_id: 's1', code: '2400000001', full_name: 'Trần Văn Mẫu', period_id: 'p1',
      period_name: 'Quỹ lớp HK1', fund, must_pay: 50000, paid: 50000, remaining: 0,
    }],
    ledger: [{
      date: '2026-09-03', fund, kind: 'THU', amount: 50000, label: 'Trần Văn Mẫu',
      detail: 'Quỹ lớp HK1', running_balance: 50000,
    }],
    exportedBy: 'Lê Thủ Quỹ',
  };

  it('workbook có đủ sheet, đúng tên và đúng thứ tự', () => {
    const wb = buildWorkbook(data, { mode: 'all' });
    expect(wb.SheetNames).toEqual([
      'Tong quan', 'Thu', 'Chi', 'Cong no', 'Ma tran dot thu', 'Danh sach lop',
      'Nhat ky theo ngay', 'QR chuyen khoan',
    ]);
  });

  it('cột tiền là số thật và cột ngày là ngày thật (Excel SUM và sort được)', () => {
    const wb = buildWorkbook(data, { mode: 'all' });
    const file = path.join(os.tmpdir(), `quylop-test-${Date.now()}.xlsx`);
    XLSX.writeFile(wb, file);
    const back = XLSX.read(fs.readFileSync(file), { type: 'buffer', cellNF: true });
    const thu = back.Sheets['Thu']!;
    expect(thu['F2']!.t).toBe('n');
    expect(thu['F2']!.v).toBe(50000);
    expect(thu['F2']!.z).toBe('#,##0');
    expect(thu['A2']!.t).toBe('n');
    expect(Number.isInteger(thu['A2']!.v)).toBe(true);      // không dính phân số giờ
    expect(thu['A2']!.z).toBe('dd/mm/yyyy');
    expect(thu['!autofilter']).toBeTruthy();
    fs.unlinkSync(file);
  });

  it('sheet Tổng quan tách cột theo từng quỹ', () => {
    const wb = buildWorkbook(data, { mode: 'all' });
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets['Tong quan']!, { header: 1 });
    expect(rows[6]).toEqual(['Chỉ tiêu', 'Quỹ Lớp', 'Quỹ Đoàn', 'Tổng cộng']);
    expect(rows[9]).toEqual(['Tồn quỹ', 20000, 0, 20000]);
  });

  it('cảnh báo ngay trong file nếu số liệu xuất ra lệch với tồn quỹ trong DB', () => {
    // giả lập trường hợp dữ liệu tải về bị thiếu (ví dụ bị giới hạn phân trang)
    const wb = buildWorkbook({ ...data, incomes: [] }, { mode: 'all' });
    const text = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets['Tong quan']!, { header: 1 })
      .flat().join(' | ');
    expect(text).toMatch(/LỆCH SỐ LIỆU/);
  });

  it('xuất theo một ngày: sheet trống vẫn có header và dòng thông báo', () => {
    const wb = buildWorkbook(data, { mode: 'day', from: '2026-12-31' });
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets['Thu']!, { header: 1 });
    expect(rows).toHaveLength(2);
    expect(String(rows[1]![0])).toMatch(/Không có dữ liệu/);
  });

  it('lọc phạm vi đúng theo ngày và theo quỹ', () => {
    expect(inScope({ date: '2026-09-03', fund: 'QUY_LOP' }, { mode: 'day', from: '2026-09-03' })).toBe(true);
    expect(inScope({ date: '2026-09-04', fund: 'QUY_LOP' }, { mode: 'day', from: '2026-09-03' })).toBe(false);
    expect(inScope({ date: '2026-09-03', fund: 'QUY_DOAN' }, { mode: 'all', fund: 'QUY_LOP' })).toBe(false);
    expect(inScope({ date: '2026-09-10', fund: 'QUY_LOP' }, { mode: 'range', from: '2026-09-01', to: '2026-09-05' })).toBe(false);
  });

  it('file mẫu import đọc lại được bằng chính parser của app', () => {
    const wb = buildTemplateWorkbook('DCXDXD69_03B');
    const aoa = sheetToAoa(wb, wb.SheetNames[0]!);
    const hr = detectHeaderRow(aoa);
    const rows = extractRows(aoa, hr, autoMapping(aoa, hr)).rows;
    expect(rows).toHaveLength(2);
    expect(rows[0]!.code).toBe('2400000001');
    expect(rows[0]!.dob).toBe('2006-07-20');
  });
});

/**
 * Chỉ chạy khi máy có sẵn file danh sách lớp thật (mỗi người tự đặt ở ~/Downloads).
 * Cố ý CHỈ kiểm tra cấu trúc, không kỳ vọng tên hay mã sinh viên cụ thể: dữ liệu thật của
 * sinh viên không nằm trong repo này.
 */
const REAL_FILE = process.env.CLASS_LIST_XLSX
  ?? path.join(os.homedir(), 'Downloads', 'Danh sách đóng góp quỹ lớp DCXDXD69_03B (2).xlsx');

describe.runIf(fs.existsSync(REAL_FILE))('file Excel thật', () => {
  it('dò đúng dòng tiêu đề, đọc trọn danh sách và không lấy dòng tổng', () => {
    const wb = XLSX.read(fs.readFileSync(REAL_FILE), { type: 'buffer' });
    const aoa = sheetToAoa(wb, wb.SheetNames[0]!);
    const hr = detectHeaderRow(aoa);
    const ex = extractRows(aoa, hr, autoMapping(aoa, hr));
    validateRows(ex.rows, new Set<string>());

    expect(hr).toBeGreaterThanOrEqual(0);
    expect(ex.rows.length).toBeGreaterThan(0);
    // dòng tổng phải bị loại khỏi danh sách sinh viên nhưng vẫn đọc được riêng
    expect(ex.rows.some((r) => /^(tong|cong)/i.test(r.full_name))).toBe(false);
    expect(ex.footerTotal === null || ex.footerTotal > 0).toBe(true);
    // mọi dòng đọc được phải hợp lệ và mã SV luôn là chuỗi số nguyên
    expect(ex.rows.filter((r) => r.errors.length)).toHaveLength(0);
    expect(ex.rows.every((r) => /^\d+$/.test(r.code))).toBe(true);
    expect(new Set(ex.rows.map((r) => r.code)).size).toBe(ex.rows.length);
    // họ và tên được ghép từ hai cột bị merge ⇒ phải có ít nhất 2 từ
    expect(ex.rows.every((r) => r.full_name.trim().split(/\s+/).length >= 2)).toBe(true);
    // ngày sinh quy đổi được và nằm trong khoảng hợp lý của sinh viên
    const dobs = ex.rows.map((r) => r.dob).filter(Boolean);
    expect(dobs.length).toBeGreaterThan(0);
    expect(dobs.every((d) => Number(d.slice(0, 4)) >= 1990 && Number(d.slice(0, 4)) <= 2015)).toBe(true);
    // đọc được thông tin lớp từ phần tiêu đề hành chính
    expect(detectMeta(aoa, hr).class_name ?? '').toMatch(/^[A-Z0-9_.-]*$/);
  });
});
