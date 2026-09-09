#!/usr/bin/env node
/**
 * Gộp các migration thành một file để dán một lần vào Supabase SQL Editor.
 *   npm run db:bundle
 * File sinh ra là bản sao — nguồn thật vẫn là supabase/migrations/*.sql.
 * Ai dùng Supabase CLI thì không cần file này (supabase db push đọc thẳng thư mục migrations).
 */
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..', '..');
const dir = path.join(root, 'supabase', 'migrations');
const out = path.join(root, 'supabase', 'setup_all.sql');

const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
const parts = [
  `-- =====================================================================================`,
  `-- setup_all.sql — GỘP TỰ ĐỘNG từ supabase/migrations/ (npm run db:bundle)`,
  `-- Đừng sửa file này; sửa trong supabase/migrations/ rồi chạy lại lệnh trên.`,
  `--`,
  `-- Cách dùng: Supabase Dashboard → SQL Editor → New query → dán toàn bộ file → Run.`,
  `-- Chạy đúng một lần cho project mới. Thành công thì SQL Editor báo "Success. No rows returned".`,
  `-- =====================================================================================`,
  '',
  ...files.flatMap((f) => [
    `-- ─────────────────────────────────────────────────────────────────────────────────────`,
    `-- ${f}`,
    `-- ─────────────────────────────────────────────────────────────────────────────────────`,
    fs.readFileSync(path.join(dir, f), 'utf8').trimEnd(),
    '',
  ]),
];
fs.writeFileSync(out, parts.join('\n') + '\n');
console.log(`Đã gộp ${files.length} migration → supabase/setup_all.sql (${files.join(', ')})`);
