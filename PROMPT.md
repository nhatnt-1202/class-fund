# PROMPT: "Quỹ Lớp" — Web quản lý thu chi quỹ lớp học
### Supabase + Vite/React/TypeScript · có account, phân quyền, audit log

Bạn là **senior full-stack + product designer**. Hãy xây dựng một web app quản lý tài chính lớp học hoàn chỉnh, đẹp, mượt, dễ dùng cho sinh viên, với dữ liệu được lưu bền vững trên database thật và có hệ thống tài khoản – phân quyền – audit log.

Toàn bộ UI, nhãn, thông báo lỗi: **tiếng Việt**. Tiền: **VND**, hiển thị `1.250.000 ₫`. Ngày: hiển thị `dd/MM/yyyy`, lưu `date` (không timezone) trong DB.

---

## 0. Stack đã chốt — không đổi

| Lớp | Công nghệ |
|---|---|
| Frontend | **Vite + React 18 + TypeScript** (strict mode) |
| Styling | **Tailwind CSS** + CSS variables cho design token |
| UI primitives | **shadcn/ui** (Radix) — Dialog, Popover, Select, Command, Tabs, Toast, Tooltip, DropdownMenu, Table |
| Animation | **Framer Motion** (`motion/react`) |
| Data layer | **@tanstack/react-query** + `@supabase/supabase-js` |
| Form | **react-hook-form + zod** (mọi form đều validate bằng zod schema dùng chung với type) |
| Backend | **Supabase**: Postgres + Auth + Row Level Security + Storage |
| Excel | **SheetJS (xlsx)** cho import/export |
| QR | **qrcode.react** (hoặc `qrcode-generator`) — vẽ QR tại client, không gọi API ngoài |
| Ngày tháng | **date-fns** + locale `vi` |
| Icon | **lucide-react** |
| Deploy | Frontend tĩnh lên Netlify/Vercel; DB trên Supabase Cloud |

Cấu trúc project:

```
/supabase/migrations/*.sql      -- schema + RLS + trigger + seed (chạy được bằng supabase db push)
/src
  /app          App.tsx, router, providers (QueryClient, Auth, Theme, Motion)
  /features
    /auth       login, signup-by-invite, forgot-password, AuthGuard, RoleGuard
    /dashboard  báo cáo tự động
    /students   danh sách lớp + công nợ
    /incomes    thu
    /expenses   chi
    /periods    đợt thu
    /users      quản lý account + phân quyền
    /audit      audit log viewer
    /io         import Excel / export Excel
  /components   ui/ (shadcn), MoneyText, FundBadge, DataTable, EmptyState, StatCard, PageTransition
  /lib          supabase.ts, permissions.ts, money.ts, excel.ts, dates.ts, motion.ts
  /types        database.types.ts (sinh bằng supabase gen types)
.env.example    VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
```

**Không bao giờ** đặt `service_role key` trong frontend. Mọi phân quyền phải được thực thi ở **RLS trong Postgres**, không chỉ ẩn nút ở UI.

---

## 1. Nguyên tắc nghiệp vụ bất di bất dịch

1. **Hai quỹ tách biệt tuyệt đối**: `QUY_LOP` (Quỹ Lớp) và `QUY_DOAN` (Quỹ Đoàn). Mọi bản ghi thu/chi **bắt buộc** gắn đúng 1 quỹ. Không có tổng nào trộn 2 quỹ, trừ dòng được ghi nhãn rõ "Tổng cộng cả 2 quỹ".
2. **Tiền là số nguyên VND** — cột `bigint`, không float, không chia 1000. Chặn số âm ở mức DB (`check (amount > 0)`).
3. **Tồn quỹ luôn được tính từ bản ghi**, không có ô "nhập tồn quỹ tay":
   `Tồn quỹ(X) = Σ Thu(X) − Σ Chi(X)`
   Tính bằng **Postgres view** để mọi client đọc ra cùng một con số.
4. **Không xoá cứng bất cứ thứ gì** (xem §12): mọi bảng có `deleted_at`, xoá = soft delete, vẫn còn trong audit log.
5. **Mọi thao tác ghi đều để lại vết** trong `audit_logs` (xem §5) — do trigger DB ghi, không phụ thuộc frontend.
6. **Tiền chỉ vào quỹ khi có người có quyền xác nhận đã nhận** — sinh viên quét QR chuyển khoản rồi thủ quỹ xác nhận, hoặc thủ quỹ thu tiền mặt. **Không** lấy cột `Trạng thái`/`Số tiền` của file Excel import để cộng vào quỹ; file Excel chỉ dùng nhập danh sách lớp.

---

## 2. Database schema (viết migration SQL đầy đủ, chạy được)

