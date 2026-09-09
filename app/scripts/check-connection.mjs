#!/usr/bin/env node
/**
 * Kiểm tra kết nối Supabase và xác nhận đã chạy đủ migration.
 *   npm run check
 *
 * Gọi thẳng REST API bằng anon key — đúng như trình duyệt của người dùng cuối — nên còn
 * kiểm tra được cả việc RLS đang chặn đúng chỗ, không chỉ "kết nối được hay không".
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '..');

/* ---------- đọc .env ---------- */
function readEnv() {
  for (const name of ['.env.local', '.env']) {
    const file = path.join(ROOT, name);
    if (!fs.existsSync(file)) continue;
    const env = {};
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
      if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
    return { env, name };
  }
  return { env: null, name: null };
}

const C = { g: '\x1b[32m', r: '\x1b[31m', y: '\x1b[33m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' };
let failed = 0;
const ok = (msg, extra) => console.log(`  ${C.g}✓${C.x} ${msg}${extra ? `  ${C.d}${extra}${C.x}` : ''}`);
const bad = (msg, why) => { failed++; console.log(`  ${C.r}✗${C.x} ${msg}\n      → ${why}`); };

const { env, name } = readEnv();
if (!env) {
  console.log(`\n${C.r}${C.b}Chưa có file .env${C.x}\n`);
  console.log('  Làm 2 việc:');
  console.log(`    1. ${C.b}cp .env.example .env${C.x}`);
  console.log('    2. Mở .env, điền VITE_SUPABASE_URL và VITE_SUPABASE_ANON_KEY');
  console.log(`       (Supabase Dashboard → Project Settings → API)\n`);
  process.exit(1);
}

const url = (env.VITE_SUPABASE_URL || '').replace(/\/+$/, '');
const key = env.VITE_SUPABASE_ANON_KEY || '';

console.log(`\n${C.b}Kiểm tra kết nối Supabase${C.x} ${C.d}(đọc từ ${name})${C.x}\n`);

/* ---------- 1. hình dạng cấu hình ---------- */
if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url)) {
  bad('VITE_SUPABASE_URL đúng định dạng', `nhận "${url}" — phải là https://<project-ref>.supabase.co`);
} else {
  ok('VITE_SUPABASE_URL đúng định dạng', url);
}

if (!key) {
  bad('Có VITE_SUPABASE_ANON_KEY', 'đang để trống');
} else if (key.startsWith('sb_secret_') || key.startsWith('eyJ') && /"role"\s*:\s*"service_role"/.test(
  (() => { try { return Buffer.from(key.split('.')[1] ?? '', 'base64').toString(); } catch { return ''; } })())) {
  bad('Khoá đang dùng là khoá công khai',
    'ĐANG DÙNG SECRET / SERVICE_ROLE KEY — khoá này bỏ qua toàn bộ RLS và sẽ bị nhúng vào bundle cho ai cũng đọc được. Đổi sang anon / publishable key ngay.');
} else if (key.startsWith('sb_publishable_')) {
  ok('Khoá công khai (publishable key)', `${key.slice(0, 22)}…`);
} else if (key.startsWith('eyJ')) {
  ok('Khoá công khai (anon key kiểu JWT)', `${key.slice(0, 18)}…`);
} else {
  bad('Khoá có hình dạng hợp lệ', `"${key.slice(0, 12)}…" không giống anon key hay publishable key`);
}

if (failed > 0) {
  console.log(`\n${C.r}Sửa những chỗ trên rồi chạy lại.${C.x}\n`);
  process.exit(1);
}

/* ---------- 2. gọi REST API như trình duyệt ---------- */
const rest = (p, init = {}) => fetch(`${url}/rest/v1/${p}`, {
  ...init,
  headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
});

let res;
try {
  res = await rest('v_class_public?select=*');
} catch (e) {
  bad('Kết nối được tới máy chủ', `${e.message} — kiểm tra mạng và project ref trong URL`);
  process.exit(1);
}

