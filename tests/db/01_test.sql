-- =====================================================================================
-- Kiểm thử DB: nhiều lớp, cách ly dữ liệu giữa các lớp, RLS, guard nghiệp vụ, audit, RPC.
-- Chạy: bash tests/db/run.sh   (fail-fast: sai một phép là dừng và trả mã lỗi)
-- =====================================================================================
\set ON_ERROR_STOP on
\set QUIET on
\pset pager off
set client_min_messages to notice;

create or replace function assert(cond boolean, msg text) returns void
language plpgsql as $q$
begin
  if not cond then raise exception 'FAIL: %', msg; end if;
  raise notice '  PASS  %', msg;
end $q$;

/** Dùng cho những thao tác BẮT BUỘC phải bị chặn bằng lỗi. */
create or replace function assert_blocked(stmt text, msg text) returns void
language plpgsql as $q$
begin
  begin
    execute stmt;
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
    raise notice '  PASS  % [bị chặn: %]', msg, left(replace(sqlerrm, E'\n', ' '), 66);
    return;
  end;
  raise exception 'FAIL: % — lẽ ra phải bị chặn nhưng lại thành công', msg;
end $q$;

/**
 * Dùng cho UPDATE/DELETE bị RLS chặn: policy không khớp thì Postgres KHÔNG báo lỗi, nó chỉ
 * không thấy dòng nào ⇒ 0 dòng bị sửa. Chấp nhận cả "bị lỗi" và "0 dòng", thất bại nếu có
 * dòng bị sửa. (Hệ quả cho frontend: sau update phải kiểm tra số dòng trả về.)
 */
create or replace function assert_noop(stmt text, msg text) returns void
language plpgsql as $q$
declare n integer;
begin
  begin
    execute stmt;
    get diagnostics n = row_count;
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
    raise notice '  PASS  % [bị chặn: %]', msg, left(replace(sqlerrm, E'\n', ' '), 60);
    return;
  end;
  if n = 0 then raise notice '  PASS  % [RLS lọc hết, 0 dòng bị sửa]', msg;
  else raise exception 'FAIL: % — đã sửa được % dòng', msg, n;
  end if;
end $q$;

grant execute on function assert(boolean, text), assert_blocked(text, text),
                          assert_noop(text, text) to anon, authenticated;

\echo ''
\echo '=== 1. Người đăng ký đầu tiên là chủ sở hữu hệ thống ==='
insert into auth.users (email, raw_user_meta_data)
  values ('chusohuu@lop.vn', '{"full_name":"Nguyễn Chủ Sở Hữu"}');
select assert((select role from profiles where email = 'chusohuu@lop.vn') = 'owner',
  'Người đăng ký đầu tiên tự động thành chủ sở hữu hệ thống');
select assert(is_system_owner() is not null, 'Hàm is_system_owner() tồn tại');
select format('{"sub":"%s"}', id) as owner_jwt from profiles where email = 'chusohuu@lop.vn' \gset

\echo ''
\echo '=== 2. Tạo hai lớp ==='
begin;
  set local role authenticated;
  set local request.jwt.claims to :'owner_jwt';
  select assert((create_class('DCXDXD69_03B', 'Lớp 03B', 'Xây dựng', 'Học kỳ I', '2026-2027')).code = 'DCXDXD69_03B',
    'Tạo được lớp A và người tạo thành quản trị lớp');
  select assert((create_class('DCXDXD69_04A', 'Lớp 04A', 'Xây dựng', 'Học kỳ I', '2026-2027')).code = 'DCXDXD69_04A',
    'Tạo được lớp B');
  select assert_blocked($q$select create_class('', 'Thiếu mã')$q$, 'Mã lớp trống bị chặn');
commit;
select id as class_a from classes where code = 'DCXDXD69_03B' \gset
select id as class_b from classes where code = 'DCXDXD69_04A' \gset
select assert((select count(*) from classes) = 3, 'Có 3 lớp: 1 chuyển từ dữ liệu cũ + 2 mới tạo');

\echo ''
\echo '=== 3. Nhập danh sách sinh viên cho từng lớp ==='
begin;
  set local role authenticated;
  set local request.jwt.claims to :'owner_jwt';
  select assert((import_students(:'class_a'::uuid, $q$[
      {"stt":1,"code":"2421070527","last_name":"Trần Văn","first_name":"Mẫu","dob":"2005-01-15"},
      {"stt":2,"code":"2421070528","last_name":"Lê Thị","first_name":"Thử","dob":"2005-02-20"}
    ]$q$::jsonb, 'skip')->>'added')::int = 2, 'Nhập 2 sinh viên vào lớp A');
  select assert((import_students(:'class_b'::uuid, $q$[
      {"stt":1,"code":"2421070999","last_name":"Phạm Minh","first_name":"Ví","dob":"2005-03-25"}
    ]$q$::jsonb, 'skip')->>'added')::int = 1, 'Nhập 1 sinh viên vào lớp B');
commit;
select assert((select count(*) from students where class_id = :'class_a') = 2, 'Lớp A có 2 sinh viên');
select assert((select count(*) from students where class_id = :'class_b') = 1, 'Lớp B có 1 sinh viên');
-- cùng một mã SV được phép tồn tại ở hai lớp khác nhau (học lại, chuyển lớp)
begin;
  set local role authenticated;
  set local request.jwt.claims to :'owner_jwt';
  select assert((import_students(:'class_b'::uuid,
      $q$[{"code":"2421070527","last_name":"Trần Văn","first_name":"Mẫu"}]$q$::jsonb, 'skip')->>'added')::int = 1,
    'Mã SV trùng nhau giữa hai lớp vẫn nhập được (unique theo từng lớp)');
commit;

\echo ''
\echo '=== 4. Đăng ký TỰ DO bằng email trường ==='
select assert(student_code_from_email('2421070527@student.humg.edu.vn') = '2421070527',
  'Tách được mã SV từ email trường');
