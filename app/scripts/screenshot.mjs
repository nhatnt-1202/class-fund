#!/usr/bin/env node
/**
 * Chụp ảnh các hộp thoại và trang chính để soi giao diện, KHÔNG cần Supabase thật.
 *   npm run build && npm run shot
 *
 * Cách làm: bơm một phiên đăng nhập giả vào localStorage và chặn mọi request /rest/v1
 * bằng dữ liệu mẫu, nên app tưởng đang đăng nhập với quyền chủ sở hữu. Không chạm tới
 * database thật. Script còn đo chiều cao từng loại control và độ lệch tâm của hộp thoại —
 * hai thứ đã từng sai mà nhìn code không thấy được.
 *
 * Cần: npx playwright install chromium (một lần).
 */
import { chromium } from 'playwright';
const OUT = process.env.SHOT_DIR || 'screenshots';
const base = process.env.SHOT_BASE || 'http://localhost:4173';
// project ref chỉ dùng để đặt đúng tên khoá localStorage của supabase-js
const REF = (process.env.VITE_SUPABASE_URL || 'https://demo.supabase.co').split('//')[1].split('.')[0];

/* ---------- dữ liệu giả ---------- */
const students = [
  { id: 's1', stt: 1, code: '2400000001', last_name: 'Trần Văn', first_name: 'Mẫu', full_name: 'Trần Văn Mẫu', dob: '2005-01-15', class_code: 'DCXDXD69_03B', note: '', is_active: true, batch_id: null, deleted_at: null, created_at: '', created_by: null },
  { id: 's2', stt: 2, code: '2400000002', last_name: 'Lê Thị', first_name: 'Thử', full_name: 'Lê Thị Thử', dob: '2005-02-20', class_code: 'DCXDXD69_03B', note: '', is_active: true, batch_id: null, deleted_at: null, created_at: '', created_by: null },
  { id: 's3', stt: 3, code: '2400000003', last_name: 'Phạm Minh', first_name: 'Ví', full_name: 'Phạm Minh Ví', dob: '2005-03-25', class_code: 'DCXDXD69_03B', note: '', is_active: true, batch_id: null, deleted_at: null, created_at: '', created_by: null },
];
const periods = [
  { id: 'p1', name: 'Quỹ lớp học kỳ I 2026-2027', fund: 'QUY_LOP', amount_per_student: 50000, open_date: '2026-09-01', due_date: '2026-09-30', status: 'OPEN', note: '', deleted_at: null, created_at: '', created_by: null },
  { id: 'p2', name: 'Quỹ Đoàn học kỳ I 2026-2027', fund: 'QUY_DOAN', amount_per_student: 20000, open_date: '2026-09-01', due_date: null, status: 'OPEN', note: '', deleted_at: null, created_at: '', created_by: null },
];
const fixtures = {
  'v_class_public': [{ class_name: 'DCXDXD69_03B', faculty: 'Xây dựng', term: 'Học kỳ I', school_year: '2026-2027', hide_student_names_from_guest: false, bank_configured: true }],
  'class_settings': [{ id: 1, class_name: 'DCXDXD69_03B', faculty: 'Xây dựng', term: 'Học kỳ I', school_year: '2026-2027', categories: ['Sinh hoạt','Sự kiện','Văn phòng phẩm','Quà tặng','In ấn','Khác'], hide_student_names_from_guest: false, bank_bin: '970436', bank_name: 'Vietcombank', account_no: '1021234567', account_name: 'LE THU QUY', note_template: '{ma} {dot}', updated_at: '' }],
  'profiles': [{ id: 'u1', email: 'thuquy@lop.vn', full_name: 'Lê Thủ Quỹ', role: 'owner', is_active: true, student_id: null, created_at: '', last_sign_in_at: null }],
  'students': students,
  'periods': periods,
  'v_fund_balance': [
    { fund: 'QUY_LOP', total_income: 80000, total_expense: 30000, balance: 50000 },
    { fund: 'QUY_DOAN', total_income: 20000, total_expense: 0, balance: 20000 },
  ],
  'v_student_debt': [
    { student_id: 's1', code: '2400000001', full_name: 'Trần Văn Mẫu', period_id: 'p1', period_name: periods[0].name, fund: 'QUY_LOP', must_pay: 50000, paid: 50000, remaining: 0 },
    { student_id: 's2', code: '2400000002', full_name: 'Lê Thị Thử', period_id: 'p1', period_name: periods[0].name, fund: 'QUY_LOP', must_pay: 50000, paid: 30000, remaining: 20000 },
    { student_id: 's3', code: '2400000003', full_name: 'Phạm Minh Ví', period_id: 'p1', period_name: periods[0].name, fund: 'QUY_LOP', must_pay: 50000, paid: 0, remaining: 50000 },
  ],
  'v_period_progress': [{ period_id: 'p1', name: periods[0].name, fund: 'QUY_LOP', amount_per_student: 50000, status: 'OPEN', open_date: '2026-09-01', due_date: '2026-09-30', student_count: 3, collected: 80000, expected: 150000, remaining: 70000, paid_count: 1, partial_count: 1, unpaid_count: 1 }],
  'incomes': [{ id: 'i1', date: '2026-09-03', fund: 'QUY_LOP', period_id: 'p1', student_id: 's1', payer_name: 'Trần Văn Mẫu', amount: 50000, method: 'TRANSFER', collected_by: 'Lê Thủ Quỹ', note: 'Chuyển khoản QR', batch_id: null, deleted_at: null, created_at: '', created_by: null, students: { code: '2400000001', full_name: 'Trần Văn Mẫu' }, periods: { name: periods[0].name } }],
  'expenses': [{ id: 'e1', date: '2026-09-05', fund: 'QUY_LOP', item: 'Nước + bánh sinh hoạt lớp', category: 'Sinh hoạt', buyer: 'Phạm Minh Ví', amount: 30000, has_receipt: false, receipt_url: null, overdraft: false, note: '', deleted_at: null, created_at: '', created_by: null }],
  'v_daily_ledger': [], 'audit_logs': [], 'invites': [],
  'v_students_public': students, 'v_incomes_public': [], 'v_expenses_public': [], 'v_debt_public': [],
};

