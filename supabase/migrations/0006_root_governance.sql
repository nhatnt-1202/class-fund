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
