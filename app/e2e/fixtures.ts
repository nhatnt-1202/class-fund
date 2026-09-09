/**
 * Giả lập Supabase ở tầng network cho E2E.
 *
 * Vì sao không dùng Supabase thật: test phải chạy được offline, không phụ thuộc dữ liệu của
 * ai, và phải kiểm tra được đúng những gì app GỬI LÊN (quỹ nào, số tiền nào, có cờ vượt quỹ
 * hay không) — điều chỉ làm được khi mình chặn request.
 */
import type { Page, Route } from '@playwright/test';
import type { AppRole } from '../src/types/db';

export const PROJECT_REF = 'e2edemo';

export const students = [
  { id: 's1', stt: 1, code: '2400000001', last_name: 'Trần Văn', first_name: 'Mẫu', full_name: 'Trần Văn Mẫu', dob: '2005-01-15', class_code: 'DCXDXD69_03B', note: '', is_active: true, batch_id: null, deleted_at: null, created_at: '', created_by: null },
  { id: 's2', stt: 2, code: '2400000002', last_name: 'Lê Thị', first_name: 'Thử', full_name: 'Lê Thị Thử', dob: '2005-02-20', class_code: 'DCXDXD69_03B', note: '', is_active: true, batch_id: null, deleted_at: null, created_at: '', created_by: null },
  { id: 's3', stt: 3, code: '2400000003', last_name: 'Phạm Minh', first_name: 'Ví', full_name: 'Phạm Minh Ví', dob: '2005-03-25', class_code: 'DCXDXD69_03B', note: '', is_active: true, batch_id: null, deleted_at: null, created_at: '', created_by: null },
];

export const periods = [
  { id: 'p1', name: 'Quỹ lớp học kỳ I', fund: 'QUY_LOP', amount_per_student: 50000, open_date: '2026-09-01', due_date: '2026-09-30', status: 'OPEN', note: '', deleted_at: null, created_at: '', created_by: null },
  { id: 'p2', name: 'Quỹ Đoàn học kỳ I', fund: 'QUY_DOAN', amount_per_student: 20000, open_date: '2026-09-01', due_date: null, status: 'OPEN', note: '', deleted_at: null, created_at: '', created_by: null },
];

/** Quỹ Lớp: thu 80.000 − chi 30.000 = 50.000 · Quỹ Đoàn: 20.000 */
export const balances = [
  { fund: 'QUY_LOP', total_income: 80000, total_expense: 30000, balance: 50000 },
  { fund: 'QUY_DOAN', total_income: 20000, total_expense: 0, balance: 20000 },
];

export const debts = [
  { student_id: 's1', code: '2400000001', full_name: 'Trần Văn Mẫu', period_id: 'p1', period_name: 'Quỹ lớp học kỳ I', fund: 'QUY_LOP', must_pay: 50000, paid: 50000, remaining: 0 },
  { student_id: 's2', code: '2400000002', full_name: 'Lê Thị Thử', period_id: 'p1', period_name: 'Quỹ lớp học kỳ I', fund: 'QUY_LOP', must_pay: 50000, paid: 30000, remaining: 20000 },
  { student_id: 's3', code: '2400000003', full_name: 'Phạm Minh Ví', period_id: 'p1', period_name: 'Quỹ lớp học kỳ I', fund: 'QUY_LOP', must_pay: 50000, paid: 0, remaining: 50000 },
  { student_id: 's1', code: '2400000001', full_name: 'Trần Văn Mẫu', period_id: 'p2', period_name: 'Quỹ Đoàn học kỳ I', fund: 'QUY_DOAN', must_pay: 20000, paid: 20000, remaining: 0 },
  { student_id: 's2', code: '2400000002', full_name: 'Lê Thị Thử', period_id: 'p2', period_name: 'Quỹ Đoàn học kỳ I', fund: 'QUY_DOAN', must_pay: 20000, paid: 0, remaining: 20000 },
  { student_id: 's3', code: '2400000003', full_name: 'Phạm Minh Ví', period_id: 'p2', period_name: 'Quỹ Đoàn học kỳ I', fund: 'QUY_DOAN', must_pay: 20000, paid: 0, remaining: 20000 },
];

const settings = {
  id: 1, class_name: 'DCXDXD69_03B', faculty: 'Xây dựng', term: 'Học kỳ I', school_year: '2026-2027',
  categories: ['Sinh hoạt', 'Sự kiện', 'Văn phòng phẩm', 'Quà tặng', 'In ấn', 'Khác'],
  hide_student_names_from_guest: false,
  bank_bin: '970436', bank_name: 'Vietcombank', account_no: '1021234567',
  account_name: 'LE THU QUY', note_template: '{ma} {dot}', updated_at: '',
};

export interface Sent {
  method: string;
  table: string;
  body: unknown;
}

export interface StubOptions {
  /** Không truyền = khách chưa đăng nhập. */
  role?: AppRole;
  hideNamesFromGuest?: boolean;
}

/**
 * Cài phiên đăng nhập giả + chặn toàn bộ REST/Auth.
 * Trả về mảng `sent` ghi lại mọi lệnh ghi mà app gửi lên, để test kiểm tra nội dung.
 */