```sql
-- ===== ENUM =====
create type fund_type as enum ('QUY_LOP', 'QUY_DOAN');
create type app_role  as enum ('owner', 'admin', 'treasurer', 'member');
create type pay_method as enum ('CASH', 'TRANSFER');
create type period_status as enum ('OPEN', 'CLOSED');

-- ===== PROFILES (1-1 với auth.users) =====
create table profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  full_name   text not null default '',
  role        app_role not null default 'member',
  is_active   boolean not null default true,
  student_id  uuid,                       -- gắn account với 1 sinh viên (xem công nợ của mình)
  created_at  timestamptz not null default now(),
  last_sign_in_at timestamptz
);

-- ===== SINH VIÊN =====
create table students (
  id          uuid primary key default gen_random_uuid(),
  stt         int,
  code        text not null,              -- Mã SV, LUÔN là text
  last_name   text not null default '',   -- họ + đệm
  first_name  text not null default '',   -- tên
  full_name   text generated always as (btrim(last_name || ' ' || first_name)) stored,
  dob         date,
  class_code  text,
  note        text default '',
  is_active   boolean not null default true,
  deleted_at  timestamptz,
  created_at  timestamptz not null default now(),
  created_by  uuid references profiles(id)
);
create unique index students_code_uniq on students(code) where deleted_at is null;

-- ===== ĐỢT THU =====
create table periods (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  fund        fund_type not null,
  amount_per_student bigint not null check (amount_per_student >= 0),
  open_date   date not null,
  due_date    date,
  status      period_status not null default 'OPEN',
  note        text default '',
  deleted_at  timestamptz,
  created_at  timestamptz not null default now(),
  created_by  uuid references profiles(id)
);

-- ===== THU =====
create table incomes (
  id          uuid primary key default gen_random_uuid(),
  date        date not null,
  fund        fund_type not null,
  period_id   uuid references periods(id),
  student_id  uuid references students(id),
  payer_name  text default '',            -- dùng khi thu từ nguồn khác (tài trợ, thầy cô)
  amount      bigint not null check (amount > 0),
  method      pay_method not null default 'CASH',
  collected_by text not null default '',
  note        text default '',
  deleted_at  timestamptz,
  created_at  timestamptz not null default now(),
  created_by  uuid references profiles(id),
  constraint income_has_payer check (student_id is not null or btrim(payer_name) <> '')
);

-- ===== CHI =====
create table expenses (
  id          uuid primary key default gen_random_uuid(),
  date        date not null,
  fund        fund_type not null,
  item        text not null,              -- mua món gì
  category    text not null default 'Khác',
  buyer       text not null,              -- AI đi mua (bắt buộc)
  amount      bigint not null check (amount > 0),
  has_receipt boolean not null default false,
  receipt_url text,                       -- ảnh hoá đơn trong Supabase Storage
  note        text default '',
  deleted_at  timestamptz,
  created_at  timestamptz not null default now(),
  created_by  uuid references profiles(id)
);

-- ===== AUDIT LOG =====
create table audit_logs (
  id          bigserial primary key,
  at          timestamptz not null default now(),
  actor_id    uuid references profiles(id),
  actor_email text,
  action      text not null,              -- INSERT | UPDATE | SOFT_DELETE | RESTORE | LOGIN | ROLE_CHANGE | IMPORT | EXPORT
  table_name  text not null,
  record_id   text,
  summary     text,                       -- câu tiếng Việt đọc hiểu ngay
  before_data jsonb,
  after_data  jsonb,
  changed_fields text[],
  ip          text,
  user_agent  text
);
create index audit_logs_at_idx on audit_logs(at desc);
create index audit_logs_table_idx on audit_logs(table_name, record_id);
```

### View báo cáo (nguồn sự thật duy nhất cho mọi con số)

```sql
create view v_fund_balance as
select f.fund,
       coalesce(i.total, 0) as total_income,
       coalesce(e.total, 0) as total_expense,
       coalesce(i.total, 0) - coalesce(e.total, 0) as balance
from (select unnest(enum_range(null::fund_type)) as fund) f
left join (select fund, sum(amount) total from incomes  where deleted_at is null group by fund) i on i.fund = f.fund
left join (select fund, sum(amount) total from expenses where deleted_at is null group by fund) e on e.fund = f.fund;

-- Công nợ từng SV × từng đợt
create view v_student_debt as
select s.id as student_id, s.code, s.full_name, p.id as period_id, p.name as period_name, p.fund,
       p.amount_per_student as must_pay,
       coalesce(sum(i.amount), 0) as paid,
       greatest(p.amount_per_student - coalesce(sum(i.amount), 0), 0) as remaining
from students s
cross join periods p
left join incomes i on i.student_id = s.id and i.period_id = p.id and i.deleted_at is null
where s.deleted_at is null and s.is_active and p.deleted_at is null
group by s.id, s.code, s.full_name, p.id, p.name, p.fund, p.amount_per_student;
```

Thêm view `v_daily_ledger` (gộp thu+chi theo thời gian, kèm số dư luỹ kế theo từng quỹ dùng `sum() over (partition by fund order by date, id)`) để phục vụ Dashboard và sheet "Nhật ký theo ngày".

---

## 3. Xác thực & phân quyền

### 3.1. Vai trò

| Vai trò | Ai dùng |
|---|---|
| `guest` (chưa đăng nhập) | Cả lớp, phụ huynh — xem để minh bạch |
| `member` | Sinh viên đã có account — xem đầy đủ + xem công nợ của chính mình |
| `treasurer` (Thủ quỹ) | Người thu tiền, đi mua — nhập thu/chi |
| `admin` (Quản trị) | Lớp trưởng — toàn quyền nghiệp vụ + quản lý account |
| `owner` (Chủ sở hữu) | Người dựng hệ thống — thêm/xoá cả admin, xem audit log đầy đủ |

### 3.2. Ma trận quyền — implement trong `src/lib/permissions.ts` **và** RLS policy tương ứng

| Hành động | guest | member | treasurer | admin | owner |
|---|:--:|:--:|:--:|:--:|:--:|
| Xem Dashboard, tổng thu/chi/tồn quỹ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Xem danh sách chi tiết thu / chi | ✅ | ✅ | ✅ | ✅ | ✅ |
| Xem danh sách lớp & công nợ | ✅¹ | ✅ | ✅ | ✅ | ✅ |
| Export Excel | ❌ | ✅ | ✅ | ✅ | ✅ |
| Thêm/sửa **Thu** | ❌ | ❌ | ✅ | ✅ | ✅ |
| Thêm/sửa **Chi** | ❌ | ❌ | ✅ | ✅ | ✅ |
| Xoá (soft delete) thu/chi | ❌ | ❌ | ✅² | ✅ | ✅ |
| Tạo/sửa/đóng **đợt thu** | ❌ | ❌ | ❌ | ✅ | ✅ |
| Thêm/sửa **sinh viên**, import danh sách | ❌ | ❌ | ✅ | ✅ | ✅ |
| Mời account mới, đổi vai trò | ❌ | ❌ | ❌ | ✅³ | ✅ |
| Vô hiệu hoá account | ❌ | ❌ | ❌ | ✅³ | ✅ |
| Xem **audit log** | ❌ | ❌ | ✅⁴ | ✅ | ✅ |
| Phục hồi bản ghi đã xoá | ❌ | ❌ | ❌ | ✅ | ✅ |
| Đổi cấu hình lớp, xoá dữ liệu hàng loạt | ❌ | ❌ | ❌ | ❌ | ✅ |

