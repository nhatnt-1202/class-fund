/**
 * Giả lập Supabase ở tầng network cho E2E.
 *
 * Vì sao không dùng Supabase thật: test phải chạy được offline, không phụ thuộc dữ liệu của
 * ai, và phải kiểm tra được đúng những gì app GỬI LÊN (quỹ nào, số tiền nào, có cờ vượt quỹ
 * hay không) — điều chỉ làm được khi mình chặn request.
 */
import type { Page, Route } from '@playwright/test';
import type { ClassRole } from '../src/types/db';

export const PROJECT_REF = 'e2edemo';

/** Lớp đang test. Mọi dòng dữ liệu đều mang class_id này — app luôn lọc theo lớp. */
export const CLASS_ID = 'c1';
export const CLASS_CODE = 'DCXDXD69_03B';

/** Lớp thứ hai, chỉ dùng để chứng minh app KHÔNG kéo dữ liệu lớp khác về. */
export const OTHER_CLASS_ID = 'c2';
export const OTHER_CLASS_CODE = 'DCXDXD69_04A';

export const students = [
  { id: 's1', class_id: CLASS_ID, stt: 1, code: '2400000001', last_name: 'Trần Văn', first_name: 'Mẫu', full_name: 'Trần Văn Mẫu', dob: '2005-01-15', class_code: 'DCXDXD69_03B', note: '', is_active: true, batch_id: null, deleted_at: null, created_at: '', created_by: null },
  { id: 's2', class_id: CLASS_ID, stt: 2, code: '2400000002', last_name: 'Lê Thị', first_name: 'Thử', full_name: 'Lê Thị Thử', dob: '2005-02-20', class_code: 'DCXDXD69_03B', note: '', is_active: true, batch_id: null, deleted_at: null, created_at: '', created_by: null },
  { id: 's3', class_id: CLASS_ID, stt: 3, code: '2400000003', last_name: 'Phạm Minh', first_name: 'Ví', full_name: 'Phạm Minh Ví', dob: '2005-03-25', class_code: 'DCXDXD69_03B', note: '', is_active: true, batch_id: null, deleted_at: null, created_at: '', created_by: null },
];

export const periods = [
  { id: 'p1', class_id: CLASS_ID, name: 'Quỹ lớp học kỳ I', fund: 'QUY_LOP', amount_per_student: 50000, open_date: '2026-09-01', due_date: '2026-09-30', status: 'OPEN', note: '', deleted_at: null, created_at: '', created_by: null },
  { id: 'p2', class_id: CLASS_ID, name: 'Quỹ Đoàn học kỳ I', fund: 'QUY_DOAN', amount_per_student: 20000, open_date: '2026-09-01', due_date: null, status: 'OPEN', note: '', deleted_at: null, created_at: '', created_by: null },
];

/** Quỹ Lớp: thu 80.000 − chi 30.000 = 50.000 · Quỹ Đoàn: 20.000 */
export const balances = [
  { class_id: CLASS_ID, fund: 'QUY_LOP', total_income: 80000, total_expense: 30000, balance: 50000 },
  { class_id: CLASS_ID, fund: 'QUY_DOAN', total_income: 20000, total_expense: 0, balance: 20000 },
];

export const debts = [
  { class_id: CLASS_ID, student_id: 's1', code: '2400000001', full_name: 'Trần Văn Mẫu', period_id: 'p1', period_name: 'Quỹ lớp học kỳ I', fund: 'QUY_LOP', must_pay: 50000, paid: 50000, remaining: 0 },
  { class_id: CLASS_ID, student_id: 's2', code: '2400000002', full_name: 'Lê Thị Thử', period_id: 'p1', period_name: 'Quỹ lớp học kỳ I', fund: 'QUY_LOP', must_pay: 50000, paid: 30000, remaining: 20000 },
  { class_id: CLASS_ID, student_id: 's3', code: '2400000003', full_name: 'Phạm Minh Ví', period_id: 'p1', period_name: 'Quỹ lớp học kỳ I', fund: 'QUY_LOP', must_pay: 50000, paid: 0, remaining: 50000 },
  { class_id: CLASS_ID, student_id: 's1', code: '2400000001', full_name: 'Trần Văn Mẫu', period_id: 'p2', period_name: 'Quỹ Đoàn học kỳ I', fund: 'QUY_DOAN', must_pay: 20000, paid: 20000, remaining: 0 },
  { class_id: CLASS_ID, student_id: 's2', code: '2400000002', full_name: 'Lê Thị Thử', period_id: 'p2', period_name: 'Quỹ Đoàn học kỳ I', fund: 'QUY_DOAN', must_pay: 20000, paid: 0, remaining: 20000 },
  { class_id: CLASS_ID, student_id: 's3', code: '2400000003', full_name: 'Phạm Minh Ví', period_id: 'p2', period_name: 'Quỹ Đoàn học kỳ I', fund: 'QUY_DOAN', must_pay: 20000, paid: 0, remaining: 20000 },
];

