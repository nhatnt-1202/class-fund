import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isConfigured = Boolean(url && anonKey);

if (!isConfigured && import.meta.env.DEV) {
  console.warn('[Quỹ Lớp] Chưa có VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — hãy sao .env.example thành .env');
}

export const supabase = createClient(url ?? 'http://localhost:54321', anonKey ?? 'anon', {
  auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true },
});

/**
 * RLS chặn UPDATE bằng cách lọc hết dòng (0 dòng bị sửa) chứ KHÔNG báo lỗi.
 * Vì vậy mọi update phải trả về dữ liệu và đi qua đây, nếu không giao diện sẽ
 * báo "đã lưu" trong khi thực tế không có gì được lưu.
 */
export function assertChanged<T>(rows: T[] | null, whatFailed: string): T[] {
  if (!rows || rows.length === 0) {
    throw new Error(`${whatFailed} — bạn không có quyền, hoặc bản ghi đã bị người khác thay đổi.`);
  }
  return rows;
}

/** Đổi lỗi kỹ thuật của Postgres/Supabase thành câu tiếng Việt cho người dùng. */
export function friendlyError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? '');
  const map: Array<[RegExp, string]> = [
    [/row-level security/i, 'Bạn không có quyền thực hiện việc này.'],
    [/duplicate key.*students_code_uniq/i, 'Mã sinh viên này đã có trong danh sách lớp.'],
    [/duplicate key.*invites_pending_uniq/i, 'Email này đã có một lời mời đang chờ.'],
    [/duplicate key.*profiles_email_uniq/i, 'Email này đã có tài khoản.'],
    [/incomes_amount_check|expenses_amount_check/i, 'Số tiền phải lớn hơn 0.'],
    [/expenses_buyer_check/i, 'Phải ghi rõ ai đi mua khoản chi này.'],
    [/class_settings_bank_bin_check/i, 'Mã BIN ngân hàng phải gồm đúng 6 chữ số.'],
    [/class_settings_account_no_check/i, 'Số tài khoản chỉ gồm chữ số, dài 6–20 ký tự.'],
    [/Invalid login credentials/i, 'Email hoặc mật khẩu không đúng.'],
    [/Email not confirmed/i, 'Email chưa được xác nhận — hãy mở link trong hộp thư.'],
    [/User already registered/i, 'Email này đã có tài khoản, hãy đăng nhập.'],
    [/chưa được mời/i, 'Email này chưa được mời vào hệ thống. Hãy nhờ quản trị lớp gửi lời mời.'],
    [/Failed to fetch|NetworkError/i, 'Không kết nối được tới máy chủ. Kiểm tra mạng rồi thử lại.'],
  ];
  for (const [re, msg] of map) if (re.test(raw)) return msg;
  return raw || 'Có lỗi xảy ra, vui lòng thử lại.';
}
