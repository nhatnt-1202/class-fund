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
