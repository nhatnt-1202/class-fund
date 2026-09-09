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
-- LƯU Ý: 0004_multiclass.sql thay thế hàm này để ghi thêm class_id. Sửa ở đây thì phải sửa cả ở đó.
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
      raise exception 'Email % chưa được mời vào hệ thống Finance', new.email using errcode = '42501';
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

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 0004_multiclass.sql
-- ─────────────────────────────────────────────────────────────────────────────────────
-- =====================================================================================
-- 0004_multiclass — Mở rộng từ MỘT lớp sang NHIỀU LỚP, và đăng ký tự do theo email trường
-- =====================================================================================
-- Ba thay đổi lớn:
--
--   1. Mọi dữ liệu nghiệp vụ gắn với một LỚP (class_id). Không còn bảng cấu hình một dòng.
--   2. Quyền không còn ở tầng hệ thống mà ở tầng LỚP: bảng memberships nói người này có vai
--      trò gì TRONG LỚP NÀO. Chỉ vai trò "chủ sở hữu hệ thống" là toàn cục (để dựng ban đầu
--      và cứu hộ).
--   3. Đăng ký tự do bằng email trường dạng <mã SV>@student.humg.edu.vn: trigger tự tách mã
--      SV từ email, tìm sinh viên trùng mã trong các lớp và cấp quyền thành viên đúng lớp đó.
--      Email KHÔNG đúng dạng thì vẫn phải có lời mời (dành cho giáo viên, phụ huynh…).
--
-- Nguyên tắc bất di bất dịch được giữ nguyên và bổ sung:
--   • Hai quỹ tách biệt tuyệt đối · tiền là số nguyên · tồn quỹ luôn tính từ bản ghi
--   • KHÔNG lớp nào đọc hay ghi được dữ liệu của lớp khác (xem 0005_multiclass_rls.sql)
-- =====================================================================================

/* ============================== DỌN POLICY CỦA THỜI MỘT LỚP ==============================
   Phải xoá trước khi thay các hàm quyền: policy đang phụ thuộc has_min_role() nên Postgres
   sẽ chặn việc drop hàm. Policy mới được tạo lại ở 0005_multiclass_rls.sql.
   ====================================================================================== */
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

/* ============================== CẤU HÌNH HỆ THỐNG ============================== */
create table app_config (
  id smallint primary key default 1 check (id = 1),
  -- Email dạng <mã SV>@<domain này> được đăng ký tự do, không cần lời mời.
  student_email_domain text not null default 'student.humg.edu.vn',
  -- Mã SV trong email phải khớp mẫu này (mặc định: 8–12 chữ số).
  student_code_pattern text not null default '^[0-9]{8,12}$',
  updated_at timestamptz not null default now()
);
insert into app_config (id) values (1) on conflict (id) do nothing;

/* ============================== LỚP ============================== */
create table classes (
  id           uuid primary key default gen_random_uuid(),
  code         text not null,
  name         text not null default '',
  faculty      text not null default '',
  term         text not null default '',
  school_year  text not null default '',
  categories   text[] not null default array['Sinh hoạt','Sự kiện','Văn phòng phẩm','Quà tặng','In ấn','Khác'],
  hide_student_names_from_guest boolean not null default false,
  -- Tài khoản nhận chuyển khoản của RIÊNG lớp này (mỗi lớp một thủ quỹ khác nhau)
  bank_bin     text not null default '' check (bank_bin = '' or bank_bin ~ '^\d{6}$'),
  bank_name    text not null default '',
  account_no   text not null default '' check (account_no = '' or account_no ~ '^\d{6,20}$'),
  account_name text not null default '',
  note_template text not null default '{ma} {dot}',
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  created_by   uuid references profiles (id) on delete set null,
  updated_at   timestamptz not null default now()
);
create unique index classes_code_uniq on classes (upper(btrim(code)));

-- Chuyển dữ liệu cũ: cấu hình một dòng trở thành lớp đầu tiên
insert into classes (code, name, faculty, term, school_year, categories,
                     hide_student_names_from_guest, bank_bin, bank_name, account_no,
                     account_name, note_template)
select coalesce(nullif(btrim(class_name), ''), 'LOP-1'), class_name, faculty, term, school_year,
       categories, hide_student_names_from_guest, bank_bin, bank_name, account_no,
       account_name, note_template
from class_settings where id = 1;

/* ============================== GẮN DỮ LIỆU VÀO LỚP ============================== */
alter table students  add column class_id uuid references classes (id) on delete restrict;
alter table periods   add column class_id uuid references classes (id) on delete restrict;
alter table incomes   add column class_id uuid references classes (id) on delete restrict;
alter table expenses  add column class_id uuid references classes (id) on delete restrict;
alter table invites   add column class_id uuid references classes (id) on delete cascade;
alter table audit_logs add column class_id uuid references classes (id) on delete set null;

update students  set class_id = (select id from classes order by created_at limit 1);
update periods   set class_id = (select id from classes order by created_at limit 1);
update incomes   set class_id = (select id from classes order by created_at limit 1);
update expenses  set class_id = (select id from classes order by created_at limit 1);
update invites   set class_id = (select id from classes order by created_at limit 1);
update audit_logs set class_id = (select id from classes order by created_at limit 1);

-- Lời mời luôn là mời vào MỘT lớp cụ thể
alter table invites alter column class_id set not null;

alter table students add constraint students_class_id_not_null check (class_id is not null) not valid;
alter table students validate constraint students_class_id_not_null;
alter table periods  alter column class_id set not null;
alter table incomes  alter column class_id set not null;
alter table expenses alter column class_id set not null;
alter table students alter column class_id set not null;