select assert(student_code_from_email('2421070527@gmail.com') is null,
  'Email ngoài domain trường không tách được mã');
select assert(student_code_from_email('abc@student.humg.edu.vn') is null,
  'Phần trước @ không phải mã SV thì không hợp lệ');

insert into auth.users (email, raw_user_meta_data)
  values ('2421070527@student.humg.edu.vn', '{"full_name":"Trần Văn Mẫu"}');
select assert((select role from profiles where email = '2421070527@student.humg.edu.vn') = 'member',
  'Email trường đăng ký được ngay, không cần lời mời');
select assert((select count(*) from memberships m join profiles p on p.id = m.user_id
               where p.email = '2421070527@student.humg.edu.vn') = 2,
  'Mã SV có ở 2 lớp ⇒ được gắn vào cả 2 lớp');
select assert((select m.student_id is not null from memberships m join profiles p on p.id = m.user_id
               where p.email = '2421070527@student.humg.edu.vn' and m.class_id = :'class_a'),
  'Membership được gắn đúng bản ghi sinh viên trong lớp');
select assert((select count(*) from memberships m join profiles p on p.id = m.user_id
               where p.email = '2421070527@student.humg.edu.vn' and m.role = 'member') = 2,
  'Sinh viên tự đăng ký chỉ có vai trò thành viên');

-- đăng ký TRƯỚC khi lớp có danh sách: tài khoản vẫn tạo được, và tự vào lớp khi nhập danh sách
insert into auth.users (email, raw_user_meta_data)
  values ('2421079999@student.humg.edu.vn', '{"full_name":"Đăng Ký Sớm"}');
select assert((select count(*) from memberships m join profiles p on p.id = m.user_id
               where p.email = '2421079999@student.humg.edu.vn') = 0,
  'Chưa lớp nào có mã này ⇒ chưa thuộc lớp nào');
begin;
  set local role authenticated;
  set local request.jwt.claims to :'owner_jwt';
  select import_students(:'class_a'::uuid,
    $q$[{"code":"2421079999","last_name":"Đăng Ký","first_name":"Sớm"}]$q$::jsonb, 'skip');
commit;
select assert((select count(*) from memberships m join profiles p on p.id = m.user_id
               where p.email = '2421079999@student.humg.edu.vn' and m.class_id = :'class_a') = 1,
  'Nhập danh sách sau đó ⇒ tài khoản tự được gắn vào lớp');

select assert_blocked($q$insert into auth.users (email) values ('nguoila@gmail.com')$q$,
  'Email không đúng dạng email trường và không có lời mời thì bị chặn');

\echo ''
\echo '=== 5. Mời người ngoài (giáo viên) vào một lớp cụ thể ==='
begin;
  set local role authenticated;
  set local request.jwt.claims to :'owner_jwt';
  insert into invites (email, role, class_id) values ('thuquy@lop.vn', 'treasurer', :'class_a');
  insert into invites (email, role, class_id) values ('quantri.b@lop.vn', 'admin', :'class_b');
commit;
insert into auth.users (email, raw_user_meta_data) values ('thuquy@lop.vn', '{"full_name":"Lê Thủ Quỹ"}');
insert into auth.users (email, raw_user_meta_data) values ('quantri.b@lop.vn', '{"full_name":"Trần Quản Trị B"}');
select assert((select m.role from memberships m join profiles p on p.id = m.user_id
               where p.email = 'thuquy@lop.vn') = 'treasurer', 'Lời mời thủ quỹ ⇒ vai trò treasurer trong lớp A');
select assert((select m.class_id from memberships m join profiles p on p.id = m.user_id
               where p.email = 'quantri.b@lop.vn') = :'class_b'::uuid, 'Quản trị B chỉ thuộc lớp B');

select format('{"sub":"%s"}', id) as tq_jwt from profiles where email = 'thuquy@lop.vn' \gset
select format('{"sub":"%s"}', id) as qtb_jwt from profiles where email = 'quantri.b@lop.vn' \gset
select format('{"sub":"%s"}', id) as sv_jwt from profiles where email = '2421070527@student.humg.edu.vn' \gset

\echo ''
\echo '=== 6. Thủ quỹ lớp A ghi thu chi trong lớp mình ==='
begin;
  set local role authenticated;
  set local request.jwt.claims to :'owner_jwt';
  insert into periods (class_id, name, fund, amount_per_student, open_date)
    values (:'class_a', 'Quỹ lớp A HK1', 'QUY_LOP', 50000, '2026-09-01'),
           (:'class_a', 'Quỹ Đoàn A HK1', 'QUY_DOAN', 20000, '2026-09-01'),
           (:'class_b', 'Quỹ lớp B HK1', 'QUY_LOP', 70000, '2026-09-01');
commit;
select id as pa_lop  from periods where class_id = :'class_a' and fund = 'QUY_LOP' \gset
select id as pa_doan from periods where class_id = :'class_a' and fund = 'QUY_DOAN' \gset
select id as pb_lop  from periods where class_id = :'class_b' and fund = 'QUY_LOP' \gset
select id as sa1 from students where class_id = :'class_a' and code = '2421070527' \gset
select id as sb1 from students where class_id = :'class_b' and code = '2421070999' \gset