/** Bảng classes thay cho class_settings của thời một lớp: mỗi lớp một số tài khoản riêng. */
const klass = {
  id: CLASS_ID, code: CLASS_CODE, name: 'Lớp 03B', faculty: 'Xây dựng',
  term: 'Học kỳ I', school_year: '2026-2027',
  categories: ['Sinh hoạt', 'Sự kiện', 'Văn phòng phẩm', 'Quà tặng', 'In ấn', 'Khác'],
  hide_student_names_from_guest: false,
  bank_bin: '970436', bank_name: 'Vietcombank', account_no: '1021234567',
  account_name: 'LE THU QUY', note_template: '{ma} {dot}',
  is_active: true, created_at: '', updated_at: '',
};

/** Lớp khác: có mặt trong hệ thống nhưng app chỉ được hiển thị dữ liệu lớp đang chọn. */
const otherKlass = {
  ...klass, id: OTHER_CLASS_ID, code: OTHER_CLASS_CODE, name: 'Lớp 04A',
  bank_bin: '970418', bank_name: 'BIDV', account_no: '2099887766', account_name: 'NGUYEN QUY B',
};

export interface Sent {
  method: string;
  table: string;
  body: unknown;
}

export interface StubOptions {
  /** Vai trò TRONG LỚP. Không truyền = khách chưa đăng nhập. */
  role?: ClassRole;
  /** Tài khoản gốc của hệ thống (thấy mọi lớp, mở lớp mới). */
  systemOwner?: boolean;
  hideNamesFromGuest?: boolean;
  /** Có lớp thứ hai trong hệ thống hay không (để test bộ chọn lớp). */
  twoClasses?: boolean;
  /** Hệ thống chưa có lớp nào — trạng thái ngay sau khi cài đặt. */
  noClasses?: boolean;
}

/**
 * Cài phiên đăng nhập giả + chặn toàn bộ REST/Auth.
 * Trả về mảng `sent` ghi lại mọi lệnh ghi mà app gửi lên, để test kiểm tra nội dung.
 */
