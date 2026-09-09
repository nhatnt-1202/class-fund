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