begin;
  set local role authenticated;
  set local request.jwt.claims to :'tq_jwt';
  insert into incomes (class_id, date, fund, period_id, student_id, amount, method)
    values (:'class_a', '2026-09-03', 'QUY_LOP', :'pa_lop', :'sa1', 50000, 'TRANSFER');
  insert into incomes (class_id, date, fund, period_id, student_id, amount, method)
    values (:'class_a', '2026-09-04', 'QUY_DOAN', :'pa_doan', :'sa1', 20000, 'CASH');
  insert into expenses (class_id, date, fund, item, category, buyer, amount)
    values (:'class_a', '2026-09-05', 'QUY_LOP', 'Nước sinh hoạt lớp', 'Sinh hoạt', 'Lê Thủ Quỹ', 30000);
  select assert(true, 'Thủ quỹ lớp A ghi được 2 khoản thu + 1 khoản chi');

  select assert_blocked(
    format($q$insert into incomes (class_id, date, fund, period_id, student_id, amount)
              values ('%s','2026-09-05','QUY_DOAN','%s','%s',10000)$q$, :'class_a', :'pa_lop', :'sa1'),
    'Ghi thu Quỹ Đoàn vào đợt của Quỹ Lớp bị chặn');
  -- CHÉO LỚP: dùng đợt thu của lớp B cho khoản thu của lớp A
  select assert_blocked(
    format($q$insert into incomes (class_id, date, fund, period_id, student_id, amount)
              values ('%s','2026-09-05','QUY_LOP','%s','%s',10000)$q$, :'class_a', :'pb_lop', :'sa1'),
    'Không ghi được khoản thu dùng đợt thu của lớp khác');
  -- CHÉO LỚP: gán sinh viên lớp B vào khoản thu của lớp A
  select assert_blocked(
    format($q$insert into incomes (class_id, date, fund, period_id, student_id, amount)
              values ('%s','2026-09-05','QUY_LOP','%s','%s',10000)$q$, :'class_a', :'pa_lop', :'sb1'),
    'Không ghi được khoản thu gán sinh viên của lớp khác');
commit;

\echo ''
\echo '=== 7. CÁCH LY GIỮA CÁC LỚP (phần quan trọng nhất) ==='
begin;
  set local role authenticated;
  set local request.jwt.claims to :'tq_jwt';       -- thủ quỹ lớp A
  select assert((select count(*) from students) = 3, 'Thủ quỹ A chỉ thấy 3 sinh viên của lớp A');
  select assert((select count(*) from students where class_id = :'class_b') = 0,
    'Thủ quỹ A KHÔNG thấy sinh viên nào của lớp B');
  select assert((select count(*) from incomes where class_id = :'class_b') = 0,
    'Thủ quỹ A KHÔNG thấy khoản thu của lớp B');
  select assert((select count(*) from classes) = 1, 'Thủ quỹ A chỉ thấy đúng lớp A trong danh sách lớp');
  select assert_blocked(
    format($q$insert into incomes (class_id, date, fund, amount, payer_name)
              values ('%s','2026-09-06','QUY_LOP',50000,'Ai đó')$q$, :'class_b'),
    'Thủ quỹ A KHÔNG ghi được khoản thu vào lớp B');
  select assert_blocked(
    format($q$insert into students (class_id, code, last_name, first_name) values ('%s','999','Chèn','Lậu')$q$, :'class_b'),
    'Thủ quỹ A KHÔNG thêm được sinh viên vào lớp B');
  select assert_noop(format($q$update classes set name = 'Bị đổi tên' where id = '%s'$q$, :'class_b'),
    'Thủ quỹ A KHÔNG sửa được thông tin lớp B');
  select assert_noop(format($q$update students set is_active = false where class_id = '%s'$q$, :'class_b'),
    'Thủ quỹ A KHÔNG sửa được sinh viên lớp B');
commit;

begin;
  set local role authenticated;
  set local request.jwt.claims to :'qtb_jwt';      -- quản trị lớp B
  select assert((select count(*) from students) = 2, 'Quản trị B chỉ thấy 2 sinh viên của lớp B');
  select assert((select count(*) from incomes) = 0, 'Quản trị B không thấy khoản thu nào (lớp B chưa thu)');
  select assert_noop(format($q$update periods set amount_per_student = 1 where class_id = '%s'$q$, :'class_a'),
    'Quản trị B KHÔNG sửa được đợt thu của lớp A');
  insert into periods (class_id, name, fund, amount_per_student, open_date)
    values (:'class_b', 'Quỹ Đoàn B', 'QUY_DOAN', 15000, '2026-09-01');
  select assert(true, 'Quản trị B tạo được đợt thu trong lớp mình');
commit;

begin;
  set local role authenticated;
  set local request.jwt.claims to :'sv_jwt';       -- sinh viên, thuộc CẢ HAI lớp
  select assert((select count(*) from classes) = 2, 'Sinh viên có mã ở 2 lớp thì thấy đúng 2 lớp');
  select assert((select count(*) from students) = 5, 'Sinh viên thấy danh sách của cả hai lớp mình thuộc');
  select assert_blocked(
    format($q$insert into incomes (class_id, date, fund, amount, payer_name)
              values ('%s','2026-09-06','QUY_LOP',10000,'Tự ghi')$q$, :'class_a'),
    'Sinh viên KHÔNG ghi được khoản thu');
  select assert_noop($q$update expenses set amount = 1 where true$q$, 'Sinh viên KHÔNG sửa được khoản chi');
commit;

\echo ''
\echo '=== 8. Tồn quỹ tính riêng theo từng lớp ==='
select assert((select balance from v_fund_balance where class_id = :'class_a' and fund = 'QUY_LOP') = 20000,
  'Lớp A · Quỹ Lớp = 50.000 thu − 30.000 chi = 20.000');
select assert((select balance from v_fund_balance where class_id = :'class_a' and fund = 'QUY_DOAN') = 20000,
  'Lớp A · Quỹ Đoàn = 20.000, không bị khoản chi của Quỹ Lớp ảnh hưởng');
select assert((select balance from v_fund_balance where class_id = :'class_b' and fund = 'QUY_LOP') = 0,
  'Lớp B · Quỹ Lớp = 0 — tiền của lớp A không lẫn sang lớp B');
select assert((select remaining from v_student_debt
               where class_id = :'class_a' and student_id = :'sa1' and period_id = :'pa_lop') = 0,
  'Công nợ: sinh viên đã nộp đủ đợt Quỹ Lớp của lớp A');
