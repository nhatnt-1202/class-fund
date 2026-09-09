-- =====================================================================================
-- 0005_multiclass_rls — Phân quyền theo LỚP
-- =====================================================================================
-- MA TRẬN QUYỀN (mọi thứ đều xét TRONG PHẠM VI MỘT LỚP)
--   guest (chưa đăng nhập) : chỉ đọc các view công khai của lớp (không ngày sinh, không số TK)
--   member trong lớp       : đọc mọi số liệu của LỚP ĐÓ + công nợ của chính mình
--   treasurer trong lớp    : + thêm/sửa thu, chi, sinh viên, nhập danh sách của LỚP ĐÓ
--   admin trong lớp        : + đợt thu, cấu hình lớp, quản lý thành viên, phục hồi bản ghi
--   owner hệ thống         : coi như admin của mọi lớp — để dựng hệ thống và cứu hộ
--
-- ĐIỀU QUAN TRỌNG NHẤT: không lớp nào đọc hay ghi được dữ liệu của lớp khác. Mọi policy đều
-- chốt bằng `class_id in (select my_class_ids())` hoặc `has_class_role(class_id, …)`.
-- =====================================================================================

alter table app_config  enable row level security;
alter table classes     enable row level security;
alter table memberships enable row level security;

/* ===== Xoá policy của thời một lớp ===== */
drop policy if exists class_settings_select on class_settings;
drop policy if exists class_settings_update on class_settings;
drop policy if exists profiles_select_self_or_admin on profiles;
drop policy if exists profiles_update_self_or_admin on profiles;
drop policy if exists invites_admin_select on invites;
drop policy if exists invites_admin_insert on invites;
drop policy if exists invites_admin_update on invites;
drop policy if exists students_select on students;
drop policy if exists students_insert on students;
drop policy if exists students_update on students;
drop policy if exists periods_select_public on periods;
drop policy if exists periods_insert_admin on periods;
drop policy if exists periods_update_admin on periods;
drop policy if exists incomes_select on incomes;
drop policy if exists incomes_insert on incomes;
drop policy if exists incomes_update on incomes;
drop policy if exists expenses_select on expenses;
drop policy if exists expenses_insert on expenses;
drop policy if exists expenses_update on expenses;
drop policy if exists audit_select on audit_logs;
drop policy if exists audit_insert_self on audit_logs;

/* ===== Cấu hình hệ thống ===== */
create policy app_config_read on app_config for select to anon, authenticated using (true);
create policy app_config_owner on app_config for update to authenticated
  using (is_system_owner()) with check (is_system_owner());

/* ===== LỚP ===== */
-- Danh sách lớp là công khai: sinh viên phải tìm được lớp mình, khách xem được lớp nào có gì.
-- Số tài khoản của lớp KHÔNG nằm ở đây với khách (xem view v_classes_public bên dưới).
create policy classes_select_member on classes for select to authenticated
  using (id in (select my_class_ids()) or is_system_owner());
create policy classes_insert on classes for insert to authenticated
  with check (auth.uid() is not null);          -- ai đăng nhập cũng tạo được lớp của mình
create policy classes_update_admin on classes for update to authenticated
  using (has_class_role(id, 'admin')) with check (has_class_role(id, 'admin'));

/* ===== THÀNH VIÊN LỚP ===== */
create policy memberships_select on memberships for select to authenticated
  using (user_id = auth.uid() or has_class_role(class_id, 'admin'));
-- Trigger handle_new_user (security definer) mới là nơi tạo membership khi đăng ký;
-- policy này để quản trị lớp mời thêm người vào lớp mình.
create policy memberships_insert_admin on memberships for insert to authenticated
  with check (has_class_role(class_id, 'admin'));
create policy memberships_update_admin on memberships for update to authenticated
  using (has_class_role(class_id, 'admin')) with check (has_class_role(class_id, 'admin'));

/* ===== TÀI KHOẢN ===== */
-- Thấy chính mình, hoặc những người CÙNG LỚP mà mình làm quản trị.
create policy profiles_select on profiles for select to authenticated
  using (
    id = auth.uid()
    or is_system_owner()
    or exists (
      select 1 from memberships m
      where m.user_id = profiles.id
        and has_class_role(m.class_id, 'admin')
    )
  );
create policy profiles_update on profiles for update to authenticated
  using (id = auth.uid() or is_system_owner())
  with check (id = auth.uid() or is_system_owner());

/* ===== LỜI MỜI (cho email không đúng dạng email trường) ===== */
create policy invites_select on invites for select to authenticated
  using (has_class_role(class_id, 'admin'));
create policy invites_insert on invites for insert to authenticated
  with check (has_class_role(class_id, 'admin'));