-- Mã SV chỉ cần duy nhất TRONG MỘT LỚP: hai lớp khác nhau có thể có mã trùng nhau
drop index if exists students_code_uniq;
create unique index students_code_class_uniq on students (class_id, code) where deleted_at is null;
create index students_class_idx on students (class_id) where deleted_at is null;
create index periods_class_idx  on periods  (class_id) where deleted_at is null;
create index incomes_class_idx  on incomes  (class_id) where deleted_at is null;
create index expenses_class_idx on expenses (class_id) where deleted_at is null;
create index audit_logs_class_idx on audit_logs (class_id, at desc);

/* ============================== VAI TRÒ THEO LỚP ============================== */
-- Thứ tự tăng dần theo quyền hạn để so sánh role >= 'treasurer' là hợp lệ.
create type class_role as enum ('member', 'treasurer', 'admin');

create table memberships (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles (id) on delete cascade,
  class_id   uuid not null references classes (id) on delete cascade,
  role       class_role not null default 'member',
  -- Gắn với sinh viên trong đúng lớp đó, để xem "công nợ của tôi"
  student_id uuid references students (id) on delete set null,
  created_at timestamptz not null default now(),
  created_by uuid references profiles (id) on delete set null,
  unique (user_id, class_id)
);
create index memberships_user_idx on memberships (user_id);
create index memberships_class_idx on memberships (class_id, role);

-- Chuyển quyền cũ: mọi tài khoản đang có trở thành thành viên của lớp đầu tiên với vai trò
-- tương đương. Riêng owner vẫn giữ vai trò hệ thống (profiles.role) để cứu hộ.
insert into memberships (user_id, class_id, role, student_id)
select p.id, (select id from classes order by created_at limit 1),
       case p.role when 'owner' then 'admin' when 'admin' then 'admin'
                   when 'treasurer' then 'treasurer' else 'member' end::class_role,
       p.student_id
from profiles p
on conflict (user_id, class_id) do nothing;

-- profiles.role từ nay chỉ còn hai giá trị có nghĩa: 'owner' (chủ sở hữu hệ thống) và
-- 'member' (người dùng thường). Quyền trong lớp nằm ở memberships.
comment on column profiles.role is
  'Vai trò HỆ THỐNG: chỉ owner có nghĩa (dựng hệ thống, tạo lớp, cứu hộ). Quyền trong từng lớp xem bảng memberships.';
comment on column profiles.student_id is
  'Không dùng nữa — đã chuyển sang memberships.student_id vì một người có thể ở nhiều lớp.';

/* ============================== HÀM QUYỀN ============================== */
create or replace function is_system_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'owner' from profiles where id = auth.uid() and is_active), false)
$$;

/** Vai trò của người đang đăng nhập TRONG một lớp. NULL nếu không thuộc lớp đó. */
create or replace function my_class_role(p_class uuid) returns class_role
language sql stable security definer set search_path = public as $$
  select m.role from memberships m
  join profiles p on p.id = m.user_id and p.is_active
  where m.user_id = auth.uid() and m.class_id = p_class
$$;

/**
 * Có quyền tối thiểu `min` trong lớp `p_class` hay không.
 * Chủ sở hữu hệ thống được coi như admin của mọi lớp — cần thiết để dựng lớp mới và cứu hộ
 * khi lớp không còn ai quản trị.
 */
create or replace function has_class_role(p_class uuid, min class_role) returns boolean
language sql stable security definer set search_path = public as $$
  select is_system_owner() or coalesce(my_class_role(p_class) >= min, false)
$$;

/** Các lớp người đang đăng nhập được phép xem. Chủ sở hữu hệ thống thấy tất cả. */
create or replace function my_class_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select c.id from classes c where is_system_owner()
  union
  select m.class_id from memberships m
  join profiles p on p.id = m.user_id and p.is_active
  where m.user_id = auth.uid()
$$;