select assert((select expected from v_period_progress where period_id = :'pb_lop') = 140000,
  'Tiến độ lớp B: 2 SV × 70.000 = 140.000 (không tính SV lớp A)');
select assert((select count(*) from v_student_debt where class_id = :'class_b') = 4,
  'Công nợ lớp B chỉ gồm SV của lớp B × đợt của lớp B');

\echo ''
\echo '=== 9. Khách chưa đăng nhập ==='
begin;
  set local role anon;
  select assert((select count(*) from v_classes_public) >= 2, 'Khách xem được danh sách lớp để tìm lớp mình');
  select assert((select student_count from v_classes_public where code = 'DCXDXD69_03B') = 3,
    'Danh sách lớp công khai có số sinh viên');
  select assert((select count(*) from v_incomes_public where class_id = :'class_a') = 2,
    'Khách xem được các khoản thu của một lớp qua view công khai');
  select assert((select balance from v_fund_balance where class_id = :'class_a' and fund = 'QUY_LOP') = 20000,
    'Khách xem được tồn quỹ của lớp');
  select assert_blocked($q$select count(*) from students$q$,   'Khách KHÔNG đọc được bảng students gốc');
  select assert_blocked($q$select count(*) from incomes$q$,    'Khách KHÔNG đọc được bảng incomes gốc');
  select assert_blocked($q$select count(*) from audit_logs$q$, 'Khách KHÔNG đọc được audit log');
  select assert_blocked($q$select count(*) from memberships$q$,'Khách KHÔNG đọc được danh sách thành viên lớp');
  select assert_blocked($q$select account_no from classes$q$,  'Khách KHÔNG đọc được số tài khoản của lớp');
  select assert((select bank_configured from v_classes_public where code = 'DCXDXD69_03B') is not null,
    'Khách biết lớp đã cấu hình QR hay chưa');
commit;
select assert((select count(*) = 0 from information_schema.columns
               where table_name = 'v_students_public' and column_name = 'dob'),
  'View công khai không có cột ngày sinh');

\echo ''
\echo '=== 10. Xoá mềm theo vai trò trong lớp ==='
begin;
  set local role authenticated;
  set local request.jwt.claims to :'owner_jwt';
  insert into expenses (class_id, date, fund, item, category, buyer, amount)
    values (:'class_a', '2026-09-06', 'QUY_LOP', 'Khoản chi của quản trị', 'Khác', 'Quản trị', 5000);
commit;
begin;
  set local role authenticated;
  set local request.jwt.claims to :'tq_jwt';
  select assert_blocked($q$update expenses set deleted_at = now() where item = 'Khoản chi của quản trị'$q$,
    'Thủ quỹ KHÔNG xoá được bản ghi của người khác');
  update expenses set deleted_at = now() where item = 'Nước sinh hoạt lớp';
  select assert((select deleted_at is not null from expenses where item = 'Nước sinh hoạt lớp'),
    'Thủ quỹ xoá được bản ghi của chính mình trong 24h');
commit;
select assert((select balance from v_fund_balance where class_id = :'class_a' and fund = 'QUY_LOP') = 45000,
  'Xoá mềm 30.000 ⇒ tồn quỹ lớp A tự tính lại thành 45.000');
update expenses set deleted_at = null, created_at = now() - interval '2 days' where item = 'Nước sinh hoạt lớp';
begin;
  set local role authenticated;
  set local request.jwt.claims to :'tq_jwt';
  select assert_blocked($q$update expenses set deleted_at = now() where item = 'Nước sinh hoạt lớp'$q$,
    'Quá 24h thủ quỹ KHÔNG xoá được nữa');
commit;
-- quản trị xoá mềm một bản ghi để kiểm tra quyền PHỤC HỒI (phải có bản ghi đang bị xoá thật,
-- gán deleted_at = null lên bản ghi chưa xoá thì guard không kích hoạt)
begin;
  set local role authenticated;
  set local request.jwt.claims to :'owner_jwt';
  update expenses set deleted_at = now() where item = 'Khoản chi của quản trị';
  select assert((select deleted_at is not null from expenses where item = 'Khoản chi của quản trị'),
    'Quản trị lớp xoá được bản ghi của người khác');
commit;
begin;
  set local role authenticated;
  set local request.jwt.claims to :'tq_jwt';
  select assert_blocked($q$update expenses set deleted_at = null where item = 'Khoản chi của quản trị'$q$,
    'Thủ quỹ KHÔNG phục hồi được bản ghi đã xoá');
commit;
begin;
  set local role authenticated;
  set local request.jwt.claims to :'owner_jwt';
  update expenses set deleted_at = null where item = 'Khoản chi của quản trị';
  select assert((select deleted_at is null from expenses where item = 'Khoản chi của quản trị'),
    'Quản trị lớp phục hồi được bản ghi đã xoá');
commit;

\echo ''
\echo '=== 11. Không làm mất dấu tiền ==='
begin;
  set local role authenticated;
  set local request.jwt.claims to :'owner_jwt';
  select assert_blocked(format($q$update periods set deleted_at = now() where id = '%s'$q$, :'pa_lop'),
    'Đợt thu đã có khoản thu KHÔNG xoá được');
  select assert_blocked(format($q$update periods set fund = 'QUY_DOAN' where id = '%s'$q$, :'pa_lop'),
    'Đợt thu đã có khoản thu KHÔNG đổi được quỹ');
  select assert_blocked(format($q$update students set deleted_at = now() where id = '%s'$q$, :'sa1'),
    'Sinh viên đã có khoản thu KHÔNG xoá được');
commit;