export async function stubSupabase(page: Page, opts: StubOptions = {}): Promise<Sent[]> {
  const sent: Sent[] = [];
  const signedIn = Boolean(opts.role || opts.systemOwner);
  const profile = {
    id: 'u1', email: 'nguoidung@lop.vn', full_name: 'Lê Thủ Quỹ',
    // profiles.role giờ chỉ mang nghĩa hệ thống: 'owner' hay không
    role: opts.systemOwner ? 'owner' : 'member', is_active: true,
    created_at: '', last_sign_in_at: null,
  };
  // Vai trò trong lớp nằm ở memberships, nên cùng một tài khoản có thể là thủ quỹ lớp này
  // và thành viên lớp khác. Tài khoản gốc không cần dòng nào: nó thấy mọi lớp.
  // `profiles` là bảng nhúng: useMembers đọc memberships kèm thông tin tài khoản
  const memberships = opts.role
    ? [
        {
          id: 'm1', user_id: 'u1', class_id: CLASS_ID, role: opts.role, student_id: 's2',
          created_at: '', created_by: null,
          profiles: { id: 'u1', email: 'nguoidung@lop.vn', full_name: 'Lê Thủ Quỹ', role: 'member', is_active: true, last_sign_in_at: null },
        },
        {
          // Quản trị lớp được mời bằng email nên chưa gắn với sinh viên nào — chính chỗ cần sửa
          id: 'm2', user_id: 'u2', class_id: CLASS_ID, role: 'admin', student_id: null,
          created_at: '', created_by: null,
          profiles: { id: 'u2', email: 'loptruong@lop.vn', full_name: 'Phạm Lớp Trưởng', role: 'member', is_active: true, last_sign_in_at: null },
        },
      ]
    : [];

  if (signedIn) {
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

  const toPublic = (k: typeof klass) => ({
    class_id: k.id, code: k.code, name: k.name, faculty: k.faculty, term: k.term,
    school_year: k.school_year,
    hide_student_names_from_guest: Boolean(opts.hideNamesFromGuest),
    bank_configured: true,
    student_count: k.id === CLASS_ID ? students.length : 2,
  });
  const publicClasses = opts.noClasses
    ? []
    : opts.twoClasses || opts.systemOwner
      ? [toPublic(klass), toPublic(otherKlass)]
      : [toPublic(klass)];
  const mask = (name: string) => {
    const parts = name.split(' ');
    return [parts[0], ...parts.slice(1).map((w) => `${w[0]}.`)].join(' ');
  };

  const tables: Record<string, unknown[]> = {
    app_config: [{ id: 1, student_email_domain: 'student.humg.edu.vn', student_code_pattern: '^[0-9]{8,12}$', updated_at: '' }],
    classes: opts.noClasses ? [] : opts.twoClasses || opts.systemOwner ? [klass, otherKlass] : [klass],
    /*
     * Giả lập cả RLS của bảng này: chỉ quản trị lớp đọc được membership của người khác,
     * người thường chỉ thấy dòng của chính mình. Không giả lập chỗ này thì test sẽ tưởng
     * mọi vai trò đều đọc được cả lớp.
     */
    memberships: opts.noClasses
      ? []
      : opts.role === 'admin' || opts.systemOwner
        ? memberships
        : memberships.filter((m) => m.user_id === 'u1'),
    v_classes_public: publicClasses,
    // Ban quản lý lớp: s2 (Lê Thị Thử) là thủ quỹ và có trong danh sách; một quản trị lớp
    // được mời bằng email nên không có dòng sinh viên nào.
    v_class_officers: [
      { class_id: CLASS_ID, student_id: 's2', role: 'treasurer', person_name: 'Lê Thị Thử', in_student_list: true },
      { class_id: CLASS_ID, student_id: null, role: 'admin', person_name: 'Phạm Lớp Trưởng', in_student_list: false },
    ],
    profiles: [profile],
    students,
    periods,
    v_fund_balance: balances,
    v_student_debt: debts,
    v_period_progress: [
      { class_id: CLASS_ID, period_id: 'p1', name: periods[0]!.name, fund: 'QUY_LOP', amount_per_student: 50000, status: 'OPEN', open_date: '2026-09-01', due_date: '2026-09-30', student_count: 3, collected: 80000, expected: 150000, remaining: 70000, paid_count: 1, partial_count: 1, unpaid_count: 1 },
      { class_id: CLASS_ID, period_id: 'p2', name: periods[1]!.name, fund: 'QUY_DOAN', amount_per_student: 20000, status: 'OPEN', open_date: '2026-09-01', due_date: null, student_count: 3, collected: 20000, expected: 60000, remaining: 40000, paid_count: 1, partial_count: 0, unpaid_count: 2 },
    ],
    incomes: [{ id: 'i1', class_id: CLASS_ID, date: '2026-09-03', fund: 'QUY_LOP', period_id: 'p1', student_id: 's1', payer_name: 'Trần Văn Mẫu', amount: 50000, method: 'TRANSFER', collected_by: 'Lê Thủ Quỹ', note: 'Chuyển khoản QR', batch_id: null, deleted_at: null, created_at: '', created_by: 'u1', students: { code: '2400000001', full_name: 'Trần Văn Mẫu' }, periods: { name: 'Quỹ lớp học kỳ I' } }],
    expenses: [{ id: 'e1', class_id: CLASS_ID, date: '2026-09-05', fund: 'QUY_LOP', item: 'Nước + bánh sinh hoạt lớp', category: 'Sinh hoạt', buyer: 'Phạm Minh Ví', amount: 30000, has_receipt: false, receipt_url: null, overdraft: false, note: '', deleted_at: null, created_at: '', created_by: 'u1' }],
    v_daily_ledger: [],
    audit_logs: [{ id: 1, class_id: CLASS_ID, at: new Date().toISOString(), actor_id: 'u1', actor_email: 'nguoidung@lop.vn', actor_name: 'Lê Thủ Quỹ', action: 'INSERT', table_name: 'incomes', record_id: 'i1', summary: 'Lê Thủ Quỹ đã ghi nhận thu 50.000 ₫ từ Trần Văn Mẫu vào Quỹ Lớp (chuyển khoản)', before_data: null, after_data: null, changed_fields: null, meta: null }],
    invites: [],
    v_students_public: students.map((s) => ({
      class_id: CLASS_ID, id: s.id, stt: s.stt, class_code: s.class_code,
      full_name: opts.hideNamesFromGuest ? mask(s.full_name) : s.full_name,
      code: opts.hideNamesFromGuest ? `***${s.code.slice(-3)}` : s.code,
    })),
    v_incomes_public: [{ id: 'i1', class_id: CLASS_ID, date: '2026-09-03', fund: 'QUY_LOP', period_id: 'p1', amount: 50000, method: 'TRANSFER', payer: 'Trần Văn Mẫu', period_name: 'Quỹ lớp học kỳ I' }],
    v_expenses_public: [{ id: 'e1', class_id: CLASS_ID, date: '2026-09-05', fund: 'QUY_LOP', item: 'Nước + bánh sinh hoạt lớp', category: 'Sinh hoạt', buyer: 'Phạm Minh Ví', amount: 30000, has_receipt: false, overdraft: false }],
    v_debt_public: debts,
  };

  await page.route('**/rest/v1/**', async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace('/rest/v1/', '');
    const table = path.split('?')[0] ?? '';
    const method = req.method();

    // RPC: trả về đúng hình dạng mà app đọc (create_class trả về một lớp, grant_class_role
    // trả về trạng thái cấp quyền). Vẫn ghi vào `sent` để test kiểm tra tham số đã gửi.
    if (table.startsWith('rpc/')) {
      const fn = table.slice(4);
      let body: unknown = null;
      try { body = req.postDataJSON(); } catch { body = req.postData(); }
      sent.push({ method, table, body });
      const args = (body ?? {}) as Record<string, string>;
      const result =
        fn === 'create_class'
          ? { ...klass, id: 'c-new', code: String(args.p_code ?? '').toUpperCase(), name: args.p_name || args.p_code }
          : fn === 'grant_class_role'
            ? { status: 'granted', email: args.p_email, role: args.p_role, role_before: null }
            : fn === 'import_students'
              ? { batch_id: 'b1', added: 0, updated: 0, skipped: 0, failed: 0 }
              : null;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(result) });
      return;
    }

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
    const guestBlocked = ['students', 'incomes', 'expenses', 'profiles', 'classes', 'memberships',
      'audit_logs', 'invites', 'v_student_debt', 'v_daily_ledger'];
    if (!signedIn && guestBlocked.includes(table)) {
      await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ message: 'permission denied' }) });
      return;
    }

    /*
     * Lọc theo eq.<giá trị> giống PostgREST thật. Cần thật ở chỗ này: app lọc dữ liệu theo
     * class_id, nên nếu stub bỏ qua bộ lọc thì test sẽ không phát hiện được lỗi kéo cả dữ
     * liệu lớp khác về.
     */
    let rows = (tables[table] ?? []) as Array<Record<string, unknown>>;
    for (const [key, raw] of url.searchParams) {
      if (!raw.startsWith('eq.')) continue;
      const want = raw.slice(3);
      rows = rows.filter((r) => key in r && String(r[key]) === want);
    }
    // .single()/.maybeSingle() gửi Accept đặc biệt và mong một đối tượng, không phải mảng
    const wantsObject = (req.headers()['accept'] ?? '').includes('vnd.pgrst.object+json');
    await route.fulfill({
      status: 200,
      contentType: wantsObject ? 'application/vnd.pgrst.object+json' : 'application/json',
      body: JSON.stringify(wantsObject ? rows[0] ?? null : rows),
    });
  });

  await page.route('**/auth/v1/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) }));

  return sent;
}
