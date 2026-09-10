/**
 * 0012_visits — Đếm lượt truy cập web, kể cả khách chưa đăng nhập
 * =====================================================================================
 * Vì sao không dùng audit_logs: bảng đó chỉ ghi được khi đã đăng nhập (log_event ném lỗi
 * nếu auth.uid() is null), mà phần lớn người mở app lại là KHÁCH — đúng nhóm cần đếm.
 *
 * Mô hình: một PHIÊN = một lần mở app. Trình duyệt tự sinh session_key (sessionStorage,
 * mất khi đóng tab) và device_key (localStorage, còn mãi ⇒ nhận ra người quay lại).
 * Frontend gọi track_visit() khi đổi trang ('view') và mỗi 60 giây khi tab đang hiển thị
 * ('ping'). Thời gian ở lại = last_seen_at − started_at, nên chỉ đúng khi có nhịp tim;
 * ngồi yên quá 30 phút thì lần gọi sau mở PHIÊN MỚI thay vì kéo dài phiên cũ — không có
 * cái gọi là "phiên 9 tiếng" chỉ vì ai đó quên đóng tab.
 *
 * DỮ LIỆU CÁ NHÂN: bảng này lưu IP gốc, user agent và referrer của cả khách. Đó là lựa
 * chọn có chủ ý của chủ hệ thống. Hai thứ bù lại: chỉ quản trị đọc được (RLS bên dưới),
 * và có purge_visits() để xoá dữ liệu cũ. Nên chạy purge định kỳ, đừng giữ IP mãi mãi.
 */

/* ============================== BẢNG ============================== */
create table visit_sessions (
  id           uuid primary key default gen_random_uuid(),
  -- Khoá do trình duyệt sinh; KHÔNG unique vì một tab để mở nhiều ngày sẽ tạo nhiều phiên.
  session_key  text not null check (length(session_key) between 8 and 64),
  device_key   text check (device_key is null or length(device_key) between 8 and 64),
  user_id      uuid references profiles (id) on delete set null,   -- null = khách
  class_id     uuid references classes (id) on delete set null,    -- lớp đang xem lúc đó
  role         text not null default 'guest',
  started_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  views        int not null default 0,
  entry_path   text not null default '',
  last_path    text not null default '',
  referrer     text not null default '',
  user_agent   text not null default '',
  ip           inet
);
create index visit_sessions_key_idx   on visit_sessions (session_key, last_seen_at desc);
create index visit_sessions_seen_idx  on visit_sessions (last_seen_at desc);
create index visit_sessions_class_idx on visit_sessions (class_id, started_at desc);
create index visit_sessions_ip_idx    on visit_sessions (ip, started_at desc);

-- Từng lượt xem trang. Nhịp tim KHÔNG ghi vào đây, chỉ đổi trang mới ghi ⇒ bảng không phình.
create table visit_events (
  id         bigserial primary key,
  session_id uuid not null references visit_sessions (id) on delete cascade,
  at         timestamptz not null default now(),
  class_id   uuid references classes (id) on delete set null,
  path       text not null default ''
);
create index visit_events_at_idx      on visit_events (at desc);
create index visit_events_session_idx on visit_events (session_id, at);
create index visit_events_class_idx   on visit_events (class_id, at desc);

comment on table visit_sessions is
  'Một dòng = một lần mở app (kể cả khách chưa đăng nhập). Chứa IP và user agent — chỉ quản trị đọc được.';

/* ============================== GHI NHẬN ==============================
   security definer: khách (role anon) không có quyền ghi thẳng vào bảng, mọi lượt truy cập
   phải đi qua hàm này để không ai chèn được dòng giả bằng PostgREST.
   ====================================================================== */