\echo ''
\echo '=== 12. Quản lý thành viên lớp ==='
begin;
  set local role authenticated;
  set local request.jwt.claims to :'owner_jwt';
  update memberships set role = 'treasurer'
    where class_id = :'class_a' and user_id = (select id from profiles where email = '2421070527@student.humg.edu.vn');
  select assert((select role from memberships where class_id = :'class_a'
                 and user_id = (select id from profiles where email = '2421070527@student.humg.edu.vn')) = 'treasurer',
    'Quản trị lớp nâng được sinh viên lên thủ quỹ');
  update memberships set role = 'member'
    where class_id = :'class_a' and user_id = (select id from profiles where email = '2421070527@student.humg.edu.vn');
commit;
begin;
  set local role authenticated;
  set local request.jwt.claims to :'tq_jwt';
  select assert_noop(format($q$update memberships set role = 'admin' where class_id = '%s' and user_id = (select id from profiles where email = 'thuquy@lop.vn')$q$, :'class_a'),
    'Thủ quỹ KHÔNG tự nâng mình lên quản trị');
  select assert_blocked(format($q$insert into memberships (user_id, class_id, role) values ((select id from profiles where email = 'thuquy@lop.vn'), '%s', 'admin')$q$, :'class_b'),
    'Thủ quỹ KHÔNG tự thêm mình vào lớp khác');
commit;
begin;
  set local role authenticated;
  set local request.jwt.claims to :'qtb_jwt';
  select assert_blocked($q$update memberships set role = 'member' where user_id = (select id from profiles where email = 'quantri.b@lop.vn')$q$,
    'Không ai tự đổi vai trò của chính mình trong lớp');
commit;

\echo ''
\echo '=== 13. Audit log theo lớp, bất biến ==='
select assert((select count(*) from audit_logs) >= 20, 'Mọi thao tác ghi đều để lại vết');
select assert(exists (select 1 from audit_logs where class_id = :'class_a'
  and summary like '%Lê Thủ Quỹ đã ghi nhận thu 50.000 ₫%'), 'Diễn giải tiếng Việt kèm số tiền, gắn đúng lớp');
select assert(exists (select 1 from audit_logs where action = 'INSERT' and table_name = 'profiles'
  and summary like '%đăng ký bằng email trường và được gắn vào 2 lớp%'), 'Ghi log việc tự đăng ký bằng email trường');
begin;
  set local role authenticated;
  set local request.jwt.claims to :'qtb_jwt';
  select assert((select count(*) from audit_logs where class_id = :'class_a') = 0,
    'Quản trị lớp B KHÔNG xem được audit log của lớp A');
commit;
-- 0010: log là công cụ giám sát ⇒ chỉ tài khoản gốc và quản trị lớp đọc được
begin;
  set local role authenticated;
  set local request.jwt.claims to :'tq_jwt';
  select assert((select count(*) from audit_logs) = 0,
    'Thủ quỹ KHÔNG đọc được lịch sử thao tác, kể cả log của lớp mình');
  select assert((select count(*) from audit_logs where actor_id = (select id from profiles where email = 'thuquy@lop.vn')) = 0,
    'Kể cả log do CHÍNH MÌNH gây ra cũng không đọc được');
commit;
begin;
  set local role authenticated;
  set local request.jwt.claims to :'sv_jwt';
  select assert((select count(*) from audit_logs) = 0, 'Sinh viên KHÔNG đọc được lịch sử thao tác');
commit;
begin;
  set local role authenticated;
  set local request.jwt.claims to :'qtb_jwt';
  select assert((select count(*) from audit_logs where class_id = :'class_b') > 0,
    'Quản trị lớp vẫn đọc được lịch sử của lớp mình');
commit;
begin;
  set local role authenticated;
  set local request.jwt.claims to :'owner_jwt';
  select assert_noop($q$update audit_logs set summary = 'sửa lịch sử' where id = 1$q$,
    'Chủ sở hữu cũng KHÔNG sửa được audit log');
  select assert_blocked($q$delete from audit_logs where id = 1$q$, 'Chủ sở hữu cũng KHÔNG xoá được audit log');
commit;

\echo ''
\echo '=== 14. RPC theo lớp ==='
begin;
  set local role authenticated;
  set local request.jwt.claims to :'tq_jwt';
  select log_event('LOGIN', 'Lê Thủ Quỹ đã đăng nhập', null, :'class_a');
  select assert((select last_sign_in_at is not null from profiles where email = 'thuquy@lop.vn'),
    'log_event(LOGIN) cập nhật lần đăng nhập gần nhất');
  select assert_blocked(format($q$select log_event('EXPORT','thử ghi log lớp khác', null, '%s')$q$, :'class_b'),
    'Không ghi được log gắn vào lớp mình không thuộc');
  select assert_blocked(format($q$select import_students('%s', '[]'::jsonb, 'skip')$q$, :'class_b'),
    'Thủ quỹ lớp A KHÔNG gọi được import_students cho lớp B');
commit;
begin;
  set local role authenticated;
  set local request.jwt.claims to :'sv_jwt';
  select assert_blocked(format($q$select import_students('%s', '[]'::jsonb, 'skip')$q$, :'class_a'),
    'Sinh viên KHÔNG gọi được import_students');
commit;

\echo ''
\echo '=== 15. Cấu hình lớp và che tên với khách ==='
begin;
  set local role authenticated;
  set local request.jwt.claims to :'tq_jwt';
  select assert_noop(format($q$update classes set account_no = '999' where id = '%s'$q$, :'class_a'),
    'Thủ quỹ KHÔNG sửa được tài khoản nhận tiền của lớp');
commit;
begin;
  set local role authenticated;
  set local request.jwt.claims to :'owner_jwt';
  update classes set bank_bin = '970436', bank_name = 'Vietcombank', account_no = '1021234567',
    account_name = 'LE THU QUY', hide_student_names_from_guest = true where id = :'class_a';
  select assert((select account_no from classes where id = :'class_a') = '1021234567',
    'Quản trị lớp lưu được tài khoản nhận tiền');
  select assert_blocked(format($q$update classes set bank_bin = '97043' where id = '%s'$q$, :'class_a'),
    'Mã BIN sai định dạng bị chặn ở tầng DB');
