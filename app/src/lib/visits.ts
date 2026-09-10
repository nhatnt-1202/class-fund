/**
 * Đếm lượt truy cập — phần chạy trên trình duyệt.
 *
 * Ba khoá, ba ý nghĩa khác nhau:
 *  • session_key (sessionStorage) — một LẦN MỞ APP. Đóng tab là mất, mở lại là phiên mới.
 *  • device_key  (localStorage)   — MỘT MÁY. Còn mãi, nhờ vậy phân biệt được "20 lượt của
 *    20 người" với "20 lượt của một người vào lại 20 lần".
 *  • class_id — lớp đang xem lúc đó, do ClassProvider đẩy vào qua setTrackedClass().
 *
 * Lỗi ở đây KHÔNG BAO GIỜ được nổi lên giao diện: thống kê hỏng thì thôi, quỹ lớp vẫn phải
 * xem được. Mọi lời gọi đều nuốt lỗi và chỉ ghi console khi chạy dev.
 */
import { isConfigured, supabase } from '@/lib/supabase';

const SESSION_KEY = 'quylop.visit.session';
const DEVICE_KEY = 'quylop.visit.device';

/** Lớp đang xem, do ClassProvider cập nhật — tracker nằm ngoài provider nên không đọc context được. */
let trackedClass: string | null = null;
export function setTrackedClass(id: string | null) {
  trackedClass = id;
}

function randomKey(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }
}

/** Đọc khoá đã lưu, chưa có thì sinh mới. Trình duyệt chặn storage (chế độ ẩn danh, iframe)
 *  thì trả về khoá tạm trong bộ nhớ: vẫn đếm được phiên, chỉ không nhận ra máy quay lại. */
const memory = new Map<string, string>();
function keyFrom(store: 'session' | 'local', name: string): string {
  try {
    const s = store === 'session' ? sessionStorage : localStorage;
    const got = s.getItem(name);
    if (got) return got;
    const made = randomKey();
    s.setItem(name, made);
    return made;
  } catch {
    if (!memory.has(name)) memory.set(name, randomKey());
    return memory.get(name)!;
  }
}

/** Chặn ghi trùng: React StrictMode chạy effect hai lần, và đổi trang qua lại rất nhanh. */
let lastSent = { path: '', at: 0 };

export async function trackVisit(event: 'view' | 'ping', path: string) {
  if (!isConfigured) return;
  const now = Date.now();
  if (event === 'view' && path === lastSent.path && now - lastSent.at < 2000) return;
  lastSent = { path, at: now };

  try {
    const { error } = await supabase.rpc('track_visit', {
      p_session: keyFrom('session', SESSION_KEY),
      p_device: keyFrom('local', DEVICE_KEY),
      p_class: trackedClass,
      p_path: path,
      // Chỉ gửi referrer khi đến từ site khác — referrer nội bộ chỉ là nhiễu.
      p_referrer: document.referrer && !document.referrer.startsWith(location.origin)
        ? document.referrer : '',
      p_event: event,
    });
    if (error && import.meta.env.DEV) console.warn('Không ghi được lượt truy cập:', error.message);
  } catch {
    /* mất mạng — bỏ qua, không có gì để cứu */
  }
}