export async function stubSupabase(page: Page, opts: StubOptions = {}): Promise<Sent[]> {
  const sent: Sent[] = [];
  const profile = {
    id: 'u1', email: 'nguoidung@lop.vn', full_name: 'Lê Thủ Quỹ',
    role: opts.role ?? 'member', is_active: true, student_id: 's2',
    created_at: '', last_sign_in_at: null,
  };

  if (opts.role) {
    await page.addInitScript(([ref, user]) => {
      localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify({
        access_token: 'fake.jwt.token', token_type: 'bearer', refresh_token: 'fake-refresh',
        expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
        user: {
          id: 'u1', email: 'nguoidung@lop.vn', aud: 'authenticated', role: 'authenticated',
          app_metadata: {}, user_metadata: { full_name: user }, created_at: '2026-01-01T00:00:00Z',
        },
      }));
    }, [PROJECT_REF, profile.full_name] as const);
  }

  const publicSettings = {
    class_name: settings.class_name, faculty: settings.faculty, term: settings.term,
    school_year: settings.school_year,
    hide_student_names_from_guest: Boolean(opts.hideNamesFromGuest),
    bank_configured: true,
  };
  const mask = (name: string) => {
    const parts = name.split(' ');
    return [parts[0], ...parts.slice(1).map((w) => `${w[0]}.`)].join(' ');
  };

  const tables: Record<string, unknown[]> = {
    v_class_public: [publicSettings],
    class_settings: [settings],
    profiles: [profile],
    students,
    periods,
    v_fund_balance: balances,
    v_student_debt: debts,
    v_period_progress: [
      { period_id: 'p1', name: periods[0]!.name, fund: 'QUY_LOP', amount_per_student: 50000, status: 'OPEN', open_date: '2026-09-01', due_date: '2026-09-30', student_count: 3, collected: 80000, expected: 150000, remaining: 70000, paid_count: 1, partial_count: 1, unpaid_count: 1 },
      { period_id: 'p2', name: periods[1]!.name, fund: 'QUY_DOAN', amount_per_student: 20000, status: 'OPEN', open_date: '2026-09-01', due_date: null, student_count: 3, collected: 20000, expected: 60000, remaining: 40000, paid_count: 1, partial_count: 0, unpaid_count: 2 },
    ],
    incomes: [{ id: 'i1', date: '2026-09-03', fund: 'QUY_LOP', period_id: 'p1', student_id: 's1', payer_name: 'Trần Văn Mẫu', amount: 50000, method: 'TRANSFER', collected_by: 'Lê Thủ Quỹ', note: 'Chuyển khoản QR', batch_id: null, deleted_at: null, created_at: '', created_by: 'u1', students: { code: '2400000001', full_name: 'Trần Văn Mẫu' }, periods: { name: 'Quỹ lớp học kỳ I' } }],
    expenses: [{ id: 'e1', date: '2026-09-05', fund: 'QUY_LOP', item: 'Nước + bánh sinh hoạt lớp', category: 'Sinh hoạt', buyer: 'Phạm Minh Ví', amount: 30000, has_receipt: false, receipt_url: null, overdraft: false, note: '', deleted_at: null, created_at: '', created_by: 'u1' }],
    v_daily_ledger: [],
    audit_logs: [{ id: 1, at: new Date().toISOString(), actor_id: 'u1', actor_email: 'nguoidung@lop.vn', actor_name: 'Lê Thủ Quỹ', action: 'INSERT', table_name: 'incomes', record_id: 'i1', summary: 'Lê Thủ Quỹ đã ghi nhận thu 50.000 ₫ từ Trần Văn Mẫu vào Quỹ Lớp (chuyển khoản)', before_data: null, after_data: null, changed_fields: null, meta: null }],
    invites: [],
    v_students_public: students.map((s) => ({
      id: s.id, stt: s.stt, class_code: s.class_code,
      full_name: opts.hideNamesFromGuest ? mask(s.full_name) : s.full_name,
      code: opts.hideNamesFromGuest ? `***${s.code.slice(-3)}` : s.code,
    })),
    v_incomes_public: [{ id: 'i1', date: '2026-09-03', fund: 'QUY_LOP', period_id: 'p1', amount: 50000, method: 'TRANSFER', payer: 'Trần Văn Mẫu', period_name: 'Quỹ lớp học kỳ I' }],
    v_expenses_public: [{ id: 'e1', date: '2026-09-05', fund: 'QUY_LOP', item: 'Nước + bánh sinh hoạt lớp', category: 'Sinh hoạt', buyer: 'Phạm Minh Ví', amount: 30000, has_receipt: false, overdraft: false }],
    v_debt_public: debts,
  };

  await page.route('**/rest/v1/**', async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    const table = url.pathname.replace('/rest/v1/', '').split('?')[0] ?? '';
    const method = req.method();

    if (method === 'POST' || method === 'PATCH') {
      let body: unknown = null;
      try { body = req.postDataJSON(); } catch { body = req.postData(); }
      sent.push({ method, table, body });
      const rows = Array.isArray(body) ? body : [body];
      // Trả về đúng số dòng đã ghi: app dùng assertChanged() để phát hiện bị RLS chặn
      const echoed = rows.map((r, i) => ({ id: `new-${i}`, created_at: new Date().toISOString(), ...(r as object) }));
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(echoed) });
      return;
    }
    // Khách chưa đăng nhập không được đọc bảng gốc — trả 401 như RLS/privilege thật
    const guestBlocked = ['students', 'incomes', 'expenses', 'profiles', 'class_settings', 'audit_logs', 'invites', 'v_student_debt', 'v_daily_ledger'];
    if (!opts.role && guestBlocked.includes(table)) {
      await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ message: 'permission denied' }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(tables[table] ?? []) });
  });

  await page.route('**/auth/v1/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) }));

  return sent;
}
