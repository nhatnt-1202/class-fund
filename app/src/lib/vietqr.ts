/**
 * VietQR (Napas 247) — dựng payload chuyển khoản theo chuẩn EMVCo và vẽ QR ngay trên máy.
 * Số tài khoản KHÔNG được gửi tới dịch vụ sinh QR bên ngoài nào.
 *
 * Cấu trúc TLV: <tag><độ dài 2 chữ số><giá trị>
 *   00 phiên bản · 01 kiểu (11 tĩnh / 12 có sẵn số tiền)
 *   38 thông tin thụ hưởng: 00 GUID A000000727 · 01 (00 BIN + 01 số TK) · 02 QRIBFTTA
 *   53 tiền tệ (704 = VND) · 54 số tiền · 58 quốc gia (VN) · 62.08 nội dung · 63 CRC16
 */
import qrcode from 'qrcode-generator';
import { noAccent, toInt } from './format';

export interface Bank {
  bin: string;
  name: string;
}

/** Mã BIN theo hệ thống Napas. */
export const BANKS: Bank[] = [
  { bin: '970436', name: 'Vietcombank' }, { bin: '970415', name: 'VietinBank' },
  { bin: '970418', name: 'BIDV' }, { bin: '970405', name: 'Agribank' },
  { bin: '970407', name: 'Techcombank' }, { bin: '970422', name: 'MB Bank' },
  { bin: '970416', name: 'ACB' }, { bin: '970432', name: 'VPBank' },
  { bin: '970423', name: 'TPBank' }, { bin: '970403', name: 'Sacombank' },
  { bin: '970441', name: 'VIB' }, { bin: '970443', name: 'SHB' },
  { bin: '970437', name: 'HDBank' }, { bin: '970448', name: 'OCB' },
  { bin: '970426', name: 'MSB' }, { bin: '970440', name: 'SeABank' },
  { bin: '970449', name: 'LPBank' }, { bin: '970431', name: 'Eximbank' },
  { bin: '970454', name: 'BVBank' }, { bin: '970425', name: 'ABBank' },
  { bin: '970412', name: 'PVcomBank' }, { bin: '970409', name: 'BacA Bank' },
  { bin: '970428', name: 'Nam A Bank' }, { bin: '970433', name: 'VietBank' },
  { bin: '970452', name: 'KienlongBank' }, { bin: '970400', name: 'SaigonBank' },
];
export const bankName = (bin: string) => BANKS.find((b) => b.bin === bin)?.name ?? (bin ? `BIN ${bin}` : '');

/** CRC16/CCITT-FALSE. Kiểm chứng: crc16('123456789') === '29B1'. */
export function crc16(str: string): string {
  let crc = 0xffff;
  for (let i = 0; i < str.length; i++) {
    crc ^= (str.charCodeAt(i) & 0xff) << 8;
    for (let j = 0; j < 8; j++) {
      crc = (crc & 0x8000) !== 0 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

const tlv = (id: string, value: string) => id + String(value.length).padStart(2, '0') + value;

/** Nội dung chuyển khoản: chỉ chữ/số/khoảng trắng, không dấu, in hoa, tối đa 25 ký tự. */
export function cleanTransferNote(s: string): string {
  return noAccent(s).toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 25).trim();
}

export interface VietQrInput {
  bin: string;
  accountNo: string;
  amount?: number;
  description?: string;
}

/** Trả chuỗi rỗng nếu chưa cấu hình đủ tài khoản — nơi gọi phải xử lý trường hợp này. */
export function buildVietQr({ bin, accountNo, amount, description }: VietQrInput): string {
  const b = String(bin ?? '').trim();
  const acc = String(accountNo ?? '').trim();
  if (!/^\d{6}$/.test(b) || !acc) return '';
  const money = toInt(amount);
  const merchant = tlv('00', 'A000000727') + tlv('01', tlv('00', b) + tlv('01', acc)) + tlv('02', 'QRIBFTTA');
  let p = tlv('00', '01') + tlv('01', money > 0 ? '12' : '11') + tlv('38', merchant) + tlv('53', '704');
  if (money > 0) p += tlv('54', String(money));
  p += tlv('58', 'VN');
  const note = cleanTransferNote(description ?? '');
  if (note) p += tlv('62', tlv('08', note));
  p += '6304';
  return p + crc16(p);
}

/** Bóc payload thành các trường TLV — dùng cho kiểm thử và gỡ lỗi. */
export function parseTlv(payload: string): Record<string, string> {
  const out: Record<string, string> = {};
  let i = 0;
  while (i + 4 <= payload.length) {
    const id = payload.slice(i, i + 2);
    const len = Number(payload.slice(i + 2, i + 4));
    if (!Number.isFinite(len)) break;
    out[id] = payload.slice(i + 4, i + 4 + len);
    i += 4 + len;
  }
  return out;
}

/** Nội dung chuyển khoản theo mẫu: {ma} {ten} {dot} {quy} {lop} */
export function transferNote(
  template: string,
  ctx: { code?: string; name?: string; period?: string; fund?: string; className?: string },
): string {
  return cleanTransferNote(
    (template || '{ma} {dot}')
      .replace(/\{ma\}/g, ctx.code ?? '')
      .replace(/\{ten\}/g, ctx.name ?? '')
      .replace(/\{dot\}/g, ctx.period ?? '')
      .replace(/\{quy\}/g, ctx.fund ?? '')
      .replace(/\{lop\}/g, ctx.className ?? ''),
  );
}

/** Vẽ QR thành thẻ SVG. Trả chuỗi rỗng nếu payload rỗng. */
export function qrSvg(payload: string, cellSize = 4): string {
  if (!payload) return '';
  const qr = qrcode(0, 'M');
  qr.addData(payload);
  qr.make();
  return qr.createSvgTag({ cellSize, margin: 2, scalable: true });
}
