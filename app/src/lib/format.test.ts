import { describe, expect, it } from 'vitest';
import { fmtDate, fmtVnd, fmtVndSigned, noAccent, normCode, parseMoney, splitName } from './format';

describe('tiền', () => {
  it('hiển thị dấu chấm nhóm nghìn', () => {
    expect(fmtVnd(1250000)).toBe('1.250.000 ₫');
    expect(fmtVndSigned(-40000)).toBe('−40.000 ₫');
  });
  it('nhận cả "50000" và "50.000"', () => {
    expect(parseMoney('50000')).toBe(50000);
    expect(parseMoney('50.000')).toBe(50000);
    expect(parseMoney('50 000 ₫')).toBe(50000);
    expect(parseMoney('')).toBe(0);
  });
});

describe('mã sinh viên', () => {
  it('ép ký hiệu khoa học về chuỗi số nguyên', () => {
    expect(normCode('2.400000001E9')).toBe('2400000001');
    expect(normCode(2400000001)).toBe('2400000001');
    expect(normCode('2400000001.0')).toBe('2400000001');
  });
  it('giữ số 0 ở đầu khi vốn là chuỗi', () => {
    expect(normCode('0240000001')).toBe('0240000001');
  });
});

describe('tìm kiếm bỏ dấu', () => {
  it('khớp tên có dấu', () => {
    expect(noAccent('Trần Văn Mẫu')).toBe('tran van mau');
    expect(noAccent('Đặng Văn Bảy')).toBe('dang van bay');
    expect(noAccent('Lương Văn Chín')).toBe('luong van chin');
  });
});

describe('tên và ngày', () => {
  it('tách tên là từ cuối', () => {
    expect(splitName('Trần Văn Mẫu')).toEqual({ last_name: 'Trần Văn', first_name: 'An' });
    expect(splitName('An')).toEqual({ last_name: '', first_name: 'An' });
  });
  it('hiển thị ngày dd/MM/yyyy', () => {
    expect(fmtDate('2026-09-09')).toBe('09/09/2026');
    expect(fmtDate(null)).toBe('');
  });
});