commit;
begin;
  set local role anon;
  select assert((select full_name from v_students_public where class_id = :'class_a' and code like '%527') = 'Trần V. M.',
    'Bật che tên ⇒ khách chỉ thấy tên viết tắt');
  select assert((select count(*) from v_students_public where class_id = :'class_b' and full_name like '%.%') = 0,
    'Che tên chỉ áp dụng cho lớp bật công tắc, không ảnh hưởng lớp khác');
  -- 0009: khách phải tự sinh được mã QR ⇒ view công khai có tài khoản NHẬN tiền của lớp,
  -- trong khi bảng gốc classes vẫn chặn (phép kiểm tra ngay trên).
  select assert((select account_no from v_classes_public where code = 'DCXDXD69_03B') = '1021234567',
    'Khách lấy được số tài khoản nhận tiền qua view công khai để tự sinh QR');
  select assert((select bank_bin from v_classes_public where code = 'DCXDXD69_03B') = '970436',
    'Khách lấy được mã ngân hàng (BIN) — bắt buộc có trong payload VietQR');
  select assert_blocked($q$select dob from v_classes_public$q$,
    'View công khai vẫn không có thứ gì riêng tư của sinh viên');
commit;

\echo ''
\echo '=== 16. Không ai xoá cứng được gì ==='
begin;
  set local role authenticated;
  set local request.jwt.claims to :'owner_jwt';
  select assert_blocked($q$delete from incomes where true$q$,  'Chủ sở hữu KHÔNG xoá cứng được khoản thu');
  select assert_blocked($q$delete from students where true$q$, 'Chủ sở hữu KHÔNG xoá cứng được sinh viên');
  select assert_blocked($q$delete from classes where true$q$,  'Chủ sở hữu KHÔNG xoá cứng được lớp');
commit;

\echo ''
\echo '=== 17. Root mở lớp và giao cho quản trị lớp (0006) ==='
begin;
  set local role authenticated;
  set local request.jwt.claims to :'owner_jwt';
  -- Root mở lớp C và giao ngay cho một email chưa có tài khoản ⇒ thành lời mời vai trò admin
  select assert((create_class('DCXDXD69_05C', 'Lớp 05C', 'Xây dựng', 'Học kỳ I', '2026-2027',
                              'lopTruong05C@lop.vn')).code = 'DCXDXD69_05C',
    'Root mở được lớp mới và giao luôn quản trị');
  select assert((select count(*) from invites i join classes c on c.id = i.class_id
                 where c.code = 'DCXDXD69_05C' and lower(i.email) = 'loptruong05c@lop.vn'
                   and i.role = 'admin' and i.accepted_at is null) = 1,
    'Email chưa có tài khoản ⇒ để dành vai trò quản trị trong lời mời');
  select assert_blocked($q$select create_class('DCXDXD69_05C', 'Trùng mã')$q$,
    'Mã lớp trùng bị chặn');
commit;

select id as class_c from classes where code = 'DCXDXD69_05C' \gset

-- Người được giao đăng ký ⇒ thành quản trị lớp C
insert into auth.users (email, raw_user_meta_data)
  values ('lopTruong05C@lop.vn', '{"full_name":"Phạm Lớp Trưởng"}');
select assert((select m.role from memberships m join profiles p on p.id = m.user_id
               where p.email = 'lopTruong05C@lop.vn' and m.class_id = :'class_c') = 'admin',
  'Nhận lời mời ⇒ tự thành quản trị lớp C');
select assert((select role from profiles where email = 'lopTruong05C@lop.vn') = 'member',
  'Quản trị LỚP vẫn chỉ là thành viên ở cấp hệ thống (không phải root)');
select format('{"sub":"%s"}', id) as adm_c_jwt from profiles where email = 'lopTruong05C@lop.vn' \gset

begin;
  set local role authenticated;
  set local request.jwt.claims to :'adm_c_jwt';
  -- Phạm vi: chỉ lớp C
  select assert((select count(*) from classes) = 1, 'Quản trị lớp C chỉ thấy đúng lớp C');
  select assert((select count(*) from students where class_id = :'class_a') = 0,
    'Quản trị lớp C không thấy sinh viên lớp A');
  select assert((select count(*) from incomes) = 0, 'Quản trị lớp C không thấy khoản thu lớp khác');

  -- Không mở được lớp mới, không tự chèn lớp
  select assert_blocked($q$select create_class('LOP_TU_MO', 'Lớp tự mở')$q$,
    'Quản trị lớp KHÔNG tạo được lớp mới (chỉ root được)');
  select assert_blocked($q$insert into classes (code, name) values ('LOP_LEN', 'Chèn thẳng')$q$,
    'Chèn thẳng vào bảng classes bị chặn');

  -- Không giao quyền sang lớp khác
  select assert_blocked(format($q$select grant_class_role('%s', 'lopTruong05C@lop.vn', 'admin')$q$, :'class_a'),
    'Quản trị lớp C KHÔNG giao được quyền trong lớp A');
  -- Nhưng thêm được thủ quỹ cho lớp mình
  select assert((grant_class_role(:'class_c'::uuid, 'thuquy@lop.vn', 'treasurer'))->>'status' = 'granted',
    'Quản trị lớp C thêm được thủ quỹ cho lớp C');
  select assert((select m.role from memberships m join profiles p on p.id = m.user_id
                 where p.email = 'thuquy@lop.vn' and m.class_id = :'class_c') = 'treasurer',
    'Thủ quỹ lớp C được lưu đúng vai trò');
  -- Chính RLS cũng che: quản trị lớp C chỉ thấy thành viên lớp C, không thấy lớp A của người đó
  select assert((select count(distinct m.class_id) from memberships m join profiles p on p.id = m.user_id
                 where p.email = 'thuquy@lop.vn') = 1,
    'Quản trị lớp C chỉ thấy phần thuộc lớp C của một người đa lớp');

  select assert_blocked(format($q$select revoke_class_role('%s', (select id from profiles where email = 'lopTruong05C@lop.vn'))$q$, :'class_c'),
    'Quản trị lớp không tự rút mình khỏi lớp');
  select assert_blocked(format($q$select revoke_class_role('%s', (select id from profiles where email = 'thuquy@lop.vn'))$q$, :'class_a'),
    'Quản trị lớp C không rút được người khỏi lớp A');