if (res.status === 401) {
  bad('Khoá được chấp nhận', 'máy chủ trả 401 — anon key không khớp với project này');
} else if (res.status === 404) {
  bad('Đã chạy migration', 'không tìm thấy view v_class_public ⇒ chưa chạy supabase/migrations/0001_schema.sql');
} else if (!res.ok) {
  bad('Đọc được view công khai', `HTTP ${res.status} — ${(await res.text()).slice(0, 160)}`);
} else {
  const rows = await res.json();
  ok('Kết nối được và đã chạy 0001_schema.sql', `v_class_public: ${rows.length} dòng`);
  if (rows.length === 0) {
    bad('class_settings có dòng cấu hình', 'view trả về rỗng — chạy lại 0001_schema.sql (dòng insert into class_settings)');
  } else {
    const info = rows[0];
    ok('Đọc được thông tin lớp',
      `lớp "${info.class_name || '(chưa đặt)'}" · QR ${info.bank_configured ? 'đã cấu hình' : 'chưa cấu hình'}`);
  }
}

/* ---------- 3. hàm và RPC của 0002 ---------- */
const rpc = await fetch(`${url}/rest/v1/rpc/log_event`, {
  method: 'POST',
  headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ p_action: 'LOGIN', p_summary: 'kiểm tra kết nối', p_meta: null }),
});
if (rpc.status === 404) {
  bad('Đã chạy 0002_functions.sql', 'không tìm thấy RPC log_event ⇒ chưa chạy migration 0002');
} else {
  const body = await rpc.text();
  if (/Chưa đăng nhập/.test(body) || rpc.status === 400 || rpc.status === 403 || rpc.status === 401) {
    ok('Đã chạy 0002_functions.sql', 'log_event tồn tại và chặn đúng khi chưa đăng nhập');
  } else if (rpc.ok) {
    bad('log_event chặn khách chưa đăng nhập', 'RPC chạy được bằng anon key — kiểm tra lại 0002_functions.sql');
  } else {
    ok('Đã chạy 0002_functions.sql', `log_event phản hồi HTTP ${rpc.status}`);
  }
}

/* ---------- 4. RLS của 0003 ---------- */
const secret = await rest('students?select=id&limit=1');
if (secret.status === 200) {
  const rows = await secret.json();
  if (rows.length > 0) {
    bad('RLS đang chặn bảng gốc với khách',
      'anon ĐỌC ĐƯỢC bảng students ⇒ chưa chạy 0003_rls.sql, hoặc RLS bị tắt. Đừng dùng thật khi chưa sửa.');
  } else {
    ok('RLS đang chặn bảng gốc với khách', 'students trả 0 dòng cho anon');
  }
} else if ([401, 403, 404].includes(secret.status)) {
  ok('RLS đang chặn bảng gốc với khách', `students → HTTP ${secret.status} (khách không có quyền)`);
} else {
  bad('Kiểm tra được RLS', `students → HTTP ${secret.status}`);
}

const audit = await rest('audit_logs?select=id&limit=1');
if (audit.status === 200 && (await audit.json()).length > 0) {
  bad('Khách không đọc được lịch sử thao tác', 'anon đọc được audit_logs ⇒ kiểm tra lại 0003_rls.sql');
} else {
  ok('Khách không đọc được lịch sử thao tác');
}

const periods = await rest('periods?select=id&limit=1');
if (periods.ok) ok('Khách xem được đợt thu (đúng thiết kế minh bạch)');
else bad('Khách xem được đợt thu', `HTTP ${periods.status} — kiểm tra policy periods_select_public`);

/* ---------- 5. tài khoản đầu tiên ---------- */
const profiles = await rest('profiles?select=id&limit=1');
if (profiles.status === 200 && (await profiles.json()).length > 0) {
  bad('Khách không đọc được danh sách tài khoản', 'anon đọc được profiles ⇒ kiểm tra lại 0003_rls.sql');
} else {
  ok('Khách không đọc được danh sách tài khoản');
}

console.log('');
if (failed === 0) {
  console.log(`${C.g}${C.b}Sẵn sàng.${C.x} Chạy ${C.b}npm run dev${C.x} rồi mở ${C.b}/dang-ky${C.x} —`);
  console.log(`người đăng ký ${C.b}đầu tiên${C.x} tự động thành chủ sở hữu, không cần chạy SQL tay.\n`);
} else {
  console.log(`${C.r}${C.b}${failed} chỗ cần sửa.${C.x} Xem hướng dẫn ở app/README.md, mục "Dựng lên".\n`);
  process.exit(1);
}
