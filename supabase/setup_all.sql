-- =====================================================================================
-- setup_all.sql — GỘP TỰ ĐỘNG từ supabase/migrations/ (npm run db:bundle)
-- Đừng sửa file này; sửa trong supabase/migrations/ rồi chạy lại lệnh trên.
--
-- Cách dùng: Supabase Dashboard → SQL Editor → New query → dán toàn bộ file → Run.
-- Chạy đúng một lần cho project mới. Thành công thì SQL Editor báo "Success. No rows returned".
-- =====================================================================================

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 0001_schema.sql
-- ─────────────────────────────────────────────────────────────────────────────────────
-- =====================================================================================
-- 0001_schema — Bảng, view và index cho "Quỹ Lớp"
-- =====================================================================================
-- NGUYÊN TẮC BẤT DI BẤT DỊCH (được ràng buộc ngay ở tầng DB, không tin frontend):
--   1. Hai quỹ QUY_LOP / QUY_DOAN tách biệt tuyệt đối; mọi bản ghi thu/chi gắn đúng 1 quỹ.
--   2. Tiền là số nguyên VND (bigint), luôn > 0.
--   3. Tồn quỹ không lưu ở đâu cả — luôn tính từ bản ghi qua view v_fund_balance.
--   4. Không xoá cứng: mọi bảng nghiệp vụ có deleted_at, xoá = soft delete.
--   5. Tiền chỉ vào quỹ khi có người có quyền xác nhận (QR chuyển khoản / thu tay).
-- =====================================================================================

create extension if not exists pgcrypto;

-- ===== ENUM =====
create type fund_type     as enum ('QUY_LOP', 'QUY_DOAN');
create type pay_method    as enum ('CASH', 'TRANSFER');
create type period_status as enum ('OPEN', 'CLOSED');
-- Thứ tự CỐ Ý xếp tăng dần theo quyền hạn, nhờ vậy so sánh role >= 'treasurer' là hợp lệ.
create type app_role      as enum ('member', 'treasurer', 'admin', 'owner');

-- ===== CẤU HÌNH LỚP (đúng 1 dòng, id = 1) =====
create table class_settings (
  id            smallint primary key default 1 check (id = 1),
  class_name    text not null default '',
  faculty       text not null default '',
  term          text not null default '',
  school_year   text not null default '',
  categories    text[] not null default array['Sinh hoạt','Sự kiện','Văn phòng phẩm','Quà tặng','In ấn','Khác'],
  -- bật thì khách chưa đăng nhập chỉ thấy tên viết tắt (Nguyễn V. A.)
  hide_student_names_from_guest boolean not null default false,
  -- Tài khoản nhận chuyển khoản, dùng để sinh QR VietQR cho từng sinh viên
  bank_bin      text not null default '' check (bank_bin = '' or bank_bin ~ '^\d{6}$'),
  bank_name     text not null default '',
  account_no    text not null default '' check (account_no = '' or account_no ~ '^\d{6,20}$'),
  account_name  text not null default '',
  note_template text not null default '{ma} {dot}',
  updated_at    timestamptz not null default now(),
  updated_by    uuid
);
insert into class_settings (id) values (1) on conflict (id) do nothing;

-- ===== SINH VIÊN =====
create table students (
  id          uuid primary key default gen_random_uuid(),
  stt         int,
  code        text not null check (btrim(code) <> ''),   -- Mã SV: LUÔN là text, không bao giờ là số
  last_name   text not null default '',                  -- họ + tên đệm
  first_name  text not null default '',                  -- tên
  full_name   text generated always as (btrim(last_name || ' ' || first_name)) stored,
  dob         date,
  class_code  text not null default '',
  note        text not null default '',
  is_active   boolean not null default true,
  batch_id    uuid,                                      -- gom theo lần import để hoàn tác được
  deleted_at  timestamptz,
  created_at  timestamptz not null default now(),
  -- DB tự ghi người tạo, không phụ thuộc frontend gửi lên (quy tắc xoá trong 24h dựa vào cột này)
  created_by  uuid default auth.uid(),
  constraint students_has_name check (btrim(last_name || first_name) <> '')
);
create unique index students_code_uniq on students (code) where deleted_at is null;
create index students_active_idx on students (is_active) where deleted_at is null;

-- ===== TÀI KHOẢN (1-1 với auth.users) =====
create table profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text not null,
  full_name  text not null default '',
  role       app_role not null default 'member',
  is_active  boolean not null default true,
  student_id uuid references students (id) on delete set null,  -- gắn account với 1 SV để xem "công nợ của tôi"
  created_at timestamptz not null default now(),
  last_sign_in_at timestamptz
);
create unique index profiles_email_uniq on profiles (lower(email));
create index profiles_role_idx on profiles (role) where is_active;

alter table students       add constraint students_created_by_fkey       foreign key (created_by) references profiles (id) on delete set null;
alter table class_settings add constraint class_settings_updated_by_fkey foreign key (updated_by) references profiles (id) on delete set null;

-- ===== LỜI MỜI (không có self-signup tự do) =====
create table invites (
  id          uuid primary key default gen_random_uuid(),
  email       text not null check (position('@' in email) > 1),
  role        app_role not null default 'member',
  student_id  uuid references students (id) on delete set null,
  note        text not null default '',
  invited_by  uuid references profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  accepted_at timestamptz,
  accepted_by uuid references profiles (id) on delete set null,
  revoked_at  timestamptz
);
-- một email chỉ có tối đa 1 lời mời đang chờ
create unique index invites_pending_uniq on invites (lower(email))
  where accepted_at is null and revoked_at is null;

