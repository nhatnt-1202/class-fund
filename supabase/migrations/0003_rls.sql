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