¹ Guest chỉ xem chế độ ẩn danh nếu admin bật công tắc "Ẩn tên SV với khách" (hiển thị `Nguyễn V. A.`); ngày sinh **luôn bị ẩn** với guest.
² Thủ quỹ chỉ xoá được bản ghi **do chính mình tạo** và **trong vòng 24h**; quá hạn phải nhờ admin.
³ Admin không được tự nâng mình lên `owner`, không được đổi vai trò của `owner`.
⁴ Thủ quỹ chỉ xem log các bản ghi thu/chi, không xem log account.

### 3.3. Yêu cầu kỹ thuật auth

- Supabase Auth email + password, kèm **magic link** cho ai không muốn nhớ mật khẩu.
- **Guest xem được mà không cần đăng nhập**: dùng `anon` role với RLS `select` cho phép trên các bảng/view cần thiết (dữ liệu tài chính lớp là công khai với lớp) — nhưng `audit_logs`, `profiles`, `students.dob` thì **anon không đọc được**.
- Không có self-signup tự do: đăng ký chỉ qua **lời mời** (admin tạo invite → gửi email → người nhận đặt mật khẩu). Trang `/signup` không có nếu không có token mời hợp lệ.
- Helper trong DB, dùng lại trong mọi policy:
  ```sql
  create or replace function current_role() returns app_role
  language sql stable security definer as $$
    select coalesce((select role from profiles where id = auth.uid() and is_active), 'member')
  $$;
  create or replace function has_min_role(min app_role) returns boolean ...  -- so sánh theo thứ tự owner>admin>treasurer>member
  ```
- Bật RLS trên **tất cả** các bảng. Viết policy riêng cho từng `select/insert/update/delete`. `audit_logs`: chỉ `insert` bằng trigger (`security definer`), **không có policy update/delete cho bất kỳ ai** — log là bất biến.
- Session: auto refresh token, hiện dialog "Phiên đăng nhập đã hết hạn" thay vì đá thẳng ra trang login mất dữ liệu form đang gõ.
- UI phải phản ánh quyền: nút không có quyền thì **ẩn hẳn** (không phải disable im lặng); nếu guest bấm vào chỗ cần quyền → hiện panel "Đăng nhập để thao tác" mềm mại, không phải alert.

---

## 4. Audit log (yêu cầu trọng tâm)

- **Trigger DB** `audit_trigger()` gắn `after insert or update` trên `students, periods, incomes, expenses, profiles`. Ghi `before_data`, `after_data`, `changed_fields` (tính bằng cách so sánh `to_jsonb(old)` vs `to_jsonb(new)`), `actor_id = auth.uid()`.
- Nhận diện `UPDATE` mà `deleted_at` chuyển từ `null` → có giá trị ⇒ `action = 'SOFT_DELETE'`; ngược lại ⇒ `RESTORE`.
- Frontend ghi thêm các event không sinh từ bảng: `LOGIN`, `LOGOUT`, `EXPORT`, `IMPORT` (kèm tên file + số dòng), `ROLE_CHANGE` — qua RPC `log_event(action, summary, meta)`.
- **`summary` phải là câu tiếng Việt đọc hiểu ngay**, sinh trong trigger, ví dụ:
  - `Thủ quỹ Nam đã thêm khoản chi 120.000 ₫ (Nước + bánh sinh hoạt lớp) từ Quỹ Lớp`
  - `Admin An đã sửa số tiền thu của Trần Văn Mẫu: 30.000 ₫ → 50.000 ₫`
  - `An đã đổi vai trò của Nam: thành viên → thủ quỹ`
- **Trang Audit Log**: timeline dọc, mỗi item có avatar chữ cái, thời gian tương đối (`3 phút trước`, hover ra ngày giờ đầy đủ), badge màu theo `action`, badge quỹ nếu liên quan tiền. Lọc theo: người thực hiện, loại hành động, bảng, khoảng ngày; tìm kiếm full-text trong `summary`; phân trang cuộn vô hạn.
- Bấm vào 1 item → mở panel **diff before/after** dạng 2 cột, field thay đổi được highlight, giá trị tiền và ngày được format sẵn (không show JSON thô cho người dùng thường; có nút "Xem JSON gốc" cho owner).
- Nút **Phục hồi** ngay trên item `SOFT_DELETE` (chỉ admin/owner), có confirm và bản thân việc phục hồi cũng bị ghi log.
- Export audit log ra Excel (sheet `Audit log`) theo khoảng ngày.

---

## 5. Quản lý account (trang `/users`, chỉ admin/owner)