-- ===== ĐỢT THU =====
create table periods (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null check (btrim(name) <> ''),
  fund               fund_type not null,
  amount_per_student bigint not null check (amount_per_student >= 0),
  open_date          date not null default current_date,
  due_date           date,
  status             period_status not null default 'OPEN',
  note               text not null default '',
  deleted_at         timestamptz,
  created_at         timestamptz not null default now(),
  created_by         uuid default auth.uid() references profiles (id) on delete set null,
  constraint periods_due_after_open check (due_date is null or due_date >= open_date)
);
create index periods_fund_idx on periods (fund) where deleted_at is null;

-- ===== THU =====
create table incomes (
  id           uuid primary key default gen_random_uuid(),
  date         date not null default current_date,
  fund         fund_type not null,
  period_id    uuid references periods (id) on delete restrict,
  student_id   uuid references students (id) on delete restrict,
  payer_name   text not null default '',        -- dùng khi thu từ nguồn khác (tài trợ, thầy cô)
  amount       bigint not null check (amount > 0),
  method       pay_method not null default 'CASH',
  collected_by text not null default '',
  note         text not null default '',
  batch_id     uuid,
  deleted_at   timestamptz,
  created_at   timestamptz not null default now(),
  created_by   uuid default auth.uid() references profiles (id) on delete set null,
  constraint incomes_has_payer check (student_id is not null or btrim(payer_name) <> '')
);
create index incomes_fund_date_idx on incomes (fund, date) where deleted_at is null;
create index incomes_student_period_idx on incomes (student_id, period_id) where deleted_at is null;

-- ===== CHI =====
create table expenses (
  id          uuid primary key default gen_random_uuid(),
  date        date not null default current_date,
  fund        fund_type not null,
  item        text not null check (btrim(item) <> ''),   -- mua món gì
  category    text not null default 'Khác',
  buyer       text not null check (btrim(buyer) <> ''),  -- AI đi mua (bắt buộc)
  amount      bigint not null check (amount > 0),
  has_receipt boolean not null default false,
  receipt_url text,
  overdraft   boolean not null default false,            -- lúc ghi nhận đã vượt tồn quỹ
  note        text not null default '',
  deleted_at  timestamptz,
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid() references profiles (id) on delete set null
);
create index expenses_fund_date_idx on expenses (fund, date) where deleted_at is null;

-- ===== AUDIT LOG (bất biến: không có policy update/delete cho bất kỳ ai) =====
create table audit_logs (
  id             bigserial primary key,
  at             timestamptz not null default now(),
  actor_id       uuid references profiles (id) on delete set null,
  actor_email    text not null default '',
  actor_name     text not null default '',
  action         text not null,          -- INSERT | UPDATE | SOFT_DELETE | RESTORE | LOGIN | LOGOUT | IMPORT | EXPORT | ROLE_CHANGE | INVITE
  table_name     text not null,
  record_id      text,
  summary        text not null default '',   -- câu tiếng Việt đọc hiểu ngay
  before_data    jsonb,
  after_data     jsonb,
  changed_fields text[],
  meta           jsonb
);
create index audit_logs_at_idx on audit_logs (at desc);
create index audit_logs_table_idx on audit_logs (table_name, record_id);
create index audit_logs_actor_idx on audit_logs (actor_id, at desc);

-- =====================================================================================
-- VIEW — nguồn sự thật duy nhất cho mọi con số. Không cache, không cột tổng lưu sẵn.
-- =====================================================================================

-- Tồn quỹ từng quỹ: Tồn(X) = Σ Thu(X) − Σ Chi(X)
create view v_fund_balance as
select f.fund,
       coalesce(i.total, 0)                        as total_income,
       coalesce(e.total, 0)                        as total_expense,
       coalesce(i.total, 0) - coalesce(e.total, 0) as balance
from (select unnest(enum_range(null::fund_type)) as fund) f
left join (select fund, sum(amount) as total from incomes  where deleted_at is null group by fund) i on i.fund = f.fund
left join (select fund, sum(amount) as total from expenses where deleted_at is null group by fund) e on e.fund = f.fund;

-- Công nợ từng sinh viên × từng đợt thu
create view v_student_debt as
select s.id                as student_id,
       s.code,
       s.full_name,
       p.id                as period_id,
       p.name              as period_name,
       p.fund,
       p.amount_per_student as must_pay,
       coalesce(sum(i.amount), 0) as paid,
       greatest(p.amount_per_student - coalesce(sum(i.amount), 0), 0) as remaining
from students s
cross join periods p
left join incomes i
       on i.student_id = s.id and i.period_id = p.id and i.deleted_at is null
where s.deleted_at is null and s.is_active and p.deleted_at is null
group by s.id, s.code, s.full_name, p.id, p.name, p.fund, p.amount_per_student;

