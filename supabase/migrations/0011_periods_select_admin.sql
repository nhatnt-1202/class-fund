/**
 * 0011 — Sửa lỗi "không có quyền" khi xoá đợt thu
 * =================================================================
 * `periods_select_public` chỉ cho đọc đợt thu CHƯA xoá (`deleted_at is null`) — đúng cho
 * khách/thành viên thường. Nhưng thao tác xoá mềm ở frontend là một lệnh
 * `.update({ deleted_at: now() }).select()`: PostgREST dùng CHÍNH policy SELECT đó để trả về
 * bản ghi vừa sửa, mà bản ghi vừa xoá thì `deleted_at` không còn null nữa — nên `.select()`
 * luôn trả về mảng rỗng dù UPDATE đã thành công, và `assertChanged()` ở frontend hiểu nhầm
 * thành "không có quyền, hoặc bản ghi đã bị người khác thay đổi".
 *
 * Thêm policy riêng cho quản trị lớp: đọc được đợt thu của lớp mình kể cả đã xoá. Nhờ đó
 * `.select()` sau khi xoá trả lại đúng bản ghi, và sau này có làm màn phục hồi thì admin cũng
 * nhìn thấy đợt đã xoá.
 */
create policy periods_select_admin on periods for select to authenticated
  using (has_class_role(class_id, 'admin'));