- Bảng danh sách: Họ tên, Email, Vai trò (dropdown đổi tại chỗ, có confirm), Gắn với SV nào, Trạng thái (Đang hoạt động / Đã vô hiệu), Đăng nhập gần nhất, Ngày tạo.
- **Mời account**: nhập email + chọn vai trò + (tuỳ chọn) gắn với 1 sinh viên trong danh sách lớp → gửi invite. Hiện danh sách lời mời đang chờ, có nút gửi lại / thu hồi.
- **Vô hiệu hoá** thay cho xoá account (giữ nguyên vết trong audit log). Account bị vô hiệu → RLS chặn mọi thao tác, đăng nhập vào chỉ thấy thông báo.
- Yêu cầu bảo vệ: **luôn phải còn ít nhất 1 `owner` đang hoạt động** — chặn ở cả UI và DB trigger.
- Trang `/profile` cho mọi người: đổi tên, đổi mật khẩu, xem "công nợ của tôi" nếu account được gắn với 1 SV.
- Mọi thay đổi vai trò/trạng thái đều yêu cầu confirm nêu rõ hệ quả: *"Nam sẽ có thể thêm và sửa mọi khoản thu chi. Xác nhận?"*

---

## 6. Design system — Typography thân thiện & dễ tiếp cận

### 6.1. Font
- **Font chính (UI + body): `Be Vietnam Pro`** — thiết kế riêng cho tiếng Việt nên dấu (ắ, ậ, ễ, ợ) không bị đè hay lệch, chữ tròn, thân thiện, không "hành chính".
- **Font tiêu đề: `Lexend`** — được thiết kế để tăng tốc độ đọc, chữ mở, rất dễ tiếp cận.
- **Số trong bảng/thẻ số**: dùng font chính + bắt buộc `font-variant-numeric: tabular-nums` để các cột tiền thẳng hàng tuyệt đối; số lớn ở Dashboard dùng weight 600.
- Nạp qua Google Fonts với **subset `vietnamese`** (`&display=swap`), `preconnect` tới `fonts.gstatic.com`, và luôn có fallback stack thật:
  `font-family: 'Be Vietnam Pro', 'Segoe UI', system-ui, -apple-system, 'Noto Sans', sans-serif;`
- Kiểm tra hiển thị đủ bộ dấu tiếng Việt trước khi chốt font (test chuỗi: `Lương Văn Chín · Đặng Văn Bảy · Trương Đoàn Quang Mười · Quỹ · 1.000.000 ₫`).

### 6.2. Thang chữ & khoảng đọc
- Base **16px** (không nhỏ hơn — đây là app cho cả lớp dùng trên điện thoại). Scale: `12 · 13 · 14 · 16 · 18 · 22 · 28 · 36 · 48`.
- `line-height`: body **1.6**, tiêu đề **1.25**, số lớn **1.1**. `letter-spacing`: tiêu đề `-0.01em`, chữ in hoa nhỏ (label) `+0.04em`.
- Độ dài dòng văn bản tối đa **~72 ký tự** (`max-w-prose`).
- **Không dùng chữ mảnh (weight 300) trên nền màu**, không dùng chữ xám nhạt < 4.5:1.
- **Công tắc "Chế độ dễ đọc"** (lưu vào profile): tăng cỡ chữ 112%, `line-height` 1.8, `letter-spacing` `+0.01em`, `word-spacing` `+0.05em`, tắt mọi chữ in hoa toàn phần. Kèm công tắc **cỡ chữ: Vừa / Lớn / Rất lớn** (`html { font-size }`).

### 6.3. Màu & tương phản
- Tương phản tối thiểu **AA 4.5:1** cho chữ thường, **3:1** cho chữ ≥ 24px và cho viền các thành phần tương tác. Kiểm bằng cách tính contrast trong code review, không "ước lượng bằng mắt".
- **Màu định danh quỹ, nhất quán toàn app**: Quỹ Lớp = xanh chàm (indigo), Quỹ Đoàn = hổ phách/cam đất (amber). Badge quỹ xuất hiện trên **mọi** dòng thu/chi, mọi thẻ số, mọi biểu đồ.
- Thu = xanh lá đậm, Chi = đỏ gạch, Tồn quỹ = màu chữ chính in đậm. **Không dùng màu làm phương tiện truyền tin duy nhất** — luôn kèm icon (↑ ↓) hoặc chữ.
- Dark mode đầy đủ theo token, tôn trọng `prefers-color-scheme` + cho phép ghi đè thủ công (3 trạng thái: Sáng / Tối / Theo hệ thống).

---

## 7. Motion system — mượt mà, hiệu ứng rõ ràng

Định nghĩa token trong `src/lib/motion.ts`, **mọi animation phải lấy từ token**, không gõ số rời rạc:

```ts
export const DUR = { instant: .09, fast: .14, base: .2, slow: .32, page: .42 };  // giây
export const EASE = {
  out:   [0.22, 1, 0.36, 1],       // vào màn hình — dứt khoát, mượt
  inOut: [0.4, 0, 0.2, 1],
  in:    [0.4, 0, 1, 1],           // ra khỏi màn hình — nhanh hơn khi vào
};
export const SPRING = {
  soft:  { type: 'spring', stiffness: 260, damping: 26, mass: .9 },
  snappy:{ type: 'spring', stiffness: 420, damping: 32 },
};
```

**Nguyên tắc**: vào chậm hơn ra · chỉ animate `transform` và `opacity` (không animate `width/height/top/left/box-shadow`) · mọi animation đều có mục đích giải thích thay đổi, không trang trí vô nghĩa · không có gì animate > 500ms.

Danh sách hiệu ứng bắt buộc:

1. **Chuyển trang**: `AnimatePresence mode="wait"`, fade + trượt lên 8px, `DUR.page` với `EASE.out`. Sidebar item active có thanh chỉ thị chạy mượt bằng `layoutId`.
2. **Số liệu Dashboard**: count-up từ 0 → giá trị trong 700ms `easeOutExpo`, format tiền theo từng frame; khi số thay đổi do realtime thì chỉ tween từ giá trị cũ → mới và flash nhẹ màu nền.
3. **Thẻ số & thanh tiến độ thu**: progress dùng `scaleX` với `SPRING.soft`, có ánh sáng chạy qua (shimmer) 1 lần khi vừa đạt 100%.
4. **Bảng dữ liệu**: hàng xuất hiện **stagger 24ms/hàng, tối đa 12 hàng** rồi hiện phần còn lại cùng lúc (tránh chờ lâu). Sắp xếp/lọc lại → dùng `layout` để hàng **trượt** về vị trí mới thay vì nhảy.
5. **Dòng mới vừa thêm**: highlight nền màu accent rồi tan dần trong 1.8s + tự cuộn tới (`scrollIntoView({behavior:'smooth', block:'center'})`).
6. **Optimistic UI**: khi đang gửi lên server, dòng hiện ở `opacity .55` + shimmer nhẹ; thành công → snap về `opacity 1` kèm dấu ✓ vẽ nét (SVG `pathLength` animate); thất bại → dòng **rung ngang 4px, 2 nhịp** và hiện toast lỗi có nút "Thử lại".
7. **Modal / Dialog**: backdrop fade + `backdrop-blur` 0→8px; panel `scale .96→1` + `y 12→0` với `SPRING.snappy`. Đóng: nhanh hơn (`DUR.fast`). Modal thu/chi khi đổi quỹ → **badge quỹ và viền form đổi màu mượt 200ms** để người nhập không bao giờ nhầm quỹ.
8. **Toast**: trượt vào từ góc dưới phải, có progress bar đếm ngược, hover thì dừng đếm, hỗ trợ xếp chồng.
9. **Import file**: dropzone khi kéo file vào → viền nét đứt chạy (`stroke-dashoffset` animate) + `scale 1.02`; khi parse → skeleton shimmer; xong → bảng preview stagger vào; nút "Xác nhận import" có progress vòng tròn theo số dòng đã ghi.
10. **Loading**: **skeleton** đúng hình dáng nội dung thật (không dùng spinner toàn trang). Spinner chỉ dùng bên trong nút đang submit.
11. **Empty state**: minh hoạ SVG nhỏ có animation nhẹ (float 3s vô hạn, biên độ 4px) + câu dẫn hành động rõ ràng.
12. **Micro-interaction**: nút `whileHover scale 1.02 / whileTap scale .97`; icon nút xoá đổi màu + rung nhẹ khi hover; tab chuyển bằng `layoutId` underline; accordion mở bằng `height: auto` của Framer Motion (được phép, dùng `layout`).
13. **Realtime**: dữ liệu người khác vừa nhập → hiện chip "Có 1 khoản chi mới" trượt xuống từ trên, bấm vào thì merge vào bảng với hiệu ứng highlight (không tự nhảy làm mất chỗ đang xem).

**Accessibility của motion — bắt buộc**: tôn trọng `prefers-reduced-motion: reduce` → tắt toàn bộ trượt/scale/stagger/count-up, chỉ giữ fade ≤ 120ms; kèm công tắc thủ công "Giảm chuyển động" trong Cài đặt. Không có hiệu ứng nhấp nháy > 3 lần/giây.

---

## 8. Accessibility (không phải mục cho vui — sẽ bị kiểm tra)

- Điều hướng **hoàn toàn bằng bàn phím**: `Tab` đi đúng thứ tự đọc, focus ring dày 2px màu tương phản cao và **không bị `outline: none`**, modal có focus trap + `Esc` để đóng + trả focus về nút đã mở nó.
- Vùng bấm tối thiểu **44×44px** trên mobile.
- Semantic HTML: `<table>` thật cho bảng dữ liệu (có `<caption>`, `<th scope>`), `<button>` cho hành động, `<a>` cho điều hướng, landmark `<header><nav><main>`.
- Form: mỗi input có `<label>` thật (không chỉ placeholder), lỗi gắn bằng `aria-describedby` + `aria-invalid`, thông báo lỗi bằng chữ rõ ràng tiếng Việt ("Số tiền phải lớn hơn 0", không phải "Invalid input").
- Thay đổi động (số dư cập nhật, kết quả lọc, toast) thông báo qua `aria-live="polite"`.
- Skip link "Bỏ qua tới nội dung chính". `<html lang="vi">`. Có `title` riêng cho từng trang.
- Kiểm tra: Lighthouse Accessibility ≥ 95, `axe-core` không còn lỗi mức serious/critical.

---

## 9. Các màn hình

### 9.1. Dashboard — "Báo cáo tự động"
- Hàng thẻ số **tách theo quỹ**: cột Quỹ Lớp · cột Quỹ Đoàn · cột Tổng cộng (2 quỹ); mỗi cột 3 số: `Tổng thu`, `Tổng chi`, `Tồn quỹ hiện tại` (in đậm, to nhất).
- Bộ lọc thời gian toàn cục: Tất cả · Tháng này · Học kỳ này · Khoảng ngày tuỳ chọn. Khi đang lọc, **luôn hiện thêm dòng "Tồn quỹ luỹ kế toàn thời gian"** để không ai hiểu nhầm.
- Tiến độ từng đợt thu: thanh progress + `đã thu / phải thu`, số SV đã đóng / còn nợ / đóng thiếu.
- Bảng **Top 10 công nợ** (kèm tên các đợt còn thiếu) và 5 khoản thu / 5 khoản chi gần nhất.
- Biểu đồ nhẹ: cột thu–chi theo tháng (2 màu quỹ) + donut cơ cấu chi theo danh mục. Dùng SVG tự vẽ hoặc Recharts, có animation vào lần đầu, có tooltip bàn phím truy cập được.