-- Tiến độ từng đợt thu
create view v_period_progress as
select p.id as period_id, p.name, p.fund, p.amount_per_student, p.status, p.open_date, p.due_date,
       count(d.student_id)                                              as student_count,
       coalesce(sum(d.paid), 0)                                         as collected,
       coalesce(sum(d.must_pay), 0)                                     as expected,
       coalesce(sum(d.remaining), 0)                                    as remaining,
       count(*) filter (where d.remaining = 0 and d.must_pay > 0)       as paid_count,
       count(*) filter (where d.paid > 0 and d.remaining > 0)           as partial_count,
       count(*) filter (where d.paid = 0 and d.must_pay > 0)            as unpaid_count
from periods p
left join v_student_debt d on d.period_id = p.id
where p.deleted_at is null
group by p.id, p.name, p.fund, p.amount_per_student, p.status, p.open_date, p.due_date;

-- Nhật ký gộp thu + chi theo thời gian, kèm số dư luỹ kế của từng quỹ
create view v_daily_ledger as
with rows as (
  select i.id, i.date, i.fund, 'THU'::text as kind, i.amount,
         coalesce(s.full_name, nullif(btrim(i.payer_name), ''), 'Nguồn khác') as label,
         coalesce(p.name, 'Ngoài đợt') as detail, i.created_at
  from incomes i
  left join students s on s.id = i.student_id
  left join periods  p on p.id = i.period_id
  where i.deleted_at is null
  union all
  select e.id, e.date, e.fund, 'CHI'::text, e.amount, e.item, e.buyer, e.created_at
  from expenses e
  where e.deleted_at is null
)
select id, date, fund, kind, amount, label, detail,
       sum(case when kind = 'THU' then amount else -amount end)
         over (partition by fund order by date, kind desc, created_at, id
               rows between unbounded preceding and current row) as running_balance
from rows;

-- Tên viết tắt cho khách chưa đăng nhập: 'Trần Văn Mẫu' → 'Trần V. M.'
create or replace function mask_name(p text) returns text
language sql immutable as $$
  select case
    when p is null or btrim(p) = '' then ''
    else split_part(btrim(p), ' ', 1) || coalesce(
      (select ' ' || string_agg(left(w, 1) || '.', ' ' order by i)
       from unnest(string_to_array(btrim(p), ' ')) with ordinality as u(w, i)
       where i > 1), '')
  end
$$;

-- =====================================================================================
-- VIEW CÔNG KHAI cho khách chưa đăng nhập (role anon)
-- Cố ý dùng security_invoker = false: view chạy bằng quyền của owner nên bỏ qua RLS của
-- bảng gốc, và chỉ để lộ đúng những cột đã được lọc/che ở đây. Ngày sinh KHÔNG bao giờ
-- xuất hiện trong các view này.
-- =====================================================================================
create view v_class_public with (security_invoker = false) as
select class_name, faculty, term, school_year, hide_student_names_from_guest,
       (btrim(bank_bin) <> '' and btrim(account_no) <> '') as bank_configured
from class_settings where id = 1;

create view v_students_public with (security_invoker = false) as
select s.id, s.stt, s.class_code,
       case when c.hide_student_names_from_guest then mask_name(s.full_name) else s.full_name end as full_name,
       case when c.hide_student_names_from_guest then '***' || right(s.code, 3) else s.code end   as code
from students s cross join class_settings c
where s.deleted_at is null and s.is_active and c.id = 1;

create view v_incomes_public with (security_invoker = false) as
select i.id, i.date, i.fund, i.period_id, i.amount, i.method,
       case when c.hide_student_names_from_guest
            then mask_name(coalesce(s.full_name, nullif(btrim(i.payer_name), ''), 'Nguồn khác'))
            else coalesce(s.full_name, nullif(btrim(i.payer_name), ''), 'Nguồn khác') end as payer,
       coalesce(p.name, 'Ngoài đợt') as period_name
from incomes i
left join students s on s.id = i.student_id
left join periods  p on p.id = i.period_id
cross join class_settings c
where i.deleted_at is null and c.id = 1;

create view v_expenses_public with (security_invoker = false) as
select e.id, e.date, e.fund, e.item, e.category, e.buyer, e.amount, e.has_receipt, e.overdraft
from expenses e where e.deleted_at is null;

create view v_debt_public with (security_invoker = false) as
select d.student_id, d.period_id, d.period_name, d.fund, d.must_pay, d.paid, d.remaining,
       case when c.hide_student_names_from_guest then mask_name(d.full_name) else d.full_name end as full_name,
       case when c.hide_student_names_from_guest then '***' || right(d.code, 3) else d.code end   as code
from v_student_debt d cross join class_settings c where c.id = 1;

-- ===== GRANT =====
-- Supabase tự cấp quyền cho anon/authenticated trên schema public, nhưng ghi rõ ở đây để
-- migration chạy được trên một Postgres trắng (dùng khi kiểm thử) và để đọc là hiểu.
grant usage on schema public to anon, authenticated;

grant select on v_class_public, v_students_public, v_incomes_public, v_expenses_public,
                v_debt_public, v_fund_balance, v_period_progress to anon, authenticated;
grant select on periods to anon, authenticated;

grant select on students, incomes, expenses, class_settings, profiles, invites,
                v_student_debt, v_daily_ledger, audit_logs to authenticated;
grant insert, update on students, incomes, expenses to authenticated;
grant insert, update on periods, invites to authenticated;
grant update on class_settings, profiles to authenticated;
grant insert on audit_logs to authenticated;
grant usage, select on sequence audit_logs_id_seq to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 0002_functions.sql
-- ─────────────────────────────────────────────────────────────────────────────────────
-- =====================================================================================
-- 0002_functions — helper quyền, trigger audit, các guard nghiệp vụ và RPC
-- =====================================================================================