/** Sinh viên gắn với tài khoản đang đăng nhập trong một lớp. */
create or replace function my_student_id(p_class uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select student_id from memberships where user_id = auth.uid() and class_id = p_class
$$;

drop function if exists has_min_role(app_role);
drop function if exists current_app_role();
drop function if exists my_student_id();

grant execute on function is_system_owner(), my_class_role(uuid), has_class_role(uuid, class_role),
                          my_class_ids(), my_student_id(uuid) to anon, authenticated;

/* ============================== GUARD CẬP NHẬT THEO LỚP ============================== */
-- Quỹ của khoản thu phải khớp quỹ của đợt, VÀ đợt phải cùng lớp với khoản thu
create or replace function guard_income_fund() returns trigger
language plpgsql set search_path = public as $$
declare v_fund fund_type; v_class uuid;
begin
  if new.period_id is not null then
    select fund, class_id into v_fund, v_class from periods where id = new.period_id;
    if v_fund is distinct from new.fund then
      raise exception 'Đợt thu này thuộc %, không thể ghi khoản thu vào %',
        fund_label(v_fund), fund_label(new.fund) using errcode = '23514';
    end if;
    if v_class is distinct from new.class_id then
      raise exception 'Đợt thu thuộc lớp khác — không thể ghi khoản thu chéo lớp' using errcode = '23514';
    end if;
  end if;
  if new.student_id is not null
     and (select class_id from students where id = new.student_id) is distinct from new.class_id then
    raise exception 'Sinh viên thuộc lớp khác — không thể ghi khoản thu chéo lớp' using errcode = '23514';
  end if;
  return new;
end $$;

/* thủ quỹ chỉ xoá bản ghi của mình trong 24h; phục hồi dành cho quản trị của LỚP ĐÓ */
create or replace function guard_soft_delete() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if old.deleted_at is null and new.deleted_at is not null then
    if has_class_role(new.class_id, 'admin') then return new; end if;
    if not has_class_role(new.class_id, 'treasurer') then
      raise exception 'Bạn không có quyền xoá bản ghi này' using errcode = '42501';
    end if;
    if old.created_by is distinct from auth.uid() then
      raise exception 'Thủ quỹ chỉ xoá được bản ghi do chính mình tạo — hãy nhờ quản trị' using errcode = '42501';
    end if;
    if old.created_at < now() - interval '24 hours' then
      raise exception 'Bản ghi đã quá 24 giờ, thủ quỹ không xoá được nữa — hãy nhờ quản trị' using errcode = '42501';
    end if;
  elsif old.deleted_at is not null and new.deleted_at is null then
    if not has_class_role(new.class_id, 'admin') then
      raise exception 'Chỉ quản trị lớp được phục hồi bản ghi đã xoá' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

/* bảo vệ vai trò: chỉ quản trị lớp mới sửa được membership, và không tự đổi vai trò của mình */
create or replace function guard_membership_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if tg_op = 'UPDATE' and new.user_id = auth.uid() and new.role is distinct from old.role then
    raise exception 'Không thể tự đổi vai trò của chính mình trong lớp' using errcode = '42501';
  end if;
  -- lớp phải luôn còn ít nhất một quản trị
  if tg_op = 'UPDATE' and old.role = 'admin' and new.role <> 'admin'
     and (select count(*) from memberships
          where class_id = old.class_id and role = 'admin' and id <> old.id) = 0 then
    raise exception 'Lớp phải luôn còn ít nhất một quản trị' using errcode = '23514';
  end if;
  return new;
end $$;
/**
 * Bảo vệ bảng profiles trong mô hình nhiều lớp.
 * profiles.role giờ chỉ còn nghĩa hệ thống: 'owner' hay không. Quyền trong lớp nằm ở
 * memberships nên guard cũ (dựa trên current_app_role) không còn đúng.
 */
create or replace function guard_profile_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;

  if new.role is distinct from old.role then
    if not is_system_owner() then
      raise exception 'Chỉ chủ sở hữu hệ thống được đổi vai trò hệ thống' using errcode = '42501';
    end if;
    if new.id = auth.uid() then
      raise exception 'Không thể tự đổi vai trò của chính mình' using errcode = '42501';
    end if;
  end if;

  if new.is_active is distinct from old.is_active and not is_system_owner() and new.id <> auth.uid() then
    raise exception 'Chỉ chủ sở hữu hệ thống được vô hiệu hoá tài khoản người khác' using errcode = '42501';
  end if;

  -- hệ thống phải luôn còn ít nhất một chủ sở hữu đang hoạt động
  if old.role = 'owner' and (new.role <> 'owner' or not new.is_active) then
    if (select count(*) from profiles where role = 'owner' and is_active and id <> old.id) = 0 then
      raise exception 'Phải luôn còn ít nhất một chủ sở hữu hệ thống đang hoạt động' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;

create trigger guard_memberships_change before update on memberships
  for each row execute function guard_membership_change();

/* ============================== AUDIT LOG THEO LỚP ==============================
   Bản này THAY THẾ audit_trigger() của 0002_functions.sql: bổ sung class_id (thiếu nó thì
   policy audit theo lớp sẽ ẩn sạch log khỏi quản trị lớp) và diễn giải cho hai bảng mới
   classes, memberships.
   ============================================================================== */
create or replace function audit_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_old jsonb; v_new jsonb; v_changed text[]; v_action text; v_summary text := '';
  v_actor text; v_actor_id uuid := auth.uid(); v_email text := '';
  v_rec_id text; v_who text; v_class uuid;
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
  -- Gắn log vào LỚP của bản ghi. Thiếu cột này thì policy audit theo lớp sẽ ẩn sạch log
  -- khỏi quản trị lớp. Bảng classes thì chính id của nó là lớp; profiles là cấp hệ thống.
  v_class := nullif(coalesce(
    v_new->>'class_id', v_old->>'class_id',
    case when tg_table_name = 'classes' then coalesce(v_new->>'id', v_old->>'id') end
  ), '')::uuid;

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
  elsif tg_table_name = 'classes' then
    v_summary := case v_action
      when 'INSERT' then format('%s đã tạo lớp %s', v_actor, new.code)
      else case when v_changed && array['bank_bin','account_no','account_name','note_template']
             then format('%s đã cập nhật tài khoản nhận chuyển khoản của lớp %s (%s %s)',
                    v_actor, new.code, new.bank_name, new.account_no)
             else format('%s đã cập nhật lớp %s (%s)', v_actor, new.code, array_to_string(v_changed, ', ')) end
      end;

  elsif tg_table_name = 'memberships' then
    select coalesce(nullif(p.full_name, ''), p.email) into v_who from profiles p where p.id = new.user_id;
    v_summary := case
      when v_action = 'INSERT' then format('%s được thêm vào lớp với vai trò %s',
             coalesce(v_who, 'Người dùng'), new.role)
      when new.role is distinct from old.role then format('%s đã đổi vai trò của %s trong lớp: %s → %s',
             v_actor, coalesce(v_who, 'người dùng'), old.role, new.role)
      else format('%s đã cập nhật thành viên %s trong lớp (%s)',
             v_actor, coalesce(v_who, ''), array_to_string(v_changed, ', ')) end;
    if new.role is distinct from old.role then v_action := 'ROLE_CHANGE'; end if;

  else
    v_summary := format('%s đã thay đổi %s', v_actor, tg_table_name);
  end if;

  insert into audit_logs (actor_id, actor_email, actor_name, action, table_name, record_id,
                          summary, before_data, after_data, changed_fields, class_id)
  values (v_actor_id, coalesce(v_email, ''), v_actor, v_action, tg_table_name, v_rec_id,
          v_summary, v_old, v_new, v_changed, v_class);
  return new;
end $$;


create trigger audit_classes     after insert or update on classes     for each row execute function audit_trigger();
create trigger audit_memberships after insert or update on memberships for each row execute function audit_trigger();

/* ============================== ĐĂNG KÝ TỰ DO THEO EMAIL TRƯỜNG ============================== */
/**
 * Tách mã sinh viên từ email dạng <mã SV>@<domain trường>.
 * Trả NULL nếu email không đúng dạng.
 */
create or replace function student_code_from_email(p_email text) returns text
language plpgsql stable set search_path = public as $$
declare v_local text; v_domain text; v_cfg app_config;
begin
  select * into v_cfg from app_config where id = 1;
  v_local  := lower(split_part(btrim(p_email), '@', 1));
  v_domain := lower(split_part(btrim(p_email), '@', 2));
  if v_domain is distinct from lower(v_cfg.student_email_domain) then return null; end if;
  if v_local !~ v_cfg.student_code_pattern then return null; end if;
  return v_local;
end $$;
grant execute on function student_code_from_email(text) to anon, authenticated;

/**
 * Tạo profile khi có người đăng ký.
 *
 * Ba đường vào, theo thứ tự ưu tiên:
 *   1. Người đăng ký ĐẦU TIÊN của hệ thống ⇒ chủ sở hữu hệ thống.
 *   2. Email đúng dạng <mã SV>@<domain trường> ⇒ ĐƯỢC TỰ DO đăng ký. Trigger tìm mọi lớp
 *      có sinh viên trùng mã và cấp vai trò thành viên đúng những lớp đó. Chưa có lớp nào
 *      chứa mã này thì vẫn tạo tài khoản, nhưng chưa thấy lớp nào cho tới khi lớp được nhập
 *      danh sách — tránh việc phải mời từng sinh viên một.
 *   3. Email không đúng dạng (giáo viên, phụ huynh, gmail…) ⇒ phải có lời mời hợp lệ.
 */
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_invite invites; v_profiles int; v_name text; v_code text; v_linked int := 0;
begin
  v_name := coalesce(nullif(new.raw_user_meta_data->>'full_name', ''), split_part(new.email, '@', 1));
  select count(*) into v_profiles from profiles;
  v_code := student_code_from_email(new.email);

  if v_profiles = 0 then
    insert into profiles (id, email, full_name, role) values (new.id, new.email, v_name, 'owner');
    -- chủ sở hữu đầu tiên làm quản trị mọi lớp đang có
    insert into memberships (user_id, class_id, role)
    select new.id, c.id, 'admin' from classes c on conflict do nothing;
    return new;
  end if;

  if v_code is not null then
    insert into profiles (id, email, full_name, role) values (new.id, new.email, v_name, 'member');
    -- Gắn vào mọi lớp có sinh viên trùng mã. Một mã chỉ nên xuất hiện ở một lớp, nhưng nếu
    -- sinh viên học lại hoặc chuyển lớp thì gắn cả hai cũng đúng.
    insert into memberships (user_id, class_id, role, student_id)
    select new.id, s.class_id, 'member', s.id
    from students s where s.code = v_code and s.deleted_at is null
    on conflict (user_id, class_id) do nothing;
    get diagnostics v_linked = row_count;
    insert into audit_logs (actor_id, actor_email, actor_name, action, table_name, record_id, summary, meta)
      values (new.id, new.email, v_name, 'INSERT', 'profiles', new.id::text,
              format('%s (%s) đăng ký bằng email trường và được gắn vào %s lớp', v_name, v_code, v_linked),
              jsonb_build_object('student_code', v_code, 'classes_linked', v_linked));
    return new;
  end if;

  select * into v_invite from invites
    where lower(email) = lower(new.email) and accepted_at is null and revoked_at is null
    order by created_at desc limit 1;
  if v_invite.id is null then
    raise exception 'Email % không đúng dạng <mã sinh viên>@%s và cũng chưa được mời vào hệ thống',
      new.email, (select student_email_domain from app_config where id = 1) using errcode = '42501';
  end if;

  insert into profiles (id, email, full_name, role) values (new.id, new.email, v_name, 'member');
  insert into memberships (user_id, class_id, role, student_id)
    select new.id, v_invite.class_id, case v_invite.role
              when 'admin' then 'admin' when 'treasurer' then 'treasurer' else 'member' end::class_role,
           v_invite.student_id
    where v_invite.class_id is not null
    on conflict (user_id, class_id) do nothing;
  update invites set accepted_at = now(), accepted_by = new.id where id = v_invite.id;
  return new;
end $$;

/**
 * Gắn tài khoản đã có vào lớp mới khi lớp đó vừa nhập danh sách sinh viên.
 * Nhờ vậy sinh viên đăng ký trước khi lớp được tạo vẫn tự thấy lớp của mình.
 */
create or replace function link_students_to_accounts() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into memberships (user_id, class_id, role, student_id)
  select p.id, new.class_id, 'member', new.id
  from profiles p
  where student_code_from_email(p.email) = new.code
  on conflict (user_id, class_id) do update set student_id = excluded.student_id
    where memberships.student_id is null;
  return new;
end $$;
create trigger link_students_after_insert after insert on students
  for each row execute function link_students_to_accounts();

/* ============================== RPC THEO LỚP ============================== */
create or replace function log_event(p_action text, p_summary text, p_meta jsonb default null,
                                     p_class uuid default null)
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
  if p_class is not null and not has_class_role(p_class, 'member') then
    raise exception 'Bạn không thuộc lớp này' using errcode = '42501';
  end if;
  select email, coalesce(nullif(full_name, ''), email) into v_email, v_name
    from profiles where id = auth.uid();
  insert into audit_logs (actor_id, actor_email, actor_name, action, table_name, summary, meta, class_id)
    values (auth.uid(), coalesce(v_email, ''), coalesce(v_name, ''), p_action, '-',
            left(p_summary, 500), p_meta, p_class);
  if p_action = 'LOGIN' then
    update profiles set last_sign_in_at = now() where id = auth.uid();
  end if;
end $$;

create or replace function import_students(p_class uuid, p_rows jsonb, p_dedupe text default 'skip')
returns jsonb
language plpgsql set search_path = public as $$
declare
  v_batch uuid := gen_random_uuid();
  r jsonb; v_existing students; v_added int := 0; v_updated int := 0; v_skipped int := 0; v_failed int := 0;
  v_code text; v_max_stt int;
begin
  if not has_class_role(p_class, 'treasurer') then
    raise exception 'Bạn không có quyền nhập danh sách lớp này' using errcode = '42501';
  end if;
  if p_dedupe not in ('skip', 'update', 'insert') then
    raise exception 'Chế độ chống trùng không hợp lệ: %', p_dedupe using errcode = '22023';
  end if;
  select coalesce(max(stt), 0) into v_max_stt from students where class_id = p_class and deleted_at is null;

  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    v_code := btrim(coalesce(r->>'code', ''));
    if v_code = '' or btrim(coalesce(r->>'last_name', '') || coalesce(r->>'first_name', '')) = '' then
      v_failed := v_failed + 1;
      continue;
    end if;
    select * into v_existing from students
      where class_id = p_class and code = v_code and deleted_at is null limit 1;

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
      insert into students (class_id, stt, code, last_name, first_name, dob, class_code, note, batch_id, created_by)
      values (p_class, coalesce((r->>'stt')::int, v_max_stt),
              case when v_existing.id is null then v_code else v_code || '-' || left(v_batch::text, 4) end,
              coalesce(r->>'last_name', ''), coalesce(r->>'first_name', ''),
              (r->>'dob')::date, coalesce(r->>'class_code', ''), coalesce(r->>'note', ''),
              v_batch, auth.uid());
      v_added := v_added + 1;
    end if;
  end loop;

  insert into audit_logs (actor_id, actor_email, actor_name, action, table_name, record_id, summary, meta, class_id)
  select auth.uid(), coalesce(p.email, ''), coalesce(nullif(p.full_name, ''), p.email), 'IMPORT', 'students',
         v_batch::text,
         format('%s đã nhập danh sách lớp: thêm %s, cập nhật %s, bỏ qua %s, lỗi %s',
                coalesce(nullif(p.full_name, ''), p.email, 'Người dùng'), v_added, v_updated, v_skipped, v_failed),
         jsonb_build_object('batch_id', v_batch, 'dedupe', p_dedupe,
                            'rows', jsonb_array_length(coalesce(p_rows, '[]'::jsonb))),
         p_class
  from profiles p where p.id = auth.uid();

  return jsonb_build_object('batch_id', v_batch, 'added', v_added, 'updated', v_updated,
                            'skipped', v_skipped, 'failed', v_failed);
end $$;

drop function if exists import_students(jsonb, text);
drop function if exists log_event(text, text, jsonb);

create or replace function undo_import(p_batch uuid)
returns jsonb
language plpgsql set search_path = public as $$
declare v_students int; v_class uuid;
begin
  select class_id into v_class from students where batch_id = p_batch limit 1;
  if v_class is null then
    return jsonb_build_object('students', 0);
  end if;
  if not has_class_role(v_class, 'treasurer') then
    raise exception 'Bạn không có quyền hoàn tác import của lớp này' using errcode = '42501';
  end if;
  update students set deleted_at = now() where batch_id = p_batch and deleted_at is null;
  get diagnostics v_students = row_count;
  return jsonb_build_object('students', v_students);
end $$;

/** Tạo lớp mới và tự đặt người tạo làm quản trị lớp đó. */
create or replace function create_class(p_code text, p_name text default '', p_faculty text default '',
                                        p_term text default '', p_school_year text default '')
returns classes
language plpgsql security definer set search_path = public as $$
declare v_class classes;
begin
  if auth.uid() is null then
    raise exception 'Chưa đăng nhập' using errcode = '42501';
  end if;
  if btrim(coalesce(p_code, '')) = '' then
    raise exception 'Mã lớp không được để trống' using errcode = '22023';
  end if;
  insert into classes (code, name, faculty, term, school_year, created_by)
    values (upper(btrim(p_code)), coalesce(nullif(p_name, ''), upper(btrim(p_code))),
            p_faculty, p_term, p_school_year, auth.uid())
    returning * into v_class;
  insert into memberships (user_id, class_id, role, created_by)
    values (auth.uid(), v_class.id, 'admin', auth.uid());
  return v_class;
end $$;

grant execute on function log_event(text, text, jsonb, uuid),
                          import_students(uuid, jsonb, text),
                          undo_import(uuid),
                          create_class(text, text, text, text, text) to authenticated;

grant select, insert, update on classes, memberships to authenticated;
-- CỐ Ý không cấp quyền đọc bảng classes cho anon: khách đọc view v_classes_public (không có
-- số tài khoản). RLS đã lọc hết dòng cho anon, nhưng không cấp quyền là lớp chặn mạnh hơn.
grant usage, select on all sequences in schema public to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 0005_multiclass_rls.sql
-- ─────────────────────────────────────────────────────────────────────────────────────
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

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 0006_root_governance.sql
-- ─────────────────────────────────────────────────────────────────────────────────────
/**
 * 0006 — Phân quyền theo mô hình "root mở lớp, quản trị lớp tự vận hành"
 * =====================================================================
 * Mô hình quản trị mà hệ thống chốt lại:
 *
 *   • root (profiles.role = 'owner')  — chỉ có ở cấp hệ thống. Tạo lớp và chỉ định
 *     tài khoản quản trị cho từng lớp. Không tham gia việc thu chi hằng ngày.
 *   • quản trị lớp (memberships.role = 'admin') — toàn quyền TRONG những lớp được
 *     giao, không thấy gì ở lớp khác. Một người có thể quản trị nhiều lớp.
 *   • thủ quỹ / thành viên — do chính quản trị lớp thêm vào lớp của mình.
 *   • sinh viên — đăng ký tự do bằng <mã SV>@student.humg.edu.vn, tự vào đúng lớp
 *     có mã sinh viên đó (trigger handle_new_user ở 0004).
 *
 * Trước 0006, bất kỳ ai đăng nhập cũng tạo được lớp mới (và thành quản trị lớp đó).
 * Như vậy một sinh viên tự mở lớp giả rồi tự làm quản trị được — 0006 đóng lại:
 * chỉ root tạo lớp, và chỉ root chỉ định quản trị lớp.
 */

/* ============================== TẠO LỚP: CHỈ ROOT ============================== */
drop policy if exists classes_insert on classes;

-- Không cấp INSERT cho authenticated nữa: lớp chỉ sinh ra qua create_class()
-- (security definer, tự kiểm tra is_system_owner). Hai lớp chặn, không một lớp.
create policy classes_insert_owner on classes for insert to authenticated
  with check (is_system_owner());

/* ============================== ROOT CHỈ ĐỊNH QUẢN TRỊ LỚP ============================== */
/**
 * Giao một lớp cho một tài khoản.
 *
 * - Nếu email đã có tài khoản  → tạo/nâng membership ngay.
 * - Nếu chưa                   → ghi một lời mời; tài khoản nhận đúng vai trò này
 *                                lúc đăng ký (handle_new_user đọc invites).
 *
 * Root giao được vai trò bất kỳ ở lớp bất kỳ. Quản trị lớp cũng gọi được hàm này
 * nhưng chỉ trong lớp mình quản trị, và không được vượt quá vai trò 'admin' —
 * vai trò hệ thống 'owner' không bao giờ cấp qua đây.
 */
drop function if exists grant_class_role(uuid, text, class_role);
create or replace function grant_class_role(p_class uuid, p_email text,
                                            p_role class_role default 'admin',
                                            p_student uuid default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_user uuid; v_class classes; v_before class_role;
begin
  if not has_class_role(p_class, 'admin') then
    raise exception 'Chỉ quản trị lớp hoặc chủ sở hữu hệ thống mới giao được quyền'
      using errcode = '42501';
  end if;
  select * into v_class from classes where id = p_class;
  if v_class.id is null then
    raise exception 'Không tìm thấy lớp' using errcode = '23503';
  end if;
  if position('@' in v_email) < 2 then
    raise exception 'Email không hợp lệ: %', p_email using errcode = '22023';
  end if;

  select id into v_user from profiles where lower(email) = v_email;

  -- Chưa có tài khoản: để dành vai trò trong lời mời (không tạo được auth.users từ SQL).
  -- handle_new_user đọc lời mời này lúc người đó đăng ký. Trigger audit_invites tự ghi log.
  if v_user is null then
    insert into invites (email, role, class_id, student_id, note, invited_by)
      values (v_email, p_role::text::app_role, p_class, p_student,
              format('Được giao làm %s lớp %s', p_role, v_class.code), auth.uid());
    return jsonb_build_object('status', 'invited', 'email', v_email, 'role', p_role);
  end if;

  select role into v_before from memberships where user_id = v_user and class_id = p_class;
  insert into memberships (user_id, class_id, role, student_id, created_by)
    values (v_user, p_class, p_role, p_student, auth.uid())
  on conflict (user_id, class_id) do update
    set role = excluded.role, student_id = coalesce(excluded.student_id, memberships.student_id);

  return jsonb_build_object('status', case when v_before is null then 'granted' else 'changed' end,
                            'email', v_email, 'role', p_role, 'role_before', v_before);
end $$;

/* ============================== CREATE_CLASS THEO MÔ HÌNH MỚI ============================== */
-- Bỏ bản 5 tham số để không có hai hàm cùng tên gọi nhập nhằng khi thêm tham số mặc định
drop function if exists create_class(text, text, text, text, text);

/**
 * Root mở lớp mới và giao ngay cho một tài khoản quản trị.
 *
 * p_admin_email để trống ⇒ lớp chưa có quản trị; root vẫn thấy và giao sau được
 * (root thấy mọi lớp nhờ is_system_owner, không cần dòng membership nào).
 */
create or replace function create_class(p_code text, p_name text default '', p_faculty text default '',
                                        p_term text default '', p_school_year text default '',
                                        p_admin_email text default '')
returns classes
language plpgsql security definer set search_path = public as $$
declare v_class classes; v_admin text := lower(btrim(coalesce(p_admin_email, '')));
begin
  if not is_system_owner() then
    raise exception 'Chỉ chủ sở hữu hệ thống mới tạo được lớp' using errcode = '42501';
  end if;
  if btrim(coalesce(p_code, '')) = '' then
    raise exception 'Mã lớp không được để trống' using errcode = '22023';
  end if;
  if exists (select 1 from classes where upper(code) = upper(btrim(p_code))) then
    raise exception 'Lớp % đã tồn tại', upper(btrim(p_code)) using errcode = '23505';
  end if;

  insert into classes (code, name, faculty, term, school_year, created_by)
    values (upper(btrim(p_code)), coalesce(nullif(btrim(p_name), ''), upper(btrim(p_code))),
            coalesce(p_faculty, ''), coalesce(p_term, ''), coalesce(p_school_year, ''), auth.uid())
    returning * into v_class;

  if v_admin <> '' then
    perform grant_class_role(v_class.id, v_admin, 'admin', null);
  end if;
  return v_class;
end $$;

/* ============================== HẠ QUYỀN / RÚT NGƯỜI KHỎI LỚP ============================== */
/** Rút một người khỏi lớp. Không xoá tài khoản, chỉ bỏ membership của lớp đó. */
create or replace function revoke_class_role(p_class uuid, p_user uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v_email text; v_code text; v_actor text;
begin
  if not has_class_role(p_class, 'admin') then
    raise exception 'Bạn không quản trị lớp này' using errcode = '42501';
  end if;
  if p_user = auth.uid() and not is_system_owner() then
    raise exception 'Không thể tự rút mình khỏi lớp đang quản trị' using errcode = '42501';
  end if;
  select email into v_email from profiles where id = p_user;
  select code  into v_code  from classes  where id = p_class;
  select coalesce(nullif(full_name, ''), email) into v_actor from profiles where id = auth.uid();

  delete from memberships where user_id = p_user and class_id = p_class;

  insert into audit_logs (actor_id, actor_email, actor_name, action, table_name, record_id,
                          summary, meta, class_id)
  select auth.uid(), p.email, coalesce(nullif(p.full_name, ''), p.email), 'DELETE', 'memberships',
         p_user::text, format('%s đã rút %s khỏi lớp %s', coalesce(v_actor, 'Người dùng'),
                              coalesce(v_email, p_user::text), coalesce(v_code, '?')),
         jsonb_build_object('user_id', p_user), p_class
    from profiles p where p.id = auth.uid();
end $$;

grant execute on function grant_class_role(uuid, text, class_role, uuid),
                          revoke_class_role(uuid, uuid),
                          create_class(text, text, text, text, text, text) to authenticated;

/* ============================== KHÔNG TỰ NÂNG QUYỀN TRONG LỚP ============================== */
/**
 * Chặn tự nâng quyền: chính sách RLS memberships_update_admin cho phép quản trị lớp
 * sửa mọi dòng trong lớp mình — kể cả dòng của chính mình, nên một thủ quỹ *không*
 * sửa được gì (không phải admin), nhưng cần chặn thêm hai việc ở tầng dữ liệu:
 *   1. Đổi class_id của một membership để "mang" quyền sang lớp khác.
 *   2. Gắn student_id thuộc lớp khác vào membership.
 */
create or replace function guard_membership_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_student_class uuid;
begin
  -- Sinh viên được gắn phải thuộc ĐÚNG lớp của membership, kể cả khi do trigger đăng ký
  -- tạo ra: nếu không, "công nợ của tôi" sẽ đọc số của lớp khác.
  if new.student_id is not null then
    select class_id into v_student_class from students where id = new.student_id;
    if v_student_class is distinct from new.class_id then
      raise exception 'Sinh viên được gắn không thuộc lớp này' using errcode = '42501';
    end if;
  end if;

  if auth.uid() is null then return new; end if;

  -- Không "mang" một membership sang lớp khác để lấn quyền: rút rồi thêm lại
  if tg_op = 'UPDATE' and new.class_id is distinct from old.class_id then
    raise exception 'Không được chuyển thành viên sang lớp khác; hãy rút rồi thêm lại'
      using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and new.user_id = auth.uid() and new.role is distinct from old.role then
    raise exception 'Không thể tự đổi vai trò của chính mình trong lớp' using errcode = '42501';
  end if;
  -- Lớp đã có quản trị thì không được hạ hết: lớp mới do root mở có thể chưa có ai
  if tg_op = 'UPDATE' and old.role = 'admin' and new.role <> 'admin'
     and (select count(*) from memberships
          where class_id = old.class_id and role = 'admin' and id <> old.id) = 0 then
    raise exception 'Lớp phải luôn còn ít nhất một quản trị' using errcode = '23514';
  end if;
  return new;
end $$;

-- Một trigger duy nhất cho cả INSERT và UPDATE (thay trigger chỉ-UPDATE ở 0004)
drop trigger if exists guard_memberships_change on memberships;
drop trigger if exists guard_membership_change_trg on memberships;
create trigger guard_memberships_change before insert or update on memberships
  for each row execute function guard_membership_change();

/* ============================== LỜI MỜI: ĐÚNG LỚP CỦA MÌNH ============================== */
-- Quản trị lớp chỉ mời được vào lớp mình; root mời vào lớp nào cũng được (is_system_owner
-- nằm trong has_class_role). Vai trò 'owner' không bao giờ mời qua bảng invites.
drop policy if exists invites_select on invites;
drop policy if exists invites_insert on invites;
drop policy if exists invites_update on invites;
create policy invites_select on invites for select to authenticated
  using (has_class_role(class_id, 'admin'));
create policy invites_insert on invites for insert to authenticated
  with check (has_class_role(class_id, 'admin') and role <> 'owner');
create policy invites_update on invites for update to authenticated
  using (has_class_role(class_id, 'admin')) with check (has_class_role(class_id, 'admin') and role <> 'owner');

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 0007_class_officers.sql
-- ─────────────────────────────────────────────────────────────────────────────────────
/**
 * 0007 — Đánh dấu ban quản lý lớp ngay trong danh sách lớp
 * =======================================================
 * Ai cũng nên biết trong lớp mình ai là quản trị lớp và ai là thủ quỹ: đó là người sinh
 * viên phải liên hệ khi nộp tiền hay khi số liệu sai. Nhưng bảng `memberships` thì chỉ
 * quản trị lớp đọc được (RLS), nên nếu đọc thẳng bảng đó thì thành viên và khách sẽ không
 * thấy gì. View này công bố ĐÚNG một thông tin: người này giữ vai gì trong lớp.
 *
 * Cố ý KHÔNG có email và không có vai 'member' — chỉ những người có trách nhiệm với quỹ.
 * Khách vẫn bị che tên khi lớp bật công tắc che tên, giống v_students_public.
 */
create view v_class_officers with (security_invoker = false) as
select
  m.class_id,
  m.student_id,
  m.role,
  -- Tên hiển thị: ưu tiên tên trong danh sách lớp, sau đó tên tài khoản, cuối cùng là
  -- phần trước @ của email (không công bố email đầy đủ).
  case
    when c.hide_student_names_from_guest and auth.uid() is null
      then mask_name(coalesce(nullif(s.full_name, ''), nullif(p.full_name, ''), split_part(p.email, '@', 1)))
    else coalesce(nullif(s.full_name, ''), nullif(p.full_name, ''), split_part(p.email, '@', 1))
  end as person_name,
  -- Quản trị lớp có thể là người ngoài danh sách (giáo viên, lớp trưởng đã chuyển lớp…)
  (m.student_id is not null) as in_student_list
from memberships m
join classes c  on c.id = m.class_id
join profiles p on p.id = m.user_id and p.is_active
left join students s on s.id = m.student_id and s.deleted_at is null
where m.role in ('admin', 'treasurer') and c.is_active;

comment on view v_class_officers is
  'Ban quản lý của từng lớp (quản trị lớp, thủ quỹ) để đánh dấu trong danh sách lớp. '
  'Không có email, không có vai thành viên. Khách bị che tên nếu lớp bật che tên.';

grant select on v_class_officers to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 0008_no_email_confirm.sql
-- ─────────────────────────────────────────────────────────────────────────────────────
/**
 * 0008 — Không bao giờ phải xác nhận email
 * =======================================
 * Quy định của hệ thống: tài khoản đúng định dạng là dùng được ngay, không có bước mở hộp
 * thư. Trước 0008, điều đó phụ thuộc một công tắc trên Dashboard ("Authentication → Email →
 * Confirm email"): ai bật lại là cả lớp bị chặn đăng nhập, mà lỗi GoTrue trả về lại không
 * nói rõ vì sao. Nên chuyển quy định vào chính cơ sở dữ liệu.
 *
 * GoTrue chỉ cho đăng nhập khi auth.users.email_confirmed_at có giá trị. Trigger dưới đây
 * điền sẵn giá trị đó ngay lúc tạo tài khoản, nên bật hay tắt công tắc kia cũng không còn
 * ảnh hưởng gì. Email xác nhận (nếu công tắc đang bật) vẫn được gửi, nhưng không ai cần mở.
 *
 * Ai KHÔNG được đăng ký thì đã bị handle_new_user() chặn từ trước (0004): email phải đúng
 * dạng <mã sinh viên>@<tên miền trường>, hoặc đã được quản trị lớp thêm sẵn. Việc bỏ xác
 * nhận email vì thế không mở thêm cửa cho ai.
 */
create or replace function auth_autoconfirm_email() returns trigger
language plpgsql security definer set search_path = auth, public as $$
begin
  new.email_confirmed_at := coalesce(new.email_confirmed_at, now());
  return new;
end $$;

drop trigger if exists autoconfirm_email_before_insert on auth.users;
create trigger autoconfirm_email_before_insert before insert on auth.users
  for each row execute function auth_autoconfirm_email();

-- Tài khoản tạo trước 0008 mà còn treo ở trạng thái chờ xác nhận thì mở luôn ở đây,
-- để không phải chạy thêm câu lệnh tay nào nữa.
update auth.users set email_confirmed_at = coalesce(email_confirmed_at, now())
where email_confirmed_at is null;

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 0009_guest_qr.sql
-- ─────────────────────────────────────────────────────────────────────────────────────
/**
 * 0009 — Khách cũng quét được QR và chuyển khoản
 * =============================================
 * Người phải nộp tiền thường KHÔNG đăng nhập: họ mở link lớp, tìm dòng của mình, quét mã,
 * chuyển khoản. Trước 0009, view công khai chỉ nói "lớp này đã cấu hình QR hay chưa" nên
 * khách không sinh được mã — mã QR VietQR bắt buộc phải có mã ngân hàng và số tài khoản.
 *
 * Vì thế view công khai giờ công bố luôn tài khoản NHẬN tiền của lớp. Đây là chủ ý, không
 * phải rò rỉ: số tài khoản nhận tiền là thứ thủ quỹ vẫn dán vào nhóm chat lớp, biết nó chỉ
 * giúp chuyển tiền VÀO quỹ. Những thứ thật sự riêng tư vẫn nằm ngoài view: ngày sinh, email,
 * lịch sử thao tác, danh sách thành viên và mọi bảng gốc.
 *
 * Mã QR vẫn được vẽ ngay trên máy người dùng, không đi qua dịch vụ sinh QR nào.
 */
create or replace view v_classes_public with (security_invoker = false) as
select c.id as class_id, c.code, c.name, c.faculty, c.term, c.school_year,
       c.hide_student_names_from_guest,
       (btrim(c.bank_bin) <> '' and btrim(c.account_no) <> '') as bank_configured,
       (select count(*) from students s where s.class_id = c.id and s.deleted_at is null and s.is_active) as student_count,
       -- Tài khoản nhận tiền: đủ để khách tự sinh mã QR chuyển khoản
       c.bank_bin, c.bank_name, c.account_no, c.account_name, c.note_template
from classes c where c.is_active;

comment on view v_classes_public is
  'Thông tin lớp cho khách chưa đăng nhập, gồm tài khoản NHẬN tiền để khách tự sinh QR. '
  'Không có ngày sinh, email, thành viên hay lịch sử thao tác.';

grant select on v_classes_public to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 0010_audit_admin_only.sql
-- ─────────────────────────────────────────────────────────────────────────────────────
/**
 * 0010 — Lịch sử thao tác chỉ dành cho tài khoản gốc và quản trị lớp
 * =================================================================
 * Trước đây thủ quỹ xem được phần log tài chính của lớp mình, và ai cũng xem được log do
 * chính mình gây ra. Hai ngoại lệ đó bị bỏ: lịch sử thao tác là công cụ giám sát, người bị
 * giám sát không nên đọc được nó — thủ quỹ thấy log là thấy luôn mình bị soi ở đâu, còn
 * `actor_id = auth.uid()` thì mở cho MỌI tài khoản một ô cửa vào bảng này.
 *
 * Ghi thì không đổi: mọi vai trò vẫn để lại vết (trigger và log_event ghi bằng quyền
 * definer), chỉ có việc ĐỌC là siết lại.
 */
drop policy if exists audit_select on audit_logs;

create policy audit_select on audit_logs for select to authenticated
  using (
    is_system_owner()
    or (class_id is not null and has_class_role(class_id, 'admin'))
  );

comment on table audit_logs is
  'Lịch sử thao tác, bất biến. Chỉ chủ sở hữu hệ thống và quản trị của đúng lớp đó đọc được.';

