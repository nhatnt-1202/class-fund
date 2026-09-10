/** Tiền, ngày tháng và tìm kiếm bỏ dấu — dùng chung toàn app. */

const nf = new Intl.NumberFormat('vi-VN');

export const toInt = (v: unknown): number => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n : 0;
};
export const fmtNum = (n: unknown) => nf.format(toInt(n));
export const fmtVnd = (n: unknown) => `${nf.format(toInt(n))} ₫`;
/** Có dấu trừ khi âm (tồn quỹ có thể âm nếu thủ quỹ ứng trước). */
export const fmtVndSigned = (n: unknown) => {
  const v = toInt(n);
  return `${v < 0 ? '−' : ''}${nf.format(Math.abs(v))} ₫`;
};

/** Nhận '50000', '50.000', '50,000 ₫', '50 000' → 50000. */
export function parseMoney(v: unknown): number {
  if (typeof v === 'number') return toInt(v);
  const digits = String(v ?? '').replace(/[^\d]/g, '');
  return digits ? Number.parseInt(digits, 10) : 0;
}

export const todayIso = () => new Date().toISOString().slice(0, 10);

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso);
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('vi-VN');
}

/** "3 phút trước" — hover lên sẽ thấy ngày giờ đầy đủ. */
export function fmtRelative(iso: string): string {
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return '';
  const s = Math.round((Date.now() - d) / 1000);
  if (s < 45) return 'vừa xong';
  if (s < 90) return 'một phút trước';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} phút trước`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} giờ trước`;
  const day = Math.round(h / 24);
  if (day < 30) return `${day} ngày trước`;
  return fmtDate(new Date(d).toISOString());
}

/** Bỏ dấu tiếng Việt để "tran van mau" khớp "Trần Văn Mẫu". */
/**
 * Thời lượng ở lại, đọc như người nói: "2 phút 30 giây", "1 giờ 5 phút".
 * Dưới 1 phút thì nói giây — làm tròn lên phút sẽ biến 3 giây thành "1 phút" và thổi phồng
 * số liệu truy cập.
 */
export function fmtDuration(seconds: unknown): string {
  const s = Math.max(0, Math.round(toInt(seconds)));
  if (s < 60) return `${s} giây`;
  const m = Math.floor(s / 60);
  if (m < 60) {
    const rest = s % 60;
    return rest ? `${m} phút ${rest} giây` : `${m} phút`;
  }
  const h = Math.floor(m / 60);
  const restM = m % 60;
  return restM ? `${h} giờ ${restM} phút` : `${h} giờ`;
}

export function noAccent(s: unknown): string {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Mã SV: Excel hay lưu dạng số ⇒ '2.400000001E9' / 2400000001.0 → '2400000001'.
 * Chuỗi số thuần được giữ nguyên để không mất số 0 ở đầu.
 */
export function normCode(v: unknown): string {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(Math.round(v)) : '';
  const s = String(v).trim().replace(/\s+/g, '');
  if (/^\d+$/.test(s)) return s;
  if (/^[\d.,]+[eE][+-]?\d+$/.test(s) || /^\d+\.0+$/.test(s)) {
    const n = Number(s.replace(/,/g, ''));
    if (Number.isFinite(n)) return String(Math.round(n));
  }
  return s;
}

export const fullNameOf = (s: { last_name?: string | null; first_name?: string | null }) =>
  `${s.last_name ?? ''} ${s.first_name ?? ''}`.replace(/\s+/g, ' ').trim();

/** Tách 'Trần Văn Mẫu' → họ đệm 'Trần Văn' + tên 'An'. */
export function splitName(full: string): { last_name: string; first_name: string } {
  const parts = String(full ?? '').trim().replace(/\s+/g, ' ').split(' ');
  if (parts.length <= 1) return { last_name: '', first_name: parts[0] ?? '' };
  return { last_name: parts.slice(0, -1).join(' '), first_name: parts[parts.length - 1]! };
}