-- ===== ĐỊNH DẠNG / NHÃN (dùng trong câu diễn giải của audit log) =====
create or replace function fmt_vnd(v numeric) returns text
language sql immutable as $$
  -- luôn dùng dấu chấm nhóm nghìn, không phụ thuộc lc_numeric của máy chủ
  select replace(to_char(coalesce(v, 0), 'FM999,999,999,999'), ',', '.') || ' ₫'
$$;

create or replace function fund_label(f fund_type) returns text
language sql immutable as $$
  select case f when 'QUY_LOP' then 'Quỹ Lớp' when 'QUY_DOAN' then 'Quỹ Đoàn' else f::text end
$$;

create or replace function role_label(r app_role) returns text
language sql immutable as $$
  select case r when 'owner' then 'chủ sở hữu' when 'admin' then 'quản trị'
                when 'treasurer' then 'thủ quỹ' else 'thành viên' end
$$;

-- ===== QUYỀN =====
-- Trả NULL khi chưa đăng nhập hoặc tài khoản đã bị vô hiệu hoá ⇒ khách không bao giờ
-- được coi là 'member'.
create or replace function current_app_role() returns app_role
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid() and is_active
$$;

create or replace function has_min_role(min app_role) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role from profiles where id = auth.uid() and is_active) >= min, false)
$$;

create or replace function my_student_id() returns uuid
language sql stable security definer set search_path = public as $$
  select student_id from profiles where id = auth.uid() and is_active
$$;

grant execute on function current_app_role(), has_min_role(app_role), my_student_id(),
                          fmt_vnd(numeric), fund_label(fund_type), role_label(app_role),
                          mask_name(text) to anon, authenticated;

-- =====================================================================================
-- AUDIT LOG — do trigger DB ghi, KHÔNG phụ thuộc frontend.
-- =====================================================================================
create or replace function audit_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_old jsonb; v_new jsonb; v_changed text[]; v_action text; v_summary text := '';
  v_actor text; v_actor_id uuid := auth.uid(); v_email text := '';
  v_rec_id text; v_who text;
