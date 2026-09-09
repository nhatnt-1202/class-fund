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
