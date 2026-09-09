-- Mời một email vào hệ thống với vai trò chỉ định.
--   npm run db:exec -- ../supabase/tools/invite.sql -v email=ai@do.com -v role=owner
-- role nhận: member | treasurer | admin | owner
\set ON_ERROR_STOP on

insert into invites (email, role, note)
values (:'email', :'role'::app_role, 'Tạo bằng supabase/tools/invite.sql')
on conflict do nothing;

select email, role, created_at, accepted_at, revoked_at
from invites where lower(email) = lower(:'email');