begin
  select coalesce(nullif(p.full_name, ''), p.email), p.email into v_actor, v_email
    from profiles p where p.id = v_actor_id;
  v_actor := coalesce(v_actor, 'Hệ thống');

  if tg_op = 'INSERT' then
    v_new := to_jsonb(new); v_action := 'INSERT';
  else
    v_old := to_jsonb(old); v_new := to_jsonb(new);
    select coalesce(array_agg(e.key order by e.key), '{}')
      into v_changed
      from jsonb_each(v_new) e
      where e.value is distinct from (v_old -> e.key);
    if array_length(v_changed, 1) is null then
      return new;                                   -- không có gì đổi thì không ghi log
    end if;
    if v_new ? 'deleted_at' then
      if v_old->>'deleted_at' is null and v_new->>'deleted_at' is not null then v_action := 'SOFT_DELETE';
      elsif v_old->>'deleted_at' is not null and v_new->>'deleted_at' is null then v_action := 'RESTORE';
      else v_action := 'UPDATE';
      end if;
    else
      v_action := 'UPDATE';
    end if;
  end if;
  v_rec_id := coalesce(v_new->>'id', v_old->>'id');

  -- Câu diễn giải tiếng Việt, đọc là hiểu ngay
  if tg_table_name = 'incomes' then
    select coalesce(s.full_name, nullif(btrim(new.payer_name), ''), 'Nguồn khác') into v_who
      from (select 1) x left join students s on s.id = new.student_id;
    v_summary := case v_action
      when 'INSERT' then format('%s đã ghi nhận thu %s từ %s vào %s%s', v_actor, fmt_vnd(new.amount), v_who,
             fund_label(new.fund), case when new.method = 'TRANSFER' then ' (chuyển khoản)' else ' (tiền mặt)' end)
      when 'SOFT_DELETE' then format('%s đã xoá khoản thu %s của %s (%s)', v_actor, fmt_vnd(old.amount), v_who, fund_label(old.fund))
      when 'RESTORE' then format('%s đã phục hồi khoản thu %s của %s', v_actor, fmt_vnd(new.amount), v_who)
      else case when new.amount is distinct from old.amount
             then format('%s đã sửa số tiền thu của %s: %s → %s', v_actor, v_who, fmt_vnd(old.amount), fmt_vnd(new.amount))
             else format('%s đã sửa khoản thu của %s (%s)', v_actor, v_who, array_to_string(v_changed, ', ')) end
      end;

  elsif tg_table_name = 'expenses' then
    v_summary := case v_action
      when 'INSERT' then format('%s đã thêm khoản chi %s (%s) rút từ %s, người đi mua: %s%s', v_actor,
             fmt_vnd(new.amount), new.item, fund_label(new.fund), new.buyer,
             case when new.overdraft then ' — VƯỢT TỒN QUỸ' else '' end)
      when 'SOFT_DELETE' then format('%s đã xoá khoản chi %s (%s) của %s', v_actor, fmt_vnd(old.amount), old.item, fund_label(old.fund))
      when 'RESTORE' then format('%s đã phục hồi khoản chi %s (%s)', v_actor, fmt_vnd(new.amount), new.item)
      else case when new.amount is distinct from old.amount
             then format('%s đã sửa số tiền chi "%s": %s → %s', v_actor, new.item, fmt_vnd(old.amount), fmt_vnd(new.amount))
             else format('%s đã sửa khoản chi "%s" (%s)', v_actor, new.item, array_to_string(v_changed, ', ')) end
      end;

  elsif tg_table_name = 'students' then
    v_summary := case v_action
      when 'INSERT' then format('%s đã thêm sinh viên %s (%s)', v_actor, new.full_name, new.code)
      when 'SOFT_DELETE' then format('%s đã xoá sinh viên %s (%s)', v_actor, old.full_name, old.code)
      when 'RESTORE' then format('%s đã phục hồi sinh viên %s', v_actor, new.full_name)
      else case when new.is_active is distinct from old.is_active
             then format('%s đã %s sinh viên %s', v_actor,
                    case when new.is_active then 'cho học lại' else 'ẩn' end, new.full_name)
             else format('%s đã sửa thông tin sinh viên %s (%s)', v_actor, new.full_name, array_to_string(v_changed, ', ')) end
      end;

  elsif tg_table_name = 'periods' then
    v_summary := case v_action
      when 'INSERT' then format('%s đã tạo đợt thu "%s" — %s, %s/SV', v_actor, new.name, fund_label(new.fund), fmt_vnd(new.amount_per_student))
      when 'SOFT_DELETE' then format('%s đã xoá đợt thu "%s"', v_actor, old.name)
      when 'RESTORE' then format('%s đã phục hồi đợt thu "%s"', v_actor, new.name)
      else case when new.status is distinct from old.status
             then format('%s đã %s đợt thu "%s"', v_actor, case when new.status = 'CLOSED' then 'đóng' else 'mở lại' end, new.name)
             when new.amount_per_student is distinct from old.amount_per_student
             then format('%s đã sửa mức thu đợt "%s": %s → %s', v_actor, new.name,
                    fmt_vnd(old.amount_per_student), fmt_vnd(new.amount_per_student))
             else format('%s đã sửa đợt thu "%s" (%s)', v_actor, new.name, array_to_string(v_changed, ', ')) end
      end;

  elsif tg_table_name = 'profiles' then
    if v_action = 'INSERT' then
      v_summary := format('Tài khoản %s được tạo với vai trò %s', new.email, role_label(new.role));
    elsif new.role is distinct from old.role then
      v_action := 'ROLE_CHANGE';
      v_summary := format('%s đã đổi vai trò của %s: %s → %s', v_actor,
        coalesce(nullif(new.full_name, ''), new.email), role_label(old.role), role_label(new.role));
    elsif new.is_active is distinct from old.is_active then
      v_summary := format('%s đã %s tài khoản %s', v_actor,
        case when new.is_active then 'kích hoạt lại' else 'vô hiệu hoá' end,
        coalesce(nullif(new.full_name, ''), new.email));
    elsif v_changed = array['last_sign_in_at'] then
      return new;                                   -- đăng nhập đã có log riêng, không ghi trùng
    else
      v_summary := format('%s đã cập nhật tài khoản %s (%s)', v_actor,
        coalesce(nullif(new.full_name, ''), new.email), array_to_string(v_changed, ', '));
    end if;

  elsif tg_table_name = 'invites' then
    v_action := case when v_action = 'INSERT' then 'INVITE' else v_action end;
    v_summary := case
      when v_action = 'INVITE' then format('%s đã mời %s với vai trò %s', v_actor, new.email, role_label(new.role))
      when new.revoked_at is not null and old.revoked_at is null then format('%s đã thu hồi lời mời %s', v_actor, new.email)
      when new.accepted_at is not null and old.accepted_at is null then format('%s đã nhận lời mời và tạo tài khoản', new.email)
      else format('%s đã sửa lời mời %s', v_actor, new.email) end;

  elsif tg_table_name = 'class_settings' then
    v_summary := case
      when v_changed && array['bank_bin','account_no','account_name','note_template']
        then format('%s đã cập nhật tài khoản nhận chuyển khoản (%s %s)', v_actor, new.bank_name, new.account_no)
      else format('%s đã cập nhật cấu hình lớp (%s)', v_actor, array_to_string(v_changed, ', ')) end;
  else
    v_summary := format('%s đã thay đổi %s', v_actor, tg_table_name);
  end if;

  insert into audit_logs (actor_id, actor_email, actor_name, action, table_name, record_id,
                          summary, before_data, after_data, changed_fields)
  values (v_actor_id, coalesce(v_email, ''), v_actor, v_action, tg_table_name, v_rec_id,
          v_summary, v_old, v_new, v_changed);
  return new;
end $$;

create trigger audit_students       after insert or update on students       for each row execute function audit_trigger();
create trigger audit_periods        after insert or update on periods        for each row execute function audit_trigger();
create trigger audit_incomes        after insert or update on incomes        for each row execute function audit_trigger();
create trigger audit_expenses       after insert or update on expenses       for each row execute function audit_trigger();
create trigger audit_profiles       after insert or update on profiles       for each row execute function audit_trigger();
create trigger audit_invites        after insert or update on invites        for each row execute function audit_trigger();
create trigger audit_class_settings after update           on class_settings for each row execute function audit_trigger();