### 9.2. Danh sách lớp
Bảng: STT · Mã SV · Họ và tên · Ngày sinh (ẩn với guest) · Lớp · **cột động cho từng đợt thu** (ô ghi `Đã đóng` / `Thiếu 20.000` / `Chưa đóng`, click ô để ghi nhận nộp nhanh nếu có quyền) · `Tổng đã nộp` · `Tổng còn nợ`.
- Tìm kiếm **bỏ dấu vẫn khớp** ("tran van mau" → "Trần Văn Mẫu"), lọc theo đợt/quỹ/còn nợ/đã đủ, sort mọi cột, ghim header, virtualize nếu > 200 dòng.
- Thêm/sửa SV, vô hiệu hoá SV (không xoá cứng).

### 9.3. Thu qua QR chuyển khoản (cách nộp chính)
- Bảng `class_settings` (hoặc `meta`) giữ **một** tài khoản nhận tiền: `bank_bin`, `bank_name`, `account_no`, `account_name`, `note_template` (biến `{ma} {ten} {dot} {quy} {lop}`). Chỉ `admin`/`owner` sửa được; RLS chỉ cho đọc các trường cần để dựng QR.
- Client dựng **payload VietQR (Napas 247)** theo EMVCo và tự vẽ QR: `00` phiên bản · `01` kiểu (`11`/`12`) · `38` (GUID `A000000727` + BIN + số TK + `QRIBFTTA`) · `53`=`704` · `54` số tiền · `58`=`VN` · `62.08` nội dung · `63` CRC16/CCITT-FALSE. Nội dung chuyển khoản: bỏ dấu, in hoa, ≤ 25 ký tự, luôn chứa mã SV.
- **Mỗi sinh viên × mỗi đợt một QR riêng**, gắn sẵn số tiền còn phải nộp. `member` đăng nhập chỉ thấy QR **của chính mình** (RLS theo `profiles.student_id`); `guest` không thấy QR của ai.
- Nút **"Đã nhận được tiền"** chỉ hiện với `treasurer`/`admin`/`owner`; bấm vào tạo bản ghi thu `method = TRANSFER`, ghi chú `Chuyển khoản QR`, và sinh audit log nêu rõ ai xác nhận.
- **"QR cả lớp"** cho một đợt: lưới QR của mọi SV còn nợ + nút in. Sheet `QR chuyen khoan` trong file Excel xuất ra để đối chiếu sao kê.

### 9.4. Thu tay — "Thêm khoản thu"
`Ngày` (mặc định hôm nay) · `Quỹ` **(bắt buộc, nổi bật)** · `Đợt thu` (lọc theo quỹ) · `Sinh viên` (combobox tìm theo tên/mã, hoặc "Nguồn khác" → gõ tên người nộp) · `Số tiền` (mặc định = mức thu của đợt, cho sửa để nộp thiếu/nộp bù) · `Hình thức` · `Người thu` (mặc định = tên account đang đăng nhập) · `Ghi chú`.
- **Thu theo lô**: chọn 1 đợt → tick nhiều SV → ghi nhận 1 lần (mỗi SV 1 bản ghi riêng), có progress từng dòng.
- Cảnh báo (không chặn) nếu tổng nộp của SV trong đợt vượt mức phải nộp.
- Lịch sử thu: lọc theo quỹ/đợt/SV/khoảng ngày, hiện dòng tổng của kết quả đang lọc.

### 9.5. Chi — "Thêm khoản chi" (nhật ký mua sắm)
`Ngày` · `Quỹ` **(rút từ Quỹ Lớp hay Quỹ Đoàn — bắt buộc, hiển thị nổi bật)** · `Nội dung/Mua món gì` · `Danh mục` · `Người đi mua` **(bắt buộc)** · `Số tiền` · `Ảnh hoá đơn` (upload lên Supabase Storage, xem lightbox) · `Ghi chú`.
- **Cảnh báo vượt quỹ**: nếu số chi > tồn quỹ hiện tại của quỹ đó → cảnh báo đỏ nêu rõ tồn quỹ và số thiếu; vẫn cho lưu khi người dùng xác nhận (thực tế có ứng trước), bản ghi được đánh dấu ⚠ trong danh sách và trong export.
- Nhật ký chi mặc định mới → cũ; lọc theo quỹ/danh mục/người mua/khoảng ngày; dòng tổng theo kết quả lọc.

### 9.6. Đợt thu
CRUD, đóng/mở đợt, nhân bản đợt cho kỳ sau, trang chi tiết đợt (đã đóng / chưa đóng / đóng thiếu, thu thực tế vs dự kiến).

### 9.7. Cài đặt (admin)
Tên lớp, khoa, học kỳ, năm học · công tắc "Ẩn tên SV với khách" · danh mục chi tuỳ chỉnh · cỡ chữ / chế độ dễ đọc / giảm chuyển động · sao lưu & phục hồi.

---

## 10. Import danh sách lớp — bám đúng file thật

File mẫu: `Danh sách đóng góp quỹ lớp DCXDXD69_03B (2).xlsx`. Parser **phải xử lý đúng file này**, vì nó có đủ 5 cái bẫy sau:

- **1 sheet tên `Trang tính1`** → không hard-code tên sheet; mặc định sheet đầu, cho người dùng chọn sheet khác.
- **Dòng 1–9 là tiêu đề hành chính**, không phải dữ liệu: `BỘ GIÁO DỤC VÀ ĐÀO TẠO`, `TRƯỜNG ĐẠI HỌC MỎ - ĐỊA CHẤT`, `CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM`, `Hà Nội, ngày … năm 2026`, `DANH SÁCH ĐÓNG GÓP QUỸ LỚP HỌC KỲ I - NĂM HỌC 2026-2027`, `KHOA: XÂY DỰNG - LỚP: DCXDXD69_03B`.
  → **Tự dò dòng header**: quét 30 dòng đầu, tìm dòng chứa đồng thời `STT` và `Mã SV`/`Họ và tên`. Đồng thời **tự điền sẵn** tên lớp / khoa / học kỳ / năm học từ các dòng trên để người dùng chỉ cần xác nhận.