commit;

\echo ''
\echo '=== 18. Không mang quyền từ lớp này sang lớp khác ==='
begin;
  set local role authenticated;
  set local request.jwt.claims to :'adm_c_jwt';
  select assert_blocked(format($q$update memberships set class_id = '%s'
                                 where class_id = '%s' and user_id = (select id from profiles where email = 'thuquy@lop.vn')$q$,
                               :'class_a', :'class_c'),
    'Không đổi được class_id của membership để lấn sang lớp khác');
  select assert_blocked(format($q$update memberships set student_id = '%s'
                                 where class_id = '%s' and user_id = (select id from profiles where email = 'thuquy@lop.vn')$q$,
                               :'sa1', :'class_c'),
    'Không gắn được sinh viên lớp A vào membership lớp C');
  select assert_blocked($q$insert into invites (email, role, class_id)
                          values ('ai@do.vn', 'owner', (select id from classes limit 1))$q$,
    'Không mời được ai với vai trò chủ sở hữu hệ thống');
commit;
begin;
  set local role authenticated;
  set local request.jwt.claims to :'owner_jwt';
  select assert((select count(distinct m.class_id) from memberships m join profiles p on p.id = m.user_id
                 where p.email = 'thuquy@lop.vn') = 2,
    'Một người tham gia nhiều lớp với vai trò riêng từng lớp (góc nhìn root)');
  select revoke_class_role(:'class_c'::uuid, (select id from profiles where email = 'thuquy@lop.vn'));
  select assert((select count(*) from memberships m join profiles p on p.id = m.user_id
                 where p.email = 'thuquy@lop.vn' and m.class_id = :'class_c') = 0,
    'Root rút được người khỏi lớp');
  select assert(exists (select 1 from audit_logs where class_id = :'class_c'
                        and table_name = 'memberships' and action = 'DELETE'),
    'Việc rút người khỏi lớp được ghi vào lịch sử của đúng lớp');
commit;

\echo ''
\echo '=== 19. Ban quản lý lớp hiện ra cho mọi người (0007) ==='
begin;
  set local role authenticated;
  set local request.jwt.claims to :'owner_jwt';
  -- lớp A: nâng sinh viên 2421070527 (Trần Văn Mẫu) lên thủ quỹ để có người gắn với danh sách
  update memberships set role = 'treasurer'
    where class_id = :'class_a'
      and user_id = (select id from profiles where email = '2421070527@student.humg.edu.vn');
commit;
begin;
  set local role authenticated;
  set local request.jwt.claims to :'sv_jwt';
  -- Không ai ngoài quản trị lớp liệt kê được bảng memberships (chỉ thấy dòng của chính mình),
  -- nhưng ai cũng phải biết trong lớp mình ai đang giữ quỹ ⇒ đó là việc của v_class_officers.
  select assert((select count(*) from memberships where class_id = :'class_a') = 1,
    'Không phải quản trị thì chỉ đọc được dòng membership của chính mình');
  select assert((select role from v_class_officers
                 where class_id = :'class_a' and person_name = 'Trần Văn Mẫu') = 'treasurer',
    'Thành viên vẫn thấy ai là thủ quỹ qua v_class_officers');
  select assert((select in_student_list from v_class_officers
                 where class_id = :'class_a' and person_name = 'Trần Văn Mẫu'),
    'Thủ quỹ này có trong danh sách lớp ⇒ đánh dấu được ngay trên dòng của họ');
  select assert((select count(*) from v_class_officers where class_id = :'class_a' and role = 'member') = 0,
    'View chỉ công bố người có trách nhiệm với quỹ, không liệt kê thành viên thường');
commit;
begin;
  set local role anon;
  select assert((select count(*) from v_class_officers where class_id = :'class_a') >= 1,
    'Khách cũng biết ai đang giữ quỹ của lớp');
  -- lớp A đã bật che tên ở nhóm 15 ⇒ tên ban quản lý cũng phải bị che với khách
  -- lớp A có hai thủ quỹ: một người trong danh sách lớp, một người được mời bằng email
  select assert((select person_name from v_class_officers
                 where class_id = :'class_a' and role = 'treasurer' and in_student_list) = 'Trần V. M.',
    'Bật che tên ⇒ khách chỉ thấy tên viết tắt của ban quản lý');
  select assert((select count(*) from v_class_officers
                 where class_id = :'class_a' and not in_student_list) = 1,
    'Người giữ quỹ ngoài danh sách lớp vẫn có trong ban quản lý');
  select assert_blocked($q$select email from v_class_officers$q$,
    'View không công bố email của ban quản lý');
commit;
begin;
  set local role authenticated;
  set local request.jwt.claims to :'adm_c_jwt';
  select assert((select count(*) from v_class_officers where class_id = :'class_c' and role = 'admin') = 1,
    'Lớp C có đúng một quản trị lớp trong ban quản lý');
  -- Quản trị lớp C được mời bằng email nên chưa gắn với sinh viên nào; gắn vào một sinh viên
  -- của LỚP MÌNH là hợp lệ, và sau đó tên trong ban quản lý lấy theo danh sách lớp.
  select assert((select not in_student_list from v_class_officers where class_id = :'class_c'),
    'Quản trị lớp C ban đầu chưa gắn với sinh viên nào');
