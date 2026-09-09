-- =====================================================================================
-- XOÁ SẠCH DỮ LIỆU, GIỮ LẠI TÀI KHOẢN GỐC
-- =====================================================================================
-- Xoá vĩnh viễn: mọi lớp, sinh viên, đợt thu, khoản thu, khoản chi, thành viên lớp,
-- lời mời, lịch sử thao tác, và MỌI TÀI KHOẢN trừ (các) tài khoản chủ sở hữu hệ thống.
-- Giữ lại: tài khoản gốc (profiles.role = 'owner') và app_config.
--
-- KHÔNG HOÀN LẠI ĐƯỢC. Muốn giữ số liệu thì vào Nhập / Xuất → xuất Excel trước.
--
-- Cách dùng: Supabase Dashboard → SQL Editor → New query → dán cả file → Run.
-- Cả file chạy trong MỘT transaction: sai một chỗ là không xoá gì cả.
-- =====================================================================================
begin;

-- Chốt an toàn: không có tài khoản chủ sở hữu thì dừng, để không xoá sạch mọi tài khoản.
do $$
begin
  if (select count(*) from profiles where role = 'owner' and is_active) = 0 then
    raise exception 'Không tìm thấy tài khoản chủ sở hữu đang hoạt động — dừng lại, không xoá gì';
  end if;
end $$;

-- profiles.student_id là cột từ thời một lớp và trỏ vào students, phải tháo trước khi xoá
-- sinh viên. (Đây cũng là lý do KHÔNG dùng truncate ... cascade: nó sẽ cuốn cả bảng profiles
-- và xoá luôn tài khoản gốc.)
update profiles set student_id = null where student_id is not null;

-- Xoá theo đúng thứ tự khoá ngoại: con trước, cha sau
delete from incomes;
delete from expenses;
delete from periods;
delete from invites;
delete from memberships;
delete from students;
delete from classes;
delete from audit_logs;          -- xoá sau cùng để không giữ lại vết của chính việc dọn này

-- Xoá mọi tài khoản không phải chủ sở hữu. profiles tự mất theo (on delete cascade),
-- phiên đăng nhập của họ cũng hết hiệu lực.
delete from auth.users u
where not exists (select 1 from profiles p where p.id = u.id and p.role = 'owner');

commit;

-- Kiểm tra: mọi con số phải bằng 0, và còn đúng (các) tài khoản gốc
select
  (select count(*) from classes)     as lop,
  (select count(*) from students)    as sinh_vien,
  (select count(*) from periods)     as dot_thu,
  (select count(*) from incomes)     as khoan_thu,
  (select count(*) from expenses)    as khoan_chi,
  (select count(*) from memberships) as thanh_vien,
  (select count(*) from invites)     as loi_moi,
  (select count(*) from audit_logs)  as lich_su,
  (select count(*) from auth.users)  as tai_khoan_con_lai;

select email, role, is_active from profiles order by email;
