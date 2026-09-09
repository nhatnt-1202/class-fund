-- =====================================================================================
-- Shim mô phỏng phần Supabase mà migration phụ thuộc, để chạy được trên Postgres trắng.
-- KHÔNG phải là migration — chỉ dùng khi kiểm thử (Supabase thật đã có sẵn những thứ này).
-- =====================================================================================
create extension if not exists pgcrypto;
create schema if not exists auth;

create table if not exists auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text unique not null,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  -- GoTrue chỉ cho đăng nhập khi cột này có giá trị; 0008 tự điền để không phải xác nhận email
  email_confirmed_at timestamptz,
  created_at         timestamptz not null default now()
);

-- Bản sao hành vi auth.uid() của Supabase: đọc "sub" trong JWT claims của request.
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(coalesce(
    current_setting('request.jwt.claim.sub', true),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  ), '')::uuid
$$;

do $$ begin create role anon         nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role  nologin bypassrls; exception when duplicate_object then null; end $$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant select, insert on auth.users to service_role;
