-- =====================================================================================
-- Kiểm thử DB: RLS, guard nghiệp vụ, audit log, view báo cáo, RPC import.
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

/** Dùng cho những thao tác BẮT BUỘC phải bị chặn. */
create or replace function assert_blocked(stmt text, msg text) returns void
language plpgsql as $q$
begin
  begin
    execute stmt;
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
    raise notice '  PASS  % [bị chặn: %]', msg, left(replace(sqlerrm, E'\n', ' '), 70);
    return;
  end;
  raise exception 'FAIL: % — lẽ ra phải bị chặn nhưng lại thành công', msg;
end $q$;

/**
 * Dùng cho UPDATE/DELETE bị RLS chặn: policy không khớp thì Postgres KHÔNG báo lỗi,
 * nó chỉ đơn giản là không thấy dòng nào ⇒ 0 dòng bị sửa. Phép kiểm tra này chấp nhận
 * cả hai kết quả "bị báo lỗi" và "không dòng nào bị sửa", nhưng thất bại nếu có dòng bị sửa.
 * (Hệ quả cho frontend: sau mỗi update phải kiểm tra số dòng trả về, đừng mặc định là thành công.)
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
  if n = 0 then
    raise notice '  PASS  % [RLS lọc hết, 0 dòng bị sửa]', msg;
  else
    raise exception 'FAIL: % — đã sửa được % dòng', msg, n;
  end if;
end $q$;

grant execute on function assert(boolean, text), assert_blocked(text, text),
                          assert_noop(text, text) to anon, authenticated;

\echo ''
\echo '=== 1. Đăng ký chỉ qua lời mời ==='
insert into auth.users (email, raw_user_meta_data)
  values ('chusohuu@lop.vn', '{"full_name":"Nguyễn Chủ Sở Hữu"}');
select assert((select role from profiles where email = 'chusohuu@lop.vn') = 'owner',
  'Người đăng ký đầu tiên tự động thành chủ sở hữu');
select assert_blocked($q$insert into auth.users (email) values ('nguoila@gmail.com')$q$,
  'Email chưa được mời không đăng ký được');

select format('{"sub":"%s"}', id) as owner_jwt from profiles where email = 'chusohuu@lop.vn' \gset

\echo ''
\echo '=== 2. Chủ sở hữu mời quản trị / thủ quỹ / thành viên ==='
begin;
  set local role authenticated;
  set local request.jwt.claims to :'owner_jwt';
  insert into invites (email, role) values ('quantri@lop.vn', 'admin');
  insert into invites (email, role) values ('thuquy@lop.vn',  'treasurer');
  insert into invites (email, role) values ('sinhvien@lop.vn','member');
  select assert((select count(*) from invites where accepted_at is null) = 3, 'Tạo được 3 lời mời');
commit;

insert into auth.users (email, raw_user_meta_data) values ('quantri@lop.vn',  '{"full_name":"Trần Quản Trị"}');
insert into auth.users (email, raw_user_meta_data) values ('thuquy@lop.vn',   '{"full_name":"Lê Thủ Quỹ"}');
insert into auth.users (email, raw_user_meta_data) values ('sinhvien@lop.vn', '{"full_name":"Phạm Sinh Viên"}');
select assert((select role from profiles where email = 'quantri@lop.vn')  = 'admin',     'Lời mời admin ⇒ vai trò admin');
select assert((select role from profiles where email = 'thuquy@lop.vn')   = 'treasurer', 'Lời mời thủ quỹ ⇒ vai trò treasurer');
select assert((select role from profiles where email = 'sinhvien@lop.vn') = 'member',    'Lời mời thành viên ⇒ vai trò member');
select assert((select count(*) from invites where accepted_at is not null) = 3, 'Cả 3 lời mời được đánh dấu đã nhận');

select format('{"sub":"%s"}', id) as admin_jwt     from profiles where email = 'quantri@lop.vn'  \gset
select format('{"sub":"%s"}', id) as treasurer_jwt from profiles where email = 'thuquy@lop.vn'   \gset
select format('{"sub":"%s"}', id) as member_jwt    from profiles where email = 'sinhvien@lop.vn' \gset

\echo ''
\echo '=== 3. Đợt thu: chỉ quản trị được tạo ==='
begin;
  set local role authenticated;
  set local request.jwt.claims to :'treasurer_jwt';
  select assert_blocked(
    $q$insert into periods (name, fund, amount_per_student) values ('Thủ quỹ tự tạo', 'QUY_LOP', 50000)$q$,
    'Thủ quỹ KHÔNG tạo được đợt thu');
commit;
begin;
  set local role authenticated;
  set local request.jwt.claims to :'admin_jwt';
  insert into periods (name, fund, amount_per_student, open_date) values
    ('Quỹ lớp HK1 2026-2027',  'QUY_LOP',  50000, '2026-09-01'),
    ('Quỹ Đoàn HK1 2026-2027', 'QUY_DOAN', 20000, '2026-09-01');
  select assert((select count(*) from periods) = 2, 'Quản trị tạo được 2 đợt thu');
commit;

select id as p_lop  from periods where fund = 'QUY_LOP'  \gset
select id as p_doan from periods where fund = 'QUY_DOAN' \gset

\echo ''
\echo '=== 4. Thủ quỹ: sinh viên, thu, chi ==='
begin;
  set local role authenticated;
  set local request.jwt.claims to :'treasurer_jwt';
  insert into students (stt, code, last_name, first_name, dob, class_code) values
    (1, '2400000001', 'Trần Văn', 'Mẫu',  '2005-01-15', 'DCXDXD69_03B'),
    (2, '2400000002', 'Lê Thị',   'Thử', '2005-02-20', 'DCXDXD69_03B'),
    (3, '2400000003', 'Phạm Minh', 'Ví', '2005-03-25', 'DCXDXD69_03B');
  select assert((select count(*) from students) = 3, 'Thủ quỹ thêm được 3 sinh viên');
commit;

select id as s_an  from students where code = '2400000001' \gset
select id as s_anh from students where code = '2400000002' \gset
select id as s_nam from students where code = '2400000003' \gset

begin;
  set local role authenticated;
  set local request.jwt.claims to :'treasurer_jwt';
  -- An chuyển khoản đủ 50.000 quỹ lớp + 20.000 quỹ đoàn; Anh nộp thiếu (30.000)
  insert into incomes (date, fund, period_id, student_id, payer_name, amount, method, collected_by, note, created_by)
    values ('2026-09-03', 'QUY_LOP', :'p_lop', :'s_an', 'Trần Văn Mẫu', 50000, 'TRANSFER', 'Lê Thủ Quỹ', 'Chuyển khoản QR', auth.uid());
  insert into incomes (date, fund, period_id, student_id, payer_name, amount, method, collected_by, created_by)
    values ('2026-09-03', 'QUY_LOP', :'p_lop', :'s_anh', 'Lê Thị Thử', 30000, 'CASH', 'Lê Thủ Quỹ', auth.uid());
  insert into incomes (date, fund, period_id, student_id, payer_name, amount, method, collected_by, created_by)
    values ('2026-09-04', 'QUY_DOAN', :'p_doan', :'s_an', 'Trần Văn Mẫu', 20000, 'TRANSFER', 'Lê Thủ Quỹ', auth.uid());
  insert into expenses (date, fund, item, category, buyer, amount, created_by)
    values ('2026-09-05', 'QUY_LOP', 'Nước + bánh sinh hoạt lớp', 'Sinh hoạt', 'Phạm Minh Ví', 30000, auth.uid());
  select assert((select count(*) from incomes) = 3 and (select count(*) from expenses) = 1,
    'Thủ quỹ ghi được 3 khoản thu + 1 khoản chi');

  -- hai quỹ phải khớp giữa khoản thu và đợt thu
  select assert_blocked(
    format($q$insert into incomes (date, fund, period_id, student_id, amount) values ('2026-09-05','QUY_DOAN','%s','%s',10000)$q$, :'p_lop', :'s_nam'),
    'Ghi thu Quỹ Đoàn vào đợt của Quỹ Lớp bị chặn');
  select assert_blocked(
    format($q$insert into incomes (date, fund, period_id, student_id, amount) values ('2026-09-05','QUY_LOP','%s','%s',-5000)$q$, :'p_lop', :'s_nam'),
    'Số tiền âm bị chặn');
  select assert_blocked(
    $q$insert into expenses (date, fund, item, category, buyer, amount) values ('2026-09-05','QUY_LOP','Thiếu người mua','Khác','',10000)$q$,
    'Khoản chi thiếu người đi mua bị chặn');
commit;

\echo ''
\echo '=== 5. Tồn quỹ = Thu − Chi, hai quỹ tách biệt tuyệt đối ==='
select assert((select balance from v_fund_balance where fund = 'QUY_LOP')  = 50000,
  'Tồn Quỹ Lớp = 80.000 thu − 30.000 chi = 50.000');
select assert((select balance from v_fund_balance where fund = 'QUY_DOAN') = 20000,
  'Tồn Quỹ Đoàn = 20.000, không bị khoản chi của Quỹ Lớp ảnh hưởng');
select assert((select total_income from v_fund_balance where fund = 'QUY_LOP') = 80000, 'Tổng thu Quỹ Lớp đúng');
select assert((select remaining from v_student_debt where student_id = :'s_anh' and period_id = :'p_lop') = 20000,
  'Công nợ: Lê Thị Thử còn thiếu 20.000 ở đợt Quỹ Lớp');
select assert((select paid_count from v_period_progress where period_id = :'p_lop') = 1
          and (select partial_count from v_period_progress where period_id = :'p_lop') = 1
          and (select unpaid_count from v_period_progress where period_id = :'p_lop') = 1,
  'Tiến độ đợt Quỹ Lớp: 1 đủ / 1 thiếu / 1 chưa nộp');
select assert((select remaining from v_period_progress where period_id = :'p_lop') = 70000,
  'Đợt Quỹ Lớp còn phải thu 70.000 (3×50.000 − 80.000)');
select assert((select running_balance from v_daily_ledger where fund = 'QUY_LOP' order by date desc, id limit 1) = 50000,
  'Số dư luỹ kế cuối kỳ của Quỹ Lớp khớp tồn quỹ');

\echo ''
\echo '=== 6. Thành viên chỉ được đọc ==='
begin;
  set local role authenticated;
  set local request.jwt.claims to :'member_jwt';
  select assert((select count(*) from incomes) = 3, 'Thành viên đọc được danh sách thu');
  select assert((select count(*) from students) = 3, 'Thành viên đọc được danh sách lớp');
  select assert_blocked(
    format($q$insert into incomes (date, fund, period_id, student_id, amount) values ('2026-09-06','QUY_LOP','%s','%s',50000)$q$, :'p_lop', :'s_nam'),
    'Thành viên KHÔNG ghi được khoản thu');
  select assert_noop($q$update expenses set amount = 1 where true$q$, 'Thành viên KHÔNG sửa được khoản chi');
  select assert((select count(*) from audit_logs) = 0, 'Thành viên KHÔNG đọc được audit log');
  select assert_blocked($q$insert into students (code, last_name, first_name) values ('999','Tự','Thêm')$q$,
    'Thành viên KHÔNG thêm được sinh viên');
commit;

\echo ''
\echo '=== 7. Khách chưa đăng nhập (anon) ==='
begin;
  set local role anon;
  select assert((select count(*) from v_incomes_public) = 3, 'Khách xem được các khoản thu qua view công khai');
  select assert((select count(*) from v_expenses_public) = 1, 'Khách xem được các khoản chi');
  select assert((select balance from v_fund_balance where fund = 'QUY_LOP') = 50000, 'Khách xem được tồn quỹ');
  select assert((select count(*) from periods) = 2, 'Khách xem được các đợt thu');
  -- anon còn không có cả quyền SELECT trên các bảng gốc ⇒ bị chặn ngay ở tầng privilege,
  -- trước cả khi tới RLS. Đây là lớp bảo vệ mạnh hơn "thấy 0 dòng".
  select assert_blocked($q$select count(*) from incomes$q$,    'Khách KHÔNG đọc được bảng incomes gốc');
  select assert_blocked($q$select count(*) from students$q$,   'Khách KHÔNG đọc được bảng students gốc');
  select assert_blocked($q$select count(*) from audit_logs$q$, 'Khách KHÔNG đọc được audit log');
  select assert_blocked($q$select * from profiles$q$, 'Khách KHÔNG đọc được danh sách tài khoản');
  select assert_blocked($q$select * from class_settings$q$, 'Khách KHÔNG đọc được bảng cấu hình (có số tài khoản)');
  select assert((select bank_configured from v_class_public) is not null, 'Khách chỉ biết ĐÃ cấu hình QR hay chưa, không thấy số tài khoản');
  select assert_blocked(
    format($q$insert into incomes (date, fund, period_id, student_id, amount) values ('2026-09-06','QUY_LOP','%s','%s',50000)$q$, :'p_lop', :'s_an'),
    'Khách KHÔNG ghi được khoản thu bằng anon key');
commit;
select assert((select count(*) = 0 from information_schema.columns
               where table_name = 'v_students_public' and column_name = 'dob'),
  'View công khai không có cột ngày sinh');

\echo ''
\echo '=== 8. Xoá mềm: thủ quỹ chỉ xoá bản ghi của mình trong 24h ==='
begin;
  set local role authenticated;
  set local request.jwt.claims to :'admin_jwt';
  insert into expenses (date, fund, item, category, buyer, amount, created_by)
    values ('2026-09-06', 'QUY_LOP', 'Khoản chi của quản trị', 'Khác', 'Quản trị', 5000, auth.uid());
commit;
begin;
  set local role authenticated;
  set local request.jwt.claims to :'treasurer_jwt';
  select assert_blocked($q$update expenses set deleted_at = now() where item = 'Khoản chi của quản trị'$q$,
    'Thủ quỹ KHÔNG xoá được bản ghi của người khác');
  update expenses set deleted_at = now() where item = 'Nước + bánh sinh hoạt lớp';
  select assert((select deleted_at is not null from expenses where item = 'Nước + bánh sinh hoạt lớp'),
    'Thủ quỹ xoá được bản ghi của chính mình trong 24h');
commit;
select assert((select balance from v_fund_balance where fund = 'QUY_LOP') = 75000,
  'Xoá mềm khoản chi 30.000 ⇒ tồn quỹ tự tính lại thành 75.000');
-- lùi ngày tạo về 2 ngày trước để kiểm tra mốc 24h
update expenses set deleted_at = null, created_at = now() - interval '2 days' where item = 'Nước + bánh sinh hoạt lớp';
begin;
  set local role authenticated;
  set local request.jwt.claims to :'treasurer_jwt';
  select assert_blocked($q$update expenses set deleted_at = now() where item = 'Nước + bánh sinh hoạt lớp'$q$,
    'Quá 24h thủ quỹ KHÔNG xoá được nữa');
commit;
begin;
  set local role authenticated;
  set local request.jwt.claims to :'admin_jwt';
  update expenses set deleted_at = now() where item = 'Nước + bánh sinh hoạt lớp';
  select assert((select deleted_at is not null from expenses where item = 'Nước + bánh sinh hoạt lớp'),
    'Quản trị xoá được bản ghi quá hạn');
commit;
begin;
  set local role authenticated;
  set local request.jwt.claims to :'treasurer_jwt';
  select assert_blocked($q$update expenses set deleted_at = null where item = 'Nước + bánh sinh hoạt lớp'$q$,
    'Thủ quỹ KHÔNG phục hồi được bản ghi đã xoá');
commit;
begin;
  set local role authenticated;
  set local request.jwt.claims to :'admin_jwt';
  update expenses set deleted_at = null where item = 'Nước + bánh sinh hoạt lớp';
  select assert((select deleted_at is null from expenses where item = 'Nước + bánh sinh hoạt lớp'),
    'Quản trị phục hồi được bản ghi đã xoá');
commit;

\echo ''
\echo '=== 9. Không làm mất dấu tiền ==='
begin;
  set local role authenticated;
  set local request.jwt.claims to :'admin_jwt';
  select assert_blocked(format($q$update periods set deleted_at = now() where id = '%s'$q$, :'p_lop'),
    'Đợt thu đã có khoản thu KHÔNG xoá được');
  select assert_blocked(format($q$update periods set fund = 'QUY_DOAN' where id = '%s'$q$, :'p_lop'),
    'Đợt thu đã có khoản thu KHÔNG đổi được quỹ');
  update periods set status = 'CLOSED' where id = :'p_lop';
  select assert((select status from periods where id = :'p_lop') = 'CLOSED', 'Đóng đợt thu thì được');
  update periods set status = 'OPEN' where id = :'p_lop';
commit;
begin;
  -- chạy bằng quyền quản trị để bỏ qua quy tắc 24h của thủ quỹ, nhờ vậy kiểm tra đúng
  -- guard "đang có khoản thu" chứ không phải guard quyền xoá
  set local role authenticated;
  set local request.jwt.claims to :'admin_jwt';
  select assert_blocked(format($q$update students set deleted_at = now() where id = '%s'$q$, :'s_an'),
    'Sinh viên đã có khoản thu KHÔNG xoá được');
  update students set is_active = false where id = :'s_nam';
  select assert((select not is_active from students where id = :'s_nam'), 'Ẩn sinh viên chưa nộp thì được');
  update students set is_active = true where id = :'s_nam';
commit;
select assert((select created_by is not null from students where code = '2400000001'),
  'DB tự ghi created_by cho bản ghi do người dùng tạo');

\echo ''
\echo '=== 10. Bảo vệ tài khoản ==='
begin;
  set local role authenticated;
  set local request.jwt.claims to :'admin_jwt';
  select assert_blocked($q$update profiles set role = 'owner' where email = 'quantri@lop.vn'$q$,
    'Quản trị KHÔNG tự phong mình làm chủ sở hữu');
  select assert_blocked($q$update profiles set role = 'member' where email = 'chusohuu@lop.vn'$q$,
    'Quản trị KHÔNG sửa được tài khoản chủ sở hữu');
  update profiles set role = 'admin' where email = 'thuquy@lop.vn';
  select assert((select role from profiles where email = 'thuquy@lop.vn') = 'admin',
    'Quản trị nâng được thủ quỹ lên quản trị');
  update profiles set role = 'treasurer' where email = 'thuquy@lop.vn';
  update profiles set is_active = false where email = 'sinhvien@lop.vn';
  select assert((select not is_active from profiles where email = 'sinhvien@lop.vn'),
    'Quản trị vô hiệu hoá được tài khoản thành viên');
  update profiles set is_active = true where email = 'sinhvien@lop.vn';
commit;
begin;
  set local role authenticated;
  set local request.jwt.claims to :'owner_jwt';
  select assert_blocked($q$update profiles set role = 'member' where email = 'chusohuu@lop.vn'$q$,
    'Không ai được tự đổi vai trò của chính mình');
  select assert_blocked($q$update profiles set is_active = false where email = 'chusohuu@lop.vn'$q$,
    'Không vô hiệu hoá được chủ sở hữu cuối cùng');
commit;
begin;
  set local role authenticated;
  set local request.jwt.claims to :'member_jwt';
  select assert((select count(*) from profiles) = 1, 'Thành viên chỉ thấy tài khoản của chính mình');
  select assert_blocked($q$update profiles set role = 'admin' where email = 'sinhvien@lop.vn'$q$,
    'Thành viên KHÔNG tự nâng quyền');
commit;

\echo ''
\echo '=== 11. Audit log: có vết, đúng tiếng Việt, và bất biến ==='
select assert((select count(*) from audit_logs) >= 15, 'Mọi thao tác ghi đều để lại vết');
select assert(exists (select 1 from audit_logs
  where action = 'INSERT' and table_name = 'incomes'
    and summary like '%Lê Thủ Quỹ đã ghi nhận thu 50.000 ₫ từ Trần Văn Mẫu vào Quỹ Lớp (chuyển khoản)%'),
  'Diễn giải khoản thu bằng tiếng Việt, có số tiền và tên quỹ');
select assert(exists (select 1 from audit_logs
  where action = 'ROLE_CHANGE' and summary like '%đã đổi vai trò của Lê Thủ Quỹ: thủ quỹ → quản trị%'),
  'Đổi vai trò được ghi log kèm vai trò cũ → mới');
select assert(exists (select 1 from audit_logs
  where action = 'SOFT_DELETE' and table_name = 'expenses' and summary like '%đã xoá khoản chi 30.000 ₫%'),
  'Xoá mềm được ghi nhận là SOFT_DELETE');
select assert(exists (select 1 from audit_logs where action = 'RESTORE' and table_name = 'expenses'),
  'Phục hồi được ghi nhận là RESTORE');
select assert((select changed_fields from audit_logs
  where action = 'ROLE_CHANGE' order by id limit 1) = array['role'],
  'changed_fields chỉ ra đúng cột đã đổi');
select assert(exists (select 1 from audit_logs where table_name = 'invites' and action = 'INVITE'),
  'Lời mời được ghi log');
begin;
  set local role authenticated;
  set local request.jwt.claims to :'owner_jwt';
  select assert_noop($q$update audit_logs set summary = 'sửa lịch sử' where id = 1$q$,
    'Chủ sở hữu cũng KHÔNG sửa được audit log');
  select assert_blocked($q$delete from audit_logs where id = 1$q$,
    'Chủ sở hữu cũng KHÔNG xoá được audit log');
commit;
begin;
  set local role authenticated;
  set local request.jwt.claims to :'treasurer_jwt';
  select assert((select count(*) from audit_logs where table_name = 'profiles') = 0,
    'Thủ quỹ KHÔNG xem được log tài khoản');
  select assert((select count(*) from audit_logs where table_name = 'incomes') > 0,
    'Thủ quỹ xem được log thu chi');
commit;

\echo ''
\echo '=== 12. RPC: log_event, import_students, undo_import ==='
begin;
  set local role authenticated;
  set local request.jwt.claims to :'treasurer_jwt';
  select log_event('LOGIN', 'Lê Thủ Quỹ đã đăng nhập', null);
  select assert((select last_sign_in_at is not null from profiles where email = 'thuquy@lop.vn'),
    'log_event(LOGIN) cập nhật lần đăng nhập gần nhất');
  select assert_blocked($q$select log_event('HACK', 'thử ghi log lạ')$q$, 'log_event chặn loại sự kiện không hợp lệ');

  select assert((import_students(null, 'skip')->>'added')::int = 0,
    'import_students với payload rỗng trả về 0, không làm sập');
commit;

begin;
  set local role authenticated;
  set local request.jwt.claims to :'treasurer_jwt';
  select import_students($q$[
    {"stt":10,"code":"2400000008","last_name":"Ngô Văn","first_name":"Tám","dob":"2005-04-10","class_code":"DCXDXD69_03B"},
    {"stt":11,"code":"2400000007","last_name":"Đặng Văn","first_name":"Bảy","dob":"2005-05-12","class_code":"DCXDXD69_03B"},
    {"stt":12,"code":"","last_name":"","first_name":"","class_code":"X"}
  ]$q$::jsonb, 'skip') as r \gset
  select assert((:'r'::jsonb->>'added')::int = 2 and (:'r'::jsonb->>'failed')::int = 1,
    'import_students: thêm 2, 1 dòng lỗi (thiếu mã và tên)');
  select assert((select count(*) from incomes) = 3,
    'import_students KHÔNG tạo thêm khoản thu nào (tiền không đến từ file Excel)');
  select :'r'::jsonb->>'batch_id' as batch \gset
commit;
select assert((select count(*) from students where deleted_at is null) = 5, 'Sau import có 5 sinh viên');

begin;
  set local role authenticated;
  set local request.jwt.claims to :'treasurer_jwt';
  select import_students($q$[
    {"stt":10,"code":"2400000008","last_name":"Ngô Văn","first_name":"Tám"}
  ]$q$::jsonb, 'skip') as r2 \gset
  select assert((:'r2'::jsonb->>'skipped')::int = 1 and (:'r2'::jsonb->>'added')::int = 0,
    'Import lại cùng mã SV với chế độ "bỏ qua" ⇒ không nhân bản');
commit;

begin;
  set local role authenticated;
  set local request.jwt.claims to :'treasurer_jwt';
  select undo_import(:'batch'::uuid);
  select assert((select count(*) from students where deleted_at is null) = 3,
    'undo_import hoàn tác đúng lần import vừa rồi');
commit;
begin;
  set local role authenticated;
  set local request.jwt.claims to :'member_jwt';
  select assert_blocked($q$select import_students('[]'::jsonb, 'skip')$q$,
    'Thành viên KHÔNG gọi được import_students');
commit;

\echo ''
\echo '=== 13. Cấu hình lớp và che tên với khách ==='
begin;
  set local role authenticated;
  set local request.jwt.claims to :'treasurer_jwt';
  select assert_noop($q$update class_settings set account_no = '999' where id = 1$q$,
    'Thủ quỹ KHÔNG sửa được tài khoản nhận tiền');
commit;
begin;
  set local role authenticated;
  set local request.jwt.claims to :'admin_jwt';
  update class_settings set class_name = 'DCXDXD69_03B', bank_bin = '970436', bank_name = 'Vietcombank',
    account_no = '1021234567', account_name = 'LE THU QUY', hide_student_names_from_guest = true where id = 1;
  select assert((select account_no from class_settings) = '1021234567', 'Quản trị lưu được tài khoản nhận tiền');
  select assert_blocked($q$update class_settings set bank_bin = '97043' where id = 1$q$,
    'Mã BIN sai định dạng bị chặn ở tầng DB');
commit;
select assert((select bank_configured from v_class_public), 'View công khai báo đã cấu hình QR');
begin;
  set local role anon;
  select assert((select full_name from v_students_public where code like '%363') = 'Trần V. M.',
    'Bật che tên ⇒ khách chỉ thấy tên viết tắt');
  select assert((select code from v_students_public limit 1) like '***%',
    'Bật che tên ⇒ mã SV cũng bị che một phần');
commit;
begin;
  set local role authenticated;
  set local request.jwt.claims to :'admin_jwt';
  update class_settings set hide_student_names_from_guest = false where id = 1;
commit;

\echo ''
\echo '=== 14. Không ai xoá cứng được gì ==='
begin;
  set local role authenticated;
  set local request.jwt.claims to :'owner_jwt';
  select assert_blocked($q$delete from incomes where true$q$,  'Chủ sở hữu KHÔNG xoá cứng được khoản thu');
  select assert_blocked($q$delete from students where true$q$, 'Chủ sở hữu KHÔNG xoá cứng được sinh viên');
  select assert_blocked($q$delete from profiles where true$q$, 'Chủ sở hữu KHÔNG xoá cứng được tài khoản');
commit;

\echo ''
\echo '=== XONG: tất cả phép kiểm tra DB đều đạt ==='