-- =====================================================================================
-- GUARD — ràng buộc nghiệp vụ không diễn đạt được bằng CHECK hay RLS
-- =====================================================================================

-- 1. Quỹ của khoản thu phải trùng quỹ của đợt thu (giữ hai quỹ tách biệt tuyệt đối)
create or replace function guard_income_fund() returns trigger
language plpgsql set search_path = public as $$
declare v_fund fund_type;
begin
  if new.period_id is not null then
    select fund into v_fund from periods where id = new.period_id;
    if v_fund is distinct from new.fund then
      raise exception 'Đợt thu này thuộc %, không thể ghi khoản thu vào %',
        fund_label(v_fund), fund_label(new.fund) using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
create trigger guard_incomes_fund before insert or update on incomes
  for each row execute function guard_income_fund();

-- 2. Xoá mềm: thủ quỹ chỉ xoá bản ghi của chính mình trong 24h; phục hồi chỉ dành cho quản trị
create or replace function guard_soft_delete() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;               -- tiến trình hệ thống / service role
  if old.deleted_at is null and new.deleted_at is not null then
    if has_min_role('admin') then return new; end if;
    if not has_min_role('treasurer') then
      raise exception 'Bạn không có quyền xoá bản ghi này' using errcode = '42501';
    end if;
    if old.created_by is distinct from auth.uid() then
      raise exception 'Thủ quỹ chỉ xoá được bản ghi do chính mình tạo — hãy nhờ quản trị' using errcode = '42501';
    end if;
    if old.created_at < now() - interval '24 hours' then
      raise exception 'Bản ghi đã quá 24 giờ, thủ quỹ không xoá được nữa — hãy nhờ quản trị' using errcode = '42501';
    end if;
  elsif old.deleted_at is not null and new.deleted_at is null then
    if not has_min_role('admin') then
      raise exception 'Chỉ quản trị hoặc chủ sở hữu được phục hồi bản ghi đã xoá' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger guard_students_delete before update on students for each row execute function guard_soft_delete();
create trigger guard_periods_delete  before update on periods  for each row execute function guard_soft_delete();
create trigger guard_incomes_delete  before update on incomes  for each row execute function guard_soft_delete();
create trigger guard_expenses_delete before update on expenses for each row execute function guard_soft_delete();

-- 3. Không xoá được đợt thu / sinh viên đang có khoản thu (sẽ làm mất dấu tiền)
create or replace function guard_period_in_use() returns trigger
language plpgsql set search_path = public as $$
begin
  if old.deleted_at is null and new.deleted_at is not null
     and exists (select 1 from incomes where period_id = old.id and deleted_at is null) then
    raise exception 'Đợt thu "%" đã có khoản thu — hãy đóng đợt thay vì xoá', old.name using errcode = '23503';
  end if;
  if new.fund is distinct from old.fund
     and exists (select 1 from incomes where period_id = old.id and deleted_at is null) then
    raise exception 'Đợt thu đã có khoản thu, đổi quỹ sẽ làm lệch số liệu hai quỹ' using errcode = '23503';
  end if;
  return new;
end $$;
create trigger guard_periods_in_use before update on periods
  for each row execute function guard_period_in_use();

create or replace function guard_student_in_use() returns trigger
language plpgsql set search_path = public as $$
begin
  if old.deleted_at is null and new.deleted_at is not null
     and exists (select 1 from incomes where student_id = old.id and deleted_at is null) then
    raise exception 'Sinh viên % đã có khoản thu — hãy ẩn khỏi danh sách thay vì xoá', old.full_name using errcode = '23503';
  end if;
  return new;
end $$;
create trigger guard_students_in_use before update on students
  for each row execute function guard_student_in_use();

-- 4. Bảo vệ tài khoản: luôn còn ít nhất 1 chủ sở hữu, admin không tự phong owner
create or replace function guard_profile_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_role app_role := current_app_role();
begin
  if auth.uid() is null then return new; end if;               -- tiến trình hệ thống

  if new.role is distinct from old.role or new.is_active is distinct from old.is_active then
    if v_role is distinct from 'owner' then
      if old.role = 'owner' then
        raise exception 'Chỉ chủ sở hữu được sửa tài khoản chủ sở hữu' using errcode = '42501';
      end if;
      if new.role = 'owner' then
        raise exception 'Chỉ chủ sở hữu được cấp quyền chủ sở hữu' using errcode = '42501';
      end if;
    end if;
    if new.id = auth.uid() and new.role is distinct from old.role then
      raise exception 'Không thể tự đổi vai trò của chính mình' using errcode = '42501';
    end if;
  end if;

  if old.role = 'owner' and (new.role <> 'owner' or not new.is_active) then
    if (select count(*) from profiles where role = 'owner' and is_active and id <> old.id) = 0 then
      raise exception 'Phải luôn còn ít nhất một chủ sở hữu đang hoạt động' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
create trigger guard_profiles_change before update on profiles
  for each row execute function guard_profile_change();

