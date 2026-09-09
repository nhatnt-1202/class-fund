-- Xoá hẳn một tài khoản đăng nhập (profile tự xoá theo vì có on delete cascade).
--   npm run db:exec -- ../supabase/tools/delete_user.sql -v email=ai@do.com
-- Dùng khi cần trả lại chỗ "người đăng ký đầu tiên" hoặc dọn tài khoản tạo thử.
-- LƯU Ý: nếu tài khoản đó đã tạo bản ghi thu/chi thì các bản ghi vẫn còn (created_by về null).
\set ON_ERROR_STOP on

delete from auth.users where lower(email) = lower(:'email');

select coalesce(count(*), 0) as con_lai_bao_nhieu_tai_khoan from profiles;
