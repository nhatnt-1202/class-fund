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