create policy invites_update on invites for update to authenticated
  using (has_class_role(class_id, 'admin')) with check (has_class_role(class_id, 'admin'));

/* ===== SINH VIÊN ===== */
create policy students_select on students for select to authenticated
  using (class_id in (select my_class_ids()));
create policy students_insert on students for insert to authenticated
  with check (has_class_role(class_id, 'treasurer'));
create policy students_update on students for update to authenticated
  using (has_class_role(class_id, 'treasurer')) with check (has_class_role(class_id, 'treasurer'));

/* ===== ĐỢT THU ===== */
-- Công khai để cả lớp (và khách) biết phải nộp bao nhiêu, nhưng chỉ đợt chưa xoá.
create policy periods_select_public on periods for select to anon, authenticated
  using (deleted_at is null);
create policy periods_insert_admin on periods for insert to authenticated
  with check (has_class_role(class_id, 'admin'));
create policy periods_update_admin on periods for update to authenticated
  using (has_class_role(class_id, 'admin')) with check (has_class_role(class_id, 'admin'));

/* ===== THU ===== */
create policy incomes_select on incomes for select to authenticated
  using (class_id in (select my_class_ids()));
create policy incomes_insert on incomes for insert to authenticated
  with check (has_class_role(class_id, 'treasurer'));
create policy incomes_update on incomes for update to authenticated
  using (has_class_role(class_id, 'treasurer')) with check (has_class_role(class_id, 'treasurer'));

/* ===== CHI ===== */
create policy expenses_select on expenses for select to authenticated
  using (class_id in (select my_class_ids()));
create policy expenses_insert on expenses for insert to authenticated
  with check (has_class_role(class_id, 'treasurer'));
create policy expenses_update on expenses for update to authenticated
  using (has_class_role(class_id, 'treasurer')) with check (has_class_role(class_id, 'treasurer'));

/* ===== AUDIT LOG ===== */
-- Thủ quỹ chỉ xem log tài chính của lớp mình; quản trị lớp xem mọi log của lớp mình.
create policy audit_select on audit_logs for select to authenticated
  using (
    is_system_owner()
    or (class_id is not null and has_class_role(class_id, 'admin'))
    or (class_id is not null and has_class_role(class_id, 'treasurer')
        and table_name in ('incomes', 'expenses', 'students', 'periods', '-'))
    or actor_id = auth.uid()
  );
create policy audit_insert_self on audit_logs for insert to authenticated
  with check (actor_id = auth.uid());
-- CỐ Ý không có policy UPDATE/DELETE: audit log bất biến với mọi vai trò.

/* =====================================================================================
   VIEW BÁO CÁO — đều mang class_id để lọc theo lớp
   ===================================================================================== */
drop view if exists v_debt_public;
drop view if exists v_students_public;
drop view if exists v_incomes_public;
drop view if exists v_expenses_public;
drop view if exists v_class_public;
drop view if exists v_daily_ledger;
drop view if exists v_period_progress;
drop view if exists v_student_debt;
drop view if exists v_fund_balance;

create view v_fund_balance as
select c.id as class_id, f.fund,
       coalesce(i.total, 0)                        as total_income,
       coalesce(e.total, 0)                        as total_expense,
       coalesce(i.total, 0) - coalesce(e.total, 0) as balance
from classes c
cross join (select unnest(enum_range(null::fund_type)) as fund) f
left join (select class_id, fund, sum(amount) total from incomes  where deleted_at is null group by class_id, fund) i
       on i.class_id = c.id and i.fund = f.fund
left join (select class_id, fund, sum(amount) total from expenses where deleted_at is null group by class_id, fund) e
       on e.class_id = c.id and e.fund = f.fund;

create view v_student_debt as
select s.class_id, s.id as student_id, s.code, s.full_name,
       p.id as period_id, p.name as period_name, p.fund,
       p.amount_per_student as must_pay,
       coalesce(sum(i.amount), 0) as paid,
       greatest(p.amount_per_student - coalesce(sum(i.amount), 0), 0) as remaining
from students s
join periods p on p.class_id = s.class_id and p.deleted_at is null
left join incomes i on i.student_id = s.id and i.period_id = p.id and i.deleted_at is null
where s.deleted_at is null and s.is_active
group by s.class_id, s.id, s.code, s.full_name, p.id, p.name, p.fund, p.amount_per_student;

create view v_period_progress as
select p.class_id, p.id as period_id, p.name, p.fund, p.amount_per_student, p.status,
       p.open_date, p.due_date,
       count(d.student_id)                                        as student_count,
       coalesce(sum(d.paid), 0)                                   as collected,
       coalesce(sum(d.must_pay), 0)                               as expected,
       coalesce(sum(d.remaining), 0)                              as remaining,
       count(*) filter (where d.remaining = 0 and d.must_pay > 0) as paid_count,
       count(*) filter (where d.paid > 0 and d.remaining > 0)     as partial_count,
       count(*) filter (where d.paid = 0 and d.must_pay > 0)      as unpaid_count
