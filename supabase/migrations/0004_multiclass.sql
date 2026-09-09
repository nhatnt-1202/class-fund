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
