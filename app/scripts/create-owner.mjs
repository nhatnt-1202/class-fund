#!/usr/bin/env node
/**
 * Tạo tài khoản đầu tiên (chủ sở hữu) mà không cần mở trình duyệt.
 *   npm run create:owner -- <email> [mật-khẩu] ["Họ và tên"]
 *
 * Chỉ gọi API đăng ký công khai bằng anon key — đúng như trang /dang-ky. Không dùng và
 * không cần service_role key. Việc "người đầu tiên thành chủ sở hữu" do trigger
 * handle_new_user() trong database quyết định, không phải script này.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '..');
const env = {};
for (const name of ['.env.local', '.env']) {
  const file = path.join(ROOT, name);
  if (!fs.existsSync(file)) continue;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m) env[m[1]] ??= m[2].trim().replace(/^["']|["']$/g, '');
  }
}
const url = (env.VITE_SUPABASE_URL || '').replace(/\/+$/, '');
const key = env.VITE_SUPABASE_ANON_KEY || '';
if (!url || !key) {
  console.error('Thiếu VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY trong .env');
  process.exit(1);
}

const [email, passArg, nameArg] = process.argv.slice(2);
if (!email || !email.includes('@')) {
  console.error('Cách dùng: npm run create:owner -- <email> [mật-khẩu] ["Họ và tên"]');
  process.exit(1);
}
/** Mật khẩu tạm sinh ngẫu nhiên khi không truyền vào — đổi ngay sau lần đăng nhập đầu. */
const password = passArg || `Ql${crypto.randomBytes(9).toString('base64url')}!`;
const fullName = nameArg || email.split('@')[0];

const api = (p, body, token) => fetch(`${url}/auth/v1/${p}`, {
  method: 'POST',
  headers: {
    apikey: key,
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  },
  body: JSON.stringify(body),
});

const signup = await api('signup', { email, password, data: { full_name: fullName } });
const out = await signup.json();

if (!signup.ok) {
  const msg = out.msg || out.error_description || out.message || JSON.stringify(out);
  console.error(`\n✗ Không tạo được tài khoản: ${msg}`);
  if (/already registered/i.test(msg)) {
    console.error('  → Email này đã có tài khoản. Đăng nhập bình thường, hoặc dùng email khác.');
  } else if (/Database error saving new user/i.test(msg)) {
    console.error('  → Trigger handle_new_user() đã chặn: hệ thống đã có tài khoản nên email mới');
    console.error('    phải được mời trước (trang Tài khoản → Mời tài khoản).');
  }
  process.exit(1);
}

const needConfirm = !out.access_token && !out.session;
console.log(`\n✓ Đã tạo tài khoản  ${email}`);
if (!passArg) console.log(`  Mật khẩu tạm:      ${password}`);
console.log(`  Họ tên:            ${fullName}`);

if (needConfirm) {
  console.log('\n⚠ Supabase đang bật "Confirm email": mở link trong hộp thư rồi mới đăng nhập được.');
  console.log('  Muốn bỏ bước này: Dashboard → Authentication → Sign In / Providers → Email → tắt Confirm email.');
  process.exit(0);
}

// Đăng nhập rồi đọc profile của chính mình để xác nhận trigger đã cấp quyền chủ sở hữu
const login = await api('token?grant_type=password', { email, password });
const session = await login.json();
if (!login.ok) {
  console.log('\n⚠ Tạo được tài khoản nhưng chưa đăng nhập thử được:', session.error_description || session.msg);
  process.exit(0);
}
const me = await fetch(`${url}/rest/v1/profiles?select=email,role,is_active&limit=1`, {
  headers: { apikey: key, Authorization: `Bearer ${session.access_token}` },
});
const rows = await me.json();
const role = Array.isArray(rows) && rows[0] ? rows[0].role : null;

if (role === 'owner') {
  console.log('  Vai trò:           chủ sở hữu (owner) ✓');
  console.log('\nĐăng nhập ở /dang-nhap, rồi vào /toi để đổi mật khẩu ngay.');
} else if (role) {
  console.log(`  Vai trò:           ${role}`);
  console.log('\n⚠ Không phải chủ sở hữu — nghĩa là hệ thống đã có tài khoản trước đó.');
} else {
  console.log('\n⚠ Chưa thấy profile cho tài khoản này. Kiểm tra lại xem đã chạy 0002_functions.sql chưa');
  console.log('  (trigger handle_new_user tạo profile khi có người đăng ký).');
}
