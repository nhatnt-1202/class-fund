-- Xác nhận email thủ công cho một tài khoản (dùng khi bật "Confirm email" mà không muốn
-- chờ thư). Tương đương bấm Confirm ở Dashboard → Authentication → Users.
--   npm run db:exec -- ../supabase/tools/confirm_email.sql -v email=ai@do.com
\set ON_ERROR_STOP on

update auth.users set email_confirmed_at = coalesce(email_confirmed_at, now())
where lower(email) = lower(:'email');

select email, email_confirmed_at from auth.users where lower(email) = lower(:'email');
