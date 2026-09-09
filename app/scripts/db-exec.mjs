#!/usr/bin/env node
/**
 * Chạy một file .sql lên database Supabase bằng psql.
 *   npm run db:exec -- <file.sql> [-v key=value ...]
 *
 * Cần SUPABASE_DB_URL trong .env (connection string của database, KHÁC anon key).
 * Lấy ở Dashboard → nút Connect → tab "Session pooler" (hoặc "Direct connection") → copy URI.
 * .env đã được .gitignore nên chuỗi này không lên git.
 */
import { spawnSync } from 'node:child_process';
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
const dbUrl = process.env.SUPABASE_DB_URL || env.SUPABASE_DB_URL;
const [file, ...rest] = process.argv.slice(2);

if (!file) {
  console.error('Cách dùng: npm run db:exec -- <file.sql> [-v key=value ...]');
  process.exit(1);
}
if (!dbUrl) {
  console.error('\nThiếu SUPABASE_DB_URL trong app/.env\n');
  console.error('  Lấy ở Supabase Dashboard → nút "Connect" (thanh trên) → tab "Session pooler"');
  console.error('  → copy URI, rồi thêm vào app/.env một dòng:\n');
  console.error('    SUPABASE_DB_URL=postgresql://postgres.<ref>:<mật-khẩu-db>@aws-0-<region>.pooler.supabase.com:6543/postgres\n');
  console.error('  Mật khẩu database là mật khẩu bạn đặt khi tạo project (không phải anon key).');
  console.error('  Quên thì đặt lại ở Project Settings → Database → Reset database password.\n');
  process.exit(1);
}
const target = path.isAbsolute(file) ? file : path.join(process.cwd(), file);
if (!fs.existsSync(target)) {
  console.error(`Không thấy file: ${target}`);
  process.exit(1);
}
if (spawnSync('psql', ['--version'], { stdio: 'ignore' }).error) {
  console.error('Không có psql. Cài: sudo apt install postgresql-client');
  process.exit(1);
}

console.log(`▸ Chạy ${path.basename(target)} lên database…`);
const res = spawnSync('psql', [dbUrl, '-v', 'ON_ERROR_STOP=1', '-f', target, ...rest], { stdio: 'inherit' });
process.exit(res.status ?? 1);