from periods p
left join v_student_debt d on d.period_id = p.id
where p.deleted_at is null
group by p.class_id, p.id, p.name, p.fund, p.amount_per_student, p.status, p.open_date, p.due_date;

create view v_daily_ledger as
with rows as (
  select i.class_id, i.id, i.date, i.fund, 'THU'::text as kind, i.amount,
         coalesce(s.full_name, nullif(btrim(i.payer_name), ''), 'Nguồn khác') as label,
         coalesce(p.name, 'Ngoài đợt') as detail, i.created_at
  from incomes i
  left join students s on s.id = i.student_id
  left join periods  p on p.id = i.period_id
  where i.deleted_at is null
  union all
  select e.class_id, e.id, e.date, e.fund, 'CHI'::text, e.amount, e.item, e.buyer, e.created_at
  from expenses e where e.deleted_at is null
)
select class_id, id, date, fund, kind, amount, label, detail,
       sum(case when kind = 'THU' then amount else -amount end)
         over (partition by class_id, fund order by date, kind desc, created_at, id
               rows between unbounded preceding and current row) as running_balance
from rows;

/* ===== VIEW CÔNG KHAI (role anon) — security_invoker = false để bỏ qua RLS của bảng gốc
        và chỉ để lộ đúng các cột đã lọc ở đây. Ngày sinh và số tài khoản không bao giờ có mặt. */
create view v_classes_public with (security_invoker = false) as
select c.id as class_id, c.code, c.name, c.faculty, c.term, c.school_year,
       c.hide_student_names_from_guest,
       (btrim(c.bank_bin) <> '' and btrim(c.account_no) <> '') as bank_configured,
       (select count(*) from students s where s.class_id = c.id and s.deleted_at is null and s.is_active) as student_count
from classes c where c.is_active;

create view v_students_public with (security_invoker = false) as
select s.class_id, s.id, s.stt, s.class_code,
       case when c.hide_student_names_from_guest then mask_name(s.full_name) else s.full_name end as full_name,
       case when c.hide_student_names_from_guest then '***' || right(s.code, 3) else s.code end   as code
from students s join classes c on c.id = s.class_id
where s.deleted_at is null and s.is_active;

create view v_incomes_public with (security_invoker = false) as
select i.class_id, i.id, i.date, i.fund, i.period_id, i.amount, i.method,
       case when c.hide_student_names_from_guest
            then mask_name(coalesce(s.full_name, nullif(btrim(i.payer_name), ''), 'Nguồn khác'))
            else coalesce(s.full_name, nullif(btrim(i.payer_name), ''), 'Nguồn khác') end as payer,
       coalesce(p.name, 'Ngoài đợt') as period_name
from incomes i
join classes c on c.id = i.class_id
left join students s on s.id = i.student_id
left join periods  p on p.id = i.period_id
where i.deleted_at is null;

create view v_expenses_public with (security_invoker = false) as
select e.class_id, e.id, e.date, e.fund, e.item, e.category, e.buyer, e.amount,
       e.has_receipt, e.overdraft
from expenses e where e.deleted_at is null;

create view v_debt_public with (security_invoker = false) as
select d.class_id, d.student_id, d.period_id, d.period_name, d.fund,
       d.must_pay, d.paid, d.remaining,
       case when c.hide_student_names_from_guest then mask_name(d.full_name) else d.full_name end as full_name,
       case when c.hide_student_names_from_guest then '***' || right(d.code, 3) else d.code end   as code
from v_student_debt d join classes c on c.id = d.class_id;

/* ===== GRANT ===== */
grant select on v_classes_public, v_students_public, v_incomes_public, v_expenses_public,
                v_debt_public, v_fund_balance, v_period_progress to anon, authenticated;
grant select on periods to anon, authenticated;
grant select on v_student_debt, v_daily_ledger to authenticated;
grant select on app_config to anon, authenticated;

-- Chặn triệt để xoá cứng: không cấp DELETE cho anon/authenticated ở bất kỳ bảng nào.
revoke delete on all tables in schema public from anon, authenticated;

-- Bảng cấu hình một dòng của thời trước không dùng nữa; giữ lại để đối chiếu khi cần rồi
-- xoá ở migration sau. Không ai đọc được nữa vì RLS đã bật và không còn policy nào.
comment on table class_settings is 'KHÔNG DÙNG NỮA — đã chuyển sang bảng classes ở 0004_multiclass.sql';