- **Dòng header (dòng 10)**: `STT | Mã SV | Họ và tên SV | | Ngày sinh | Lớp | Trạng thái | Số tiền | Ngày | Mua | Phát sinh | Tổng tiền còn lại | Tiền thiếu`.
- **Ô "Họ và tên SV" bị merge 2 cột (C10:D10)**: họ + đệm ở cột C, tên ở cột D → phải **ghép `C + " " + D`** thành `full_name`, đồng thời giữ `last_name` / `first_name`. Chuẩn hoá: trim, bỏ khoảng trắng kép, giữ nguyên hoa/thường tiếng Việt.
- **Mã SV lưu dạng số** → đọc ra thành `2.400000001E9`. Phải ép về **string số nguyên**, không dấu thập phân, không ký hiệu khoa học, giữ số 0 đầu nếu có → `"2400000001"`.
- **Ngày sinh là serial Excel hệ 1900** (gốc `1899-12-30`): `38918 → 2006-07-20`, `38873 → 2006-06-05`, `38399 → 2005-02-16`, `39077 → 2006-12-26`. Nếu ô là chuỗi thì nhận cả `dd/MM/yyyy` và `d/M/yy`. Ngày sinh sau quy đổi phải nằm trong 2000–2010, lệch ra ngoài thì **cảnh báo dòng đó** thay vì ghi bừa.
- **Cột `Trạng thái` có khoảng trắng cuối**: `"Đã đóng "`, `"Chưa đóng "`, hoặc trống → trim + so sánh bỏ dấu, không phân biệt hoa thường. Hai cột `Trạng thái` và `Số tiền` **chỉ hiển thị để đối chiếu**, **không** tạo bản ghi Thu (xem §1.6).
- **Dòng cuối là dòng tổng**: `Tổng quỹ : … 1000000`, cách bảng vài dòng trống → dừng đọc khi gặp ≥ 2 dòng trống liên tiếp hoặc ô bắt đầu bằng `Tổng`/`Cộng`. **Tuyệt đối không** biến dòng tổng thành sinh viên. Sau import, đối chiếu: *"Tổng trong file: 1.000.000 ₫ / Hệ thống tính được: … ₫"* và cảnh báo nếu lệch.
- File mẫu có **49 SV (dòng 11–59)** → thông báo kết quả phải ghi rõ `Đọc được 49 sinh viên`.

Luồng import chung:
1. Nhận `.xlsx`, `.xls`, `.csv` qua nút chọn file **và** kéo–thả. Parse **trong Web Worker** để không đứng UI.
2. **Bảng mapping cột**: tự đoán theo alias (bỏ dấu, không phân biệt hoa thường), người dùng chỉnh lại từng cột qua dropdown. Alias tối thiểu — `Mã SV`: masv, mssv, mã sinh viên, student code · `Họ và tên`: ho ten, họ và tên sv, fullname, tên · `Ngày sinh`: ngay sinh, dob, ns · `Lớp`: lop, class · `Trạng thái`: trang thai, tình trạng · `Số tiền`: so tien, đã nộp · `Ngày`: ngay nop · `Ghi chú`: ghi chu, note, phát sinh.
3. **Preview 20 dòng đầu** + thống kê `hợp lệ / lỗi / trùng`; **chỉ ghi vào DB khi bấm "Xác nhận import"**.
4. **Chống trùng** theo `Mã SV` (thiếu mã thì theo `full_name + dob`), 3 chế độ: `Bỏ qua trùng` / `Cập nhật SV đã có` / `Thêm mới hết`.
5. Bỏ qua dòng rỗng, dòng chỉ có STT, dòng lặp lại header.
6. Cho chọn **quỹ đích + đợt thu đích** (hoặc tạo đợt mới ngay trong dialog) khi tick tạo bản ghi thu.
7. Ghi bằng **1 transaction / RPC duy nhất** (`import_students(payload jsonb)`) để không có nửa vời; trả về `batch_id`.
8. Kết thúc: báo cáo `Thêm mới: n · Cập nhật: n · Bỏ qua: n · Lỗi: n` (kèm số dòng + lý do, tải được file .xlsx các dòng lỗi) và nút **Hoàn tác lần import này** (soft delete theo `batch_id`, được ghi audit log).
9. Có nút **"Tải file mẫu import"** xuất .xlsx đúng định dạng chuẩn.

---

## 11. Export Excel

Nút **Xuất Excel** với 3 phạm vi: **Tất cả** · **Theo khoảng ngày** (từ – đến) · **Theo một ngày cụ thể**; kèm lọc quỹ (Cả hai / chỉ Quỹ Lớp / chỉ Quỹ Đoàn). Sinh file ở client bằng SheetJS trong Web Worker, có progress.

Workbook phải có đúng các sheet sau, đúng thứ tự và đúng tên:

1. **`Tong quan`** — thông tin lớp, phạm vi xuất, người xuất, thời điểm xuất; bảng 3 cột (Quỹ Lớp | Quỹ Đoàn | Tổng cộng) × 3 dòng (Tổng thu | Tổng chi | Tồn quỹ). Có dòng "Tồn quỹ luỹ kế toàn thời gian" khi xuất theo khoảng ngày.
2. **`Thu`** — Ngày, Quỹ, Đợt thu, Mã SV, Họ và tên, Số tiền, Hình thức, Người thu, Ghi chú, Người nhập. Dòng cuối: tổng + tổng tách theo từng quỹ.
3. **`Chi`** — Ngày, Quỹ, Nội dung, Danh mục, Người đi mua, Số tiền, Có hoá đơn, Ghi chú, Người nhập. Dòng cuối: tổng + tổng theo quỹ.
4. **`Cong no`** — STT, Mã SV, Họ và tên, Lớp, mỗi đợt 1 cột (số đã nộp), `Phải nộp`, `Đã nộp`, `Còn thiếu`, `Trạng thái`.
5. **`Ma tran dot thu`** — ma trận SV × đợt, ô ghi `Đã đóng` / `Thiếu x` / `Chưa đóng`.
6. **`Danh sach lop`** — dữ liệu SV thuần, tái import được.
7. **`Nhat ky theo ngay`** — thu & chi gộp theo thứ tự thời gian: Ngày, Loại (Thu/Chi), Quỹ, Nội dung/Người nộp, Số tiền thu, Số tiền chi, **Số dư luỹ kế của quỹ tương ứng**.
8. **`Audit log`** — chỉ khi người xuất là admin/owner: Thời điểm, Người thực hiện, Hành động, Bảng, Diễn giải.

Quy ước:
- Tên file: `QuyLop_<MaLop>_<phamvi>_<yyyyMMdd-HHmm>.xlsx`, ví dụ `QuyLop_DCXDXD69_03B_20260901-20260930_20260909-1530.xlsx`.
- Cột tiền ghi **số thật** + format `#,##0` để Excel còn `SUM` được; cột ngày ghi kiểu ngày thật.
- Freeze dòng header, header in đậm có nền, độ rộng cột tự tính theo nội dung, auto-filter.
- Phạm vi lọc ra 0 bản ghi → vẫn xuất sheet có header + dòng "Không có dữ liệu trong khoảng đã chọn".
- Mỗi lần export ghi 1 audit log (`EXPORT`, kèm phạm vi + số dòng).
- Thêm nút **In / Xuất PDF** dùng `window.print()` với CSS `@media print` gọn gàng.

---

## 12. Bảo toàn dữ liệu

1. **Soft delete toàn hệ thống** — `deleted_at`, mọi query mặc định `where deleted_at is null`; trang "Thùng rác" (admin) để phục hồi trong 90 ngày.
2. **Audit log bất biến** — không policy update/delete, kèm `before_data` nên luôn dựng lại được lịch sử.
3. **Sao lưu**: nút "Tải toàn bộ dữ liệu (JSON)" + nút "Xuất Excel đầy đủ"; nhắc sao lưu nếu > 30 ngày chưa sao lưu. Hướng dẫn bật Point-in-time recovery / `pg_dump` định kỳ trong `README`.
4. **Cảnh báo về Supabase free tier**: project bị pause sau ~1 tuần không hoạt động — ghi rõ trong README cách khôi phục và khuyến nghị lịch sao lưu Excel hàng tháng của thủ quỹ.
5. **Migration có phiên bản**, đặt trong `supabase/migrations/`, không sửa migration đã chạy.
6. Ràng buộc dữ liệu ở DB (check, unique, FK), **không tin frontend**.

---

## 13. Test & tiêu chí nghiệm thu

Viết test (Vitest cho logic, Playwright cho luồng chính) phủ tối thiểu:
1. `Tồn quỹ = Thu − Chi` đúng cho từng quỹ sau chuỗi thêm/sửa/xoá/phục hồi.
2. Thu vào Quỹ Đoàn **không** làm đổi tồn Quỹ Lớp và ngược lại.
3. `2.400000001E9` → `"2400000001"`; serial `38918` → `2006-07-20`.
4. Import file mẫu → đúng **49** sinh viên, **không** có dòng "Tổng quỹ"; import lại lần 2 với chế độ "Bỏ qua trùng" → vẫn 49.
5. Export theo 1 ngày cụ thể chỉ chứa bản ghi của ngày đó; cột tiền trong file xuất `SUM` được.
6. Tổng `Còn thiếu` = `Σ(số SV × mức thu mỗi đợt) − Σ đã nộp`, đúng theo từng quỹ.
7. **RLS**: dùng `anon key` thử `insert` vào `incomes` → **bị chặn**; `member` thử `update` `expenses` → **bị chặn**; `treasurer` thử đổi role người khác → **bị chặn**; `anon` thử `select audit_logs` → **rỗng/bị chặn**. Test này chạy trực tiếp trên DB, không qua UI.
8. Mỗi thao tác ghi sinh đúng 1 audit log với `summary` tiếng Việt đúng nội dung.
8b. `crc16('123456789') === '29B1'`; payload VietQR bóc TLV đúng cấu trúc và CRC tự khớp; QR không số tiền ⇒ `01=11`, không có trường `54`; import file mẫu ⇒ **0** bản ghi thu được tạo.
9. Không thể vô hiệu hoá `owner` cuối cùng.
10. `prefers-reduced-motion: reduce` → không còn animation trượt/scale (kiểm bằng Playwright emulate).
11. Lighthouse: Accessibility ≥ 95, Performance ≥ 90 trên mobile; `axe-core` không lỗi serious/critical.

---

## 14. Bàn giao

- Repo chạy được với 3 lệnh: `npm i` → điền `.env` → `npm run dev`.
- `supabase/migrations/` đầy đủ + file `seed.sql` (2 đợt thu, vài SV, vài khoản chi, 1 owner mẫu) + hướng dẫn tạo owner đầu tiên.
- `README.md`: sơ đồ kiến trúc, sơ đồ quan hệ bảng, ma trận quyền, cách deploy, cách sao lưu, chỗ cần sửa khi muốn thêm quỹ thứ 3.
- Code: TypeScript strict, không `any`, component nhỏ, tên biến tiếng Anh, **comment tiếng Việt tại các chỗ nghiệp vụ dễ sai** (quy đổi serial ngày Excel, tách quỹ, tính công nợ, policy RLS).
- Bàn giao kèm ảnh chụp các màn hình chính ở cả light và dark mode.