await (await import('node:fs/promises')).mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 940 }, colorScheme: 'dark' });

// Giả lập phiên đăng nhập: supabase-js đọc session từ localStorage theo khoá sb-<ref>-auth-token
await ctx.addInitScript(([ref]) => {
  const user = { id: 'u1', email: 'thuquy@lop.vn', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: { full_name: 'Lê Thủ Quỹ' }, created_at: '2026-01-01T00:00:00Z' };
  localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify({
    access_token: 'fake.jwt.token', token_type: 'bearer', refresh_token: 'fake-refresh',
    expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user,
  }));
}, [REF]);

const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).slice(0, 160)));

await page.route('**/rest/v1/**', async (route) => {
  const path = new URL(route.request().url()).pathname.replace('/rest/v1/', '').split('?')[0];
  const body = fixtures[path] ?? [];
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
});
await page.route('**/auth/v1/**', (route) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) }));

const shots = [
  ['thu', 'Thêm thu', 'income-dialog'],
  ['chi', 'Thêm chi', 'expense-dialog'],
  ['dot-thu', 'Tạo đợt thu', 'period-dialog'],
];
for (const [path, btn, name] of shots) {
  await page.goto(`${base}/${path}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  const b = page.getByRole('button', { name: btn }).first();
  if (await b.count() === 0) { console.log(`✗ không thấy nút "${btn}" ở /${path}`); continue; }
  await b.click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/${name}.png` });

  const m = await page.evaluate(() => {
    const dlg = document.querySelector('[role="dialog"]');
    if (!dlg) return null;
    const r = dlg.getBoundingClientRect();
    const hs = {};
    for (const el of dlg.querySelectorAll('input, select')) {
      if (['checkbox', 'radio'].includes(el.type)) continue;
      const k = el.tagName === 'SELECT' ? 'select' : `input[${el.type || 'text'}]`;
      (hs[k] ??= new Set()).add(Math.round(el.getBoundingClientRect().height));
    }
    return {
      lechNgang: Math.round((r.left + r.width / 2) - innerWidth / 2),
      lechDoc: Math.round((r.top + r.height / 2) - innerHeight / 2),
      cao: Object.fromEntries(Object.entries(hs).map(([k, v]) => [k, [...v]])),
    };
  });
  console.log(`${name}: lệch giữa ngang ${m.lechNgang}px, dọc ${m.lechDoc}px · chiều cao ${JSON.stringify(m.cao)}`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
}
if (errs.length) console.log('lỗi runtime:', errs.slice(0, 3));
else console.log('không có lỗi runtime');
await browser.close();