create or replace function track_visit(
  p_session  text,
  p_device   text default null,
  p_class    uuid default null,
  p_path     text default '',
  p_referrer text default '',
  p_event    text default 'view'
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_headers json;
  v_ip      inet;
  v_ua      text := '';
  v_role    text;
  v_row     visit_sessions;
  v_recent  int;
begin
  -- Đầu vào đến từ trình duyệt của người lạ: sai thì im lặng bỏ qua, không ném lỗi làm
  -- hỏng trải nghiệm của người đang xem quỹ lớp.
  if p_event not in ('view', 'ping') then return; end if;
  if p_session is null or length(p_session) not between 8 and 64 then return; end if;

  begin
    v_headers := current_setting('request.headers', true)::json;
  exception when others then v_headers := null;
  end;
  if v_headers is not null then
    v_ua := left(coalesce(v_headers ->> 'user-agent', ''), 400);
    -- Sau Cloudflare/Supabase, IP thật nằm ở header chuyển tiếp; inet_client_addr() chỉ ra proxy.
    begin
      v_ip := nullif(btrim(split_part(
        coalesce(nullif(v_headers ->> 'cf-connecting-ip', ''),
                 nullif(v_headers ->> 'x-real-ip', ''),
                 coalesce(v_headers ->> 'x-forwarded-for', '')), ',', 1)), '')::inet;
    exception when others then v_ip := null;
    end;
  end if;

  v_role := case
    when auth.uid() is null then 'guest'
    when is_system_owner() then 'owner'
    else coalesce(my_class_role(p_class)::text, 'member')
  end;

  -- Phiên còn sống là phiên vừa có dấu hiệu trong 30 phút; cũ hơn thì tính là lần vào mới.
  select * into v_row from visit_sessions
   where session_key = p_session and last_seen_at > now() - interval '30 minutes'
   order by last_seen_at desc limit 1;

  if v_row.id is null then
    -- Chặn bơm số liệu: một IP mở tối đa 60 phiên mới trong 1 giờ.
    if v_ip is not null then
      select count(*) into v_recent from visit_sessions
       where ip = v_ip and started_at > now() - interval '1 hour';
      if v_recent >= 60 then return; end if;
    end if;
    insert into visit_sessions (session_key, device_key, user_id, class_id, role, views,
                                entry_path, last_path, referrer, user_agent, ip)
    values (p_session, nullif(left(coalesce(p_device, ''), 64), ''), auth.uid(), p_class, v_role,
            case when p_event = 'view' then 1 else 0 end,
            left(coalesce(p_path, ''), 300), left(coalesce(p_path, ''), 300),
            left(coalesce(p_referrer, ''), 300), v_ua, v_ip)
    returning * into v_row;
  else
    -- Nhịp tim dày hơn 20 giây là bất thường (script, không phải người) ⇒ bỏ.
    if p_event = 'ping' and v_row.last_seen_at > now() - interval '20 seconds' then return; end if;
    update visit_sessions set
      last_seen_at = now(),
      views        = views + case when p_event = 'view' then 1 else 0 end,
      last_path    = case when p_event = 'view' then left(coalesce(p_path, ''), 300) else last_path end,
      class_id     = coalesce(p_class, class_id),
      user_id      = coalesce(auth.uid(), user_id),
      role         = case when v_role <> 'guest' then v_role else role end
    where id = v_row.id
    returning * into v_row;
  end if;

  -- Trần 1000 lượt xem/phiên: người thật không bấm tới đó, nên đây là chốt chặn cuối.
  if p_event = 'view' and v_row.views <= 1000 then
    insert into visit_events (session_id, class_id, path)
    values (v_row.id, p_class, left(coalesce(p_path, ''), 300));
  end if;
end $$;

/**
 * Xoá dữ liệu truy cập cũ hơn p_days ngày. Chỉ tài khoản gốc — đây là dữ liệu cá nhân,
 * giữ lâu không có lợi ích gì mà rủi ro thì có.
 */
create or replace function purge_visits(p_days int default 90)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_sessions int;
begin
  if not is_system_owner() then
    raise exception 'Chỉ tài khoản gốc mới xoá được dữ liệu truy cập' using errcode = '42501';
  end if;
  if p_days < 1 then
    raise exception 'Số ngày phải >= 1' using errcode = '22023';
  end if;
  delete from visit_sessions where last_seen_at < now() - make_interval(days => p_days);
  get diagnostics v_sessions = row_count;   -- visit_events xoá theo nhờ on delete cascade
  return jsonb_build_object('sessions', v_sessions, 'days', p_days);
end $$;

/* ============================== AI ĐƯỢC XEM ==============================
   Ghi thì ai cũng ghi (qua hàm definer ở trên), ĐỌC thì chỉ quản trị: tài khoản gốc xem
   toàn hệ thống, quản trị lớp chỉ xem lượt truy cập vào lớp mình. Không có policy
   update/delete cho bất kỳ ai — số liệu truy cập cũng bất biến như audit log.
   ======================================================================== */
alter table visit_sessions enable row level security;
alter table visit_events   enable row level security;

create policy visit_sessions_select_admin on visit_sessions for select to authenticated
  using (is_system_owner() or (class_id is not null and has_class_role(class_id, 'admin')));
create policy visit_events_select_admin on visit_events for select to authenticated
  using (is_system_owner() or (class_id is not null and has_class_role(class_id, 'admin')));

/* ============================== VIEW THỐNG KÊ ==============================
   security_invoker = true: view chạy bằng quyền NGƯỜI GỌI nên RLS ở trên vẫn có hiệu lực,
   quản trị lớp không thể qua view mà đếm lượt truy cập của lớp khác.

   Ngày cắt theo giờ Việt Nam, không theo UTC: "hôm nay" của thủ quỹ phải là hôm nay thật,
   chứ không phải một ngày lệch 7 tiếng.
   ========================================================================= */
create view v_visit_daily with (security_invoker = true) as
select (s.started_at at time zone 'Asia/Ho_Chi_Minh')::date         as day,
       s.class_id,
       count(*)                                                     as sessions,
       count(*) filter (where s.user_id is null)                    as guest_sessions,
       count(distinct coalesce(s.device_key, s.session_key))        as visitors,
       count(distinct s.ip) filter (where s.ip is not null)         as ips,
       coalesce(sum(s.views), 0)                                    as pageviews,
       coalesce(sum(greatest(extract(epoch from s.last_seen_at - s.started_at), 0)), 0)::bigint as total_seconds
from visit_sessions s
group by 1, 2;

create view v_visit_paths with (security_invoker = true) as
select (e.at at time zone 'Asia/Ho_Chi_Minh')::date as day,
       e.class_id,
       e.path,
       count(*) as views
from visit_events e
group by 1, 2, 3;

/**
 * Các con số tổng của khoảng đang xem. Phải là hàm chứ không cộng ở frontend vì "bao nhiêu
 * MÁY khác nhau" là count(distinct) — cộng dồn số của từng ngày sẽ đếm trùng người vào
 * nhiều ngày, và frontend chỉ tải 300 phiên gần nhất nên cũng không cộng đủ.
 *
 * KHÔNG phải security definer: hàm chạy bằng quyền người gọi nên RLS ở trên vẫn lọc, quản
 * trị lớp chỉ tổng kết được lớp mình.
 */
create or replace function visit_summary(p_days int default 30, p_class uuid default null)
returns jsonb
language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'sessions',       count(*),
    'visitors',       count(distinct coalesce(device_key, session_key)),
    'guest_sessions', count(*) filter (where user_id is null),
    'guest_visitors', count(distinct coalesce(device_key, session_key)) filter (where user_id is null),
    'accounts',       count(distinct user_id) filter (where user_id is not null),
    'pageviews',      coalesce(sum(views), 0),
    'seconds',        coalesce(sum(greatest(extract(epoch from last_seen_at - started_at), 0)), 0)::bigint,
    'online',         count(*) filter (where last_seen_at > now() - interval '5 minutes')
  )
  from visit_sessions
  where started_at >= now() - make_interval(days => greatest(p_days, 1))
    and (p_class is null or class_id = p_class)
$$;

comment on view v_visit_daily is 'Lượt truy cập theo NGÀY (giờ Việt Nam) và theo lớp. Chỉ quản trị đọc được.';

/* ============================== GRANT ============================== */
grant select on visit_sessions, visit_events, v_visit_daily, v_visit_paths to authenticated;
-- Khách chưa đăng nhập chỉ được GỌI HÀM ghi nhận, không đọc và không ghi thẳng vào bảng.
grant execute on function track_visit(text, text, uuid, text, text, text) to anon, authenticated;
grant execute on function purge_visits(int) to authenticated;
grant execute on function visit_summary(int, uuid) to authenticated;
