import { describe, expect, it } from 'vitest';
import { BANKS, bankName, buildVietQr, cleanTransferNote, crc16, parseTlv, qrSvg, transferNote } from './vietqr';

describe('CRC16/CCITT-FALSE', () => {
  it('khớp test vector chuẩn của EMVCo', () => {
    expect(crc16('123456789')).toBe('29B1');
  });
});

describe('payload VietQR', () => {
  const payload = buildVietQr({
    bin: '970436', accountNo: '1021234567', amount: 50000, description: '2400000001 QUY LOP',
  });

  it('đúng cấu trúc TLV theo chuẩn', () => {
    const f = parseTlv(payload);
    expect(f['00']).toBe('01');
    expect(f['01']).toBe('12');          // có sẵn số tiền
    expect(f['53']).toBe('704');         // VND
    expect(f['54']).toBe('50000');
    expect(f['58']).toBe('VN');
    const merchant = parseTlv(f['38']!);
    expect(merchant['00']).toBe('A000000727');
    expect(merchant['02']).toBe('QRIBFTTA');
    const ben = parseTlv(merchant['01']!);
    expect(ben['00']).toBe('970436');
    expect(ben['01']).toBe('1021234567');
    expect(parseTlv(f['62']!)['08']).toBe('2400000001 QUY LOP');
  });

  it('CRC ở cuối payload tự khớp', () => {
    expect(payload.slice(-4)).toBe(crc16(payload.slice(0, -4)));
  });

  it('không có số tiền thì là mã tĩnh, không có trường 54', () => {
    const f = parseTlv(buildVietQr({ bin: '970436', accountNo: '1021234567' }));
    expect(f['01']).toBe('11');
    expect(f['54']).toBeUndefined();
  });

  it('thiếu cấu hình thì không sinh payload', () => {
    expect(buildVietQr({ bin: '', accountNo: '' })).toBe('');
    expect(buildVietQr({ bin: '97043', accountNo: '123' })).toBe('');       // BIN phải 6 số
    expect(buildVietQr({ bin: '970436', accountNo: '' })).toBe('');
  });
});

describe('nội dung chuyển khoản', () => {
  it('bỏ dấu, in hoa, tối đa 25 ký tự, không còn khoảng trắng thừa', () => {
    const n = cleanTransferNote('Trần Văn Mẫu – Quỹ lớp học kỳ I (2026)');
    expect(n).toBe(n.trim());
    expect(n.length).toBeLessThanOrEqual(25);
    expect(n).toMatch(/^[A-Z0-9 ]+$/);
  });
  it('điền theo mẫu và luôn chứa mã SV để đối chiếu sao kê', () => {
    const note = transferNote('{ma} {dot}', { code: '2400000001', period: 'Quỹ lớp HK1' });
    expect(note).toContain('2400000001');
    expect(note).toBe('2400000001 QUY LOP HK1');
  });
});

describe('danh sách ngân hàng', () => {
  it('mã BIN đều 6 số và không trùng', () => {
    expect(BANKS.every((b) => /^\d{6}$/.test(b.bin))).toBe(true);
    expect(new Set(BANKS.map((b) => b.bin)).size).toBe(BANKS.length);
  });
  it('tra được tên ngân hàng', () => {
    expect(bankName('970436')).toBe('Vietcombank');
    expect(bankName('123456')).toBe('BIN 123456');
  });
});

describe('vẽ QR', () => {
  it('sinh được thẻ SVG từ payload', () => {
    const svg = qrSvg(buildVietQr({ bin: '970436', accountNo: '1021234567', amount: 20000 }));
    expect(svg).toContain('<svg');
    expect(svg.length).toBeGreaterThan(500);
  });
  it('payload rỗng thì không vẽ', () => {
    expect(qrSvg('')).toBe('');
  });
});