-- =====================================================================================
-- ĐĂNG KÝ CHỈ QUA LỜI MỜI
-- Người đăng ký đầu tiên trở thành chủ sở hữu; sau đó email phải có lời mời hợp lệ.
-- =====================================================================================
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_invite invites; v_profiles int; v_name text;
begin
  v_name := coalesce(nullif(new.raw_user_meta_data->>'full_name', ''), split_part(new.email, '@', 1));
  select * into v_invite from invites
    where lower(email) = lower(new.email) and accepted_at is null and revoked_at is null
    order by created_at desc limit 1;
  select count(*) into v_profiles from profiles;

  if v_invite.id is null then
    if v_profiles > 0 then
      raise exception 'Email % chưa được mời vào hệ thống Class Fund', new.email using errcode = '42501';
    end if;
    insert into profiles (id, email, full_name, role) values (new.id, new.email, v_name, 'owner');
  else
    insert into profiles (id, email, full_name, role, student_id)
      values (new.id, new.email, v_name, v_invite.role, v_invite.student_id);
    update invites set accepted_at = now(), accepted_by = new.id where id = v_invite.id;
  end if;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

-- =====================================================================================
-- RPC
-- =====================================================================================

-- Ghi các sự kiện không sinh ra từ bảng: LOGIN / LOGOUT / EXPORT / IMPORT
create or replace function log_event(p_action text, p_summary text, p_meta jsonb default null)
returns void
language plpgsql security definer set search_path = public as $$
declare v_email text; v_name text;
begin
  if auth.uid() is null then
    raise exception 'Chưa đăng nhập' using errcode = '42501';
  end if;
  if p_action not in ('LOGIN', 'LOGOUT', 'EXPORT', 'IMPORT', 'VIEW_QR') then
    raise exception 'Loại sự kiện không hợp lệ: %', p_action using errcode = '22023';
  end if;
  select email, coalesce(nullif(full_name, ''), email) into v_email, v_name
    from profiles where id = auth.uid();
  insert into audit_logs (actor_id, actor_email, actor_name, action, table_name, summary, meta)
    values (auth.uid(), coalesce(v_email, ''), coalesce(v_name, ''), p_action, '-', left(p_summary, 500), p_meta);
  if p_action = 'LOGIN' then
    update profiles set last_sign_in_at = now() where id = auth.uid();
  end if;
end $$;

-- Import danh sách lớp trong MỘT transaction. Chỉ tạo/cập nhật sinh viên —
-- không bao giờ tạo khoản thu từ cột "Số tiền"/"Trạng thái" của file Excel.
create or replace function import_students(p_rows jsonb, p_dedupe text default 'skip')
returns jsonb
language plpgsql set search_path = public as $$
declare
  v_batch uuid := gen_random_uuid();
  r jsonb; v_existing students; v_added int := 0; v_updated int := 0; v_skipped int := 0; v_failed int := 0;
  v_code text; v_max_stt int;
begin
  if not has_min_role('treasurer') then
    raise exception 'Bạn không có quyền nhập danh sách lớp' using errcode = '42501';
  end if;
  if p_dedupe not in ('skip', 'update', 'insert') then
    raise exception 'Chế độ chống trùng không hợp lệ: %', p_dedupe using errcode = '22023';
  end if;
  select coalesce(max(stt), 0) into v_max_stt from students where deleted_at is null;

  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    v_code := btrim(coalesce(r->>'code', ''));
    if v_code = '' or btrim(coalesce(r->>'last_name', '') || coalesce(r->>'first_name', '')) = '' then
      v_failed := v_failed + 1;
      continue;
    end if;
    select * into v_existing from students where code = v_code and deleted_at is null limit 1;

    if v_existing.id is not null and p_dedupe = 'skip' then
      v_skipped := v_skipped + 1;
    elsif v_existing.id is not null and p_dedupe = 'update' then
      update students set
        stt        = coalesce((r->>'stt')::int, stt),
        last_name  = coalesce(r->>'last_name', last_name),
        first_name = coalesce(r->>'first_name', first_name),
        dob        = coalesce((r->>'dob')::date, dob),
        class_code = coalesce(nullif(r->>'class_code', ''), class_code),
        note       = coalesce(nullif(r->>'note', ''), note)
      where id = v_existing.id;
      v_updated := v_updated + 1;
    else
      v_max_stt := v_max_stt + 1;
      insert into students (stt, code, last_name, first_name, dob, class_code, note, batch_id, created_by)
      values (coalesce((r->>'stt')::int, v_max_stt),
              case when v_existing.id is null then v_code else v_code || '-' || left(v_batch::text, 4) end,
              coalesce(r->>'last_name', ''), coalesce(r->>'first_name', ''),
              (r->>'dob')::date, coalesce(r->>'class_code', ''), coalesce(r->>'note', ''),
              v_batch, auth.uid());
      v_added := v_added + 1;
    end if;
  end loop;

  insert into audit_logs (actor_id, actor_email, actor_name, action, table_name, record_id, summary, meta)
  select auth.uid(), coalesce(p.email, ''), coalesce(nullif(p.full_name, ''), p.email), 'IMPORT', 'students',
         v_batch::text,
         format('%s đã nhập danh sách lớp: thêm %s, cập nhật %s, bỏ qua %s, lỗi %s',
                coalesce(nullif(p.full_name, ''), p.email, 'Người dùng'), v_added, v_updated, v_skipped, v_failed),
         jsonb_build_object('batch_id', v_batch, 'dedupe', p_dedupe, 'rows', jsonb_array_length(coalesce(p_rows, '[]'::jsonb)))
  from profiles p where p.id = auth.uid();

  return jsonb_build_object('batch_id', v_batch, 'added', v_added, 'updated', v_updated,
                            'skipped', v_skipped, 'failed', v_failed);
