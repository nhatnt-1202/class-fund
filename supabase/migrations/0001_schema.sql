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