commit;
begin;
  set local role authenticated;
  set local request.jwt.claims to :'owner_jwt';
  insert into students (class_id, stt, code, last_name, first_name)
    values (:'class_c', 1, '2421075555', 'Phạm', 'Lớp Trưởng');
commit;
begin;
  set local role authenticated;
  set local request.jwt.claims to :'adm_c_jwt';
  update memberships set student_id = (select id from students where code = '2421075555')
    where class_id = :'class_c' and user_id = (select id from profiles where email = 'lopTruong05C@lop.vn');
  select assert((select in_student_list from v_class_officers where class_id = :'class_c'),
    'Gắn tài khoản với sinh viên cùng lớp ⇒ đánh dấu được trên dòng của họ');
  select assert((select person_name from v_class_officers where class_id = :'class_c') = 'Phạm Lớp Trưởng',
    'Tên trong ban quản lý lấy theo danh sách lớp sau khi đã gắn');
  select assert_blocked(format($q$update memberships set student_id = '%s'
                                 where class_id = '%s'$q$, :'sa1', :'class_c'),
    'Vẫn không gắn được sinh viên của lớp khác');
commit;

\echo ''
\echo '=== 20. Không bao giờ phải xác nhận email (0008) ==='
insert into auth.users (email, raw_user_meta_data)
  values ('2421078888@student.humg.edu.vn', '{"full_name":"Hoàng Không Cần Xác Nhận"}');
select assert((select email_confirmed_at is not null from auth.users
               where email = '2421078888@student.humg.edu.vn'),
  'Tài khoản mới tự có email_confirmed_at ⇒ đăng nhập được ngay, không cần mở hộp thư');
select assert((select count(*) from auth.users where email_confirmed_at is null) = 0,
  'Không còn tài khoản nào treo ở trạng thái chờ xác nhận');
-- Bỏ xác nhận email KHÔNG mở thêm cửa: email lạ vẫn bị chặn ngay lúc đăng ký
select assert_blocked($q$insert into auth.users (email) values ('nguoila@gmail.com')$q$,
  'Email không đúng dạng và chưa được mời thì vẫn không đăng ký được');

\echo ''
\echo '=== 21. Chi vượt tồn quỹ: quỹ âm được, nhưng phải để lại dấu ==='
-- Có người ứng tiền mua trước rồi lớp thu bù sau ⇒ tồn quỹ âm là hợp lệ. Việc DB phải làm là
-- KHÔNG chặn, KHÔNG kẹp về 0, và giữ đúng đẳng thức thu − chi kể cả khi kết quả âm.
begin;
  set local role authenticated;
  set local request.jwt.claims to :'owner_jwt';
  select assert((select balance from v_fund_balance where class_id = :'class_b' and fund = 'QUY_LOP') = 0,
    'Lớp B chưa thu gì nên Quỹ Lớp đang bằng 0');
commit;
begin;
  set local role authenticated;
  set local request.jwt.claims to :'qtb_jwt';
  insert into expenses (class_id, date, fund, item, category, buyer, amount, overdraft)
    values (:'class_b', '2026-09-07', 'QUY_LOP', 'Ứng tiền mua nước cho lớp', 'Sinh hoạt',
            'Quản trị B', 120000, true);
  select assert((select balance from v_fund_balance where class_id = :'class_b' and fund = 'QUY_LOP') = -120000,
    'Chi 120.000 khi quỹ rỗng ⇒ tồn quỹ âm 120.000, không bị kẹp về 0');
  select assert((select total_income = 0 and total_expense = 120000
                 from v_fund_balance where class_id = :'class_b' and fund = 'QUY_LOP'),
    'Tổng thu và tổng chi vẫn tách riêng, đẳng thức thu − chi giữ nguyên');
  select assert((select overdraft from expenses where class_id = :'class_b' and amount = 120000),
    'Bản ghi chi được đánh dấu vượt quỹ để biết ai đang ứng tiền');
  select assert((select balance from v_fund_balance where class_id = :'class_a' and fund = 'QUY_LOP') <> -120000,
    'Quỹ âm của lớp B không lây sang lớp A');
  select assert((select balance from v_fund_balance where class_id = :'class_b' and fund = 'QUY_DOAN') = 0,
    'Quỹ âm của Quỹ Lớp không lây sang Quỹ Đoàn của cùng lớp');

  -- Thu bù về đúng số 0, không phải một con số lệch
  insert into periods (class_id, name, fund, amount_per_student, open_date)
    values (:'class_b', 'Bù tiền ứng trước', 'QUY_LOP', 60000, '2026-09-08');
  insert into incomes (class_id, date, fund, period_id, student_id, amount, method)
  select :'class_b', '2026-09-09', 'QUY_LOP',
         (select id from periods where class_id = :'class_b' and name = 'Bù tiền ứng trước'),
         s.id, 60000, 'CASH'
    from students s where s.class_id = :'class_b';
  select assert((select balance from v_fund_balance where class_id = :'class_b' and fund = 'QUY_LOP') = 0,
    'Thu bù 2 × 60.000 ⇒ quỹ về đúng 0');
commit;
-- Xoá mềm khoản chi ứng trước thì tồn quỹ phải tính lại, không giữ lại vết tiền đã trừ
begin;
  set local role authenticated;
  set local request.jwt.claims to :'qtb_jwt';
  update expenses set deleted_at = now() where class_id = :'class_b' and amount = 120000;
  select assert((select balance from v_fund_balance where class_id = :'class_b' and fund = 'QUY_LOP') = 120000,
    'Xoá mềm khoản ứng trước ⇒ tồn quỹ tính lại ngay');
commit;

\echo ''
\echo '=== XONG: tất cả phép kiểm tra DB đều đạt ==='
