-- Xác nhận email cho MỌI tài khoản đang chờ xác nhận.
--
-- Dùng khi bạn đã tắt "Confirm email" ở Dashboard → Authentication → Sign In / Providers →
-- Email, nhưng vài tài khoản tạo lúc còn bật nên vẫn bị chặn đăng nhập. Tắt công tắc kia
-- chỉ có hiệu lực với tài khoản tạo SAU đó, nên số cũ phải xác nhận bằng câu lệnh này.
--
-- Dán vào Supabase SQL Editor rồi Run.
update auth.users
set email_confirmed_at = coalesce(email_confirmed_at, now())
where email_confirmed_at is null;

-- Kiểm tra: cột chờ_xác_nhận phải bằng 0
select count(*) filter (where email_confirmed_at is null) as "chờ_xác_nhận",
       count(*) as "tổng_tài_khoản"
from auth.users;