end $$;

-- Hoàn tác một lần import: xoá mềm đúng những sinh viên của batch đó
create or replace function undo_import(p_batch uuid)
returns jsonb
language plpgsql set search_path = public as $$
declare v_students int;
begin
  if not has_min_role('treasurer') then
    raise exception 'Bạn không có quyền hoàn tác import' using errcode = '42501';
  end if;
  update students set deleted_at = now() where batch_id = p_batch and deleted_at is null;
  get diagnostics v_students = row_count;
  return jsonb_build_object('students', v_students);
end $$;

grant execute on function log_event(text, text, jsonb),
                          import_students(jsonb, text),
                          undo_import(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 0003_rls.sql
-- ─────────────────────────────────────────────────────────────────────────────────────
-- =====================================================================================
-- 0003_rls — Row Level Security
-- Phân quyền được thực thi Ở ĐÂY, trong Postgres. Frontend chỉ ẩn nút cho gọn giao diện;
-- kể cả khi ai đó gọi API trực tiếp bằng anon key thì vẫn không vượt qua được các policy này.
--
-- MA TRẬN QUYỀN
--   guest (chưa đăng nhập) : chỉ đọc các view công khai (không có ngày sinh, không có audit log)
--   member                 : đọc toàn bộ số liệu + xem công nợ của chính mình
--   treasurer (thủ quỹ)    : + thêm/sửa thu, chi, sinh viên, import danh sách
--   admin (quản trị)       : + đợt thu, cấu hình lớp, tài khoản, phục hồi bản ghi đã xoá
--   owner (chủ sở hữu)     : + cấp/thu quyền owner
-- =====================================================================================

alter table class_settings enable row level security;
alter table profiles       enable row level security;
alter table invites        enable row level security;
alter table students       enable row level security;
alter table periods        enable row level security;
alter table incomes        enable row level security;
alter table expenses       enable row level security;
alter table audit_logs     enable row level security;

-- ===== CẤU HÌNH LỚP =====
-- Khách chỉ xem được view v_class_public (không có số tài khoản).
create policy class_settings_select on class_settings for select to authenticated
  using (has_min_role('member'));
create policy class_settings_update on class_settings for update to authenticated
  using (has_min_role('admin')) with check (has_min_role('admin'));

-- ===== TÀI KHOẢN =====
create policy profiles_select_self_or_admin on profiles for select to authenticated
  using (id = auth.uid() or has_min_role('admin'));
create policy profiles_update_self_or_admin on profiles for update to authenticated
  using (id = auth.uid() or has_min_role('admin'))
  with check (id = auth.uid() or has_min_role('admin'));
-- Không có policy INSERT: profile chỉ được tạo bởi trigger handle_new_user() (security definer).
-- Không có policy DELETE: vô hiệu hoá tài khoản thay vì xoá, để giữ nguyên vết trong audit log.

-- ===== LỜI MỜI =====
create policy invites_admin_select on invites for select to authenticated using (has_min_role('admin'));
create policy invites_admin_insert on invites for insert to authenticated with check (has_min_role('admin'));
create policy invites_admin_update on invites for update to authenticated
  using (has_min_role('admin')) with check (has_min_role('admin'));

-- ===== SINH VIÊN =====
create policy students_select on students for select to authenticated using (has_min_role('member'));
create policy students_insert on students for insert to authenticated with check (has_min_role('treasurer'));
create policy students_update on students for update to authenticated
  using (has_min_role('treasurer')) with check (has_min_role('treasurer'));

-- ===== ĐỢT THU (công khai để cả lớp biết phải nộp bao nhiêu) =====
create policy periods_select_public on periods for select to anon, authenticated using (deleted_at is null);
create policy periods_insert_admin  on periods for insert to authenticated with check (has_min_role('admin'));
create policy periods_update_admin  on periods for update to authenticated
  using (has_min_role('admin')) with check (has_min_role('admin'));

-- ===== THU =====
create policy incomes_select on incomes for select to authenticated using (has_min_role('member'));
create policy incomes_insert on incomes for insert to authenticated with check (has_min_role('treasurer'));
create policy incomes_update on incomes for update to authenticated
  using (has_min_role('treasurer')) with check (has_min_role('treasurer'));

-- ===== CHI =====
create policy expenses_select on expenses for select to authenticated using (has_min_role('member'));
create policy expenses_insert on expenses for insert to authenticated with check (has_min_role('treasurer'));
create policy expenses_update on expenses for update to authenticated
  using (has_min_role('treasurer')) with check (has_min_role('treasurer'));

-- ===== AUDIT LOG =====
-- Thủ quỹ chỉ xem log các bảng tài chính, không xem log tài khoản / lời mời / cấu hình.
create policy audit_select on audit_logs for select to authenticated
  using (
    has_min_role('admin')
    or (has_min_role('treasurer') and table_name in ('incomes', 'expenses', 'students', 'periods', '-'))
  );
create policy audit_insert_self on audit_logs for insert to authenticated
  with check (actor_id = auth.uid());
-- CỐ Ý không có policy UPDATE/DELETE: audit log là bất biến với mọi vai trò.

-- Chặn triệt để việc xoá cứng: không cấp quyền DELETE cho anon/authenticated ở bất kỳ bảng nào.
revoke delete on all tables in schema public from anon, authenticated;

