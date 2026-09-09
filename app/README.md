# Quỹ Lớp v2 — Supabase + React

Bản đầy đủ của hệ thống quản lý thu chi quỹ lớp: **có tài khoản, phân quyền 5 vai trò,
audit log** và thu tiền bằng **QR chuyển khoản VietQR**.

Bản một file không cần cài đặt nằm ở `../index.html` (xem `../README.md`).

---

## Dựng lên

### 1. Lấy URL và khoá công khai

Trong **Supabase Dashboard**, mở project của bạn:

- **Cách hiện tại**: `Project Settings` (bánh răng, góc dưới bên trái) → **API Keys** →
  copy **Publishable key** (`sb_publishable_...`). URL nằm ở `Project Settings` → **General** →
  *Project URL*, hoặc ngay trên trang API.
- **Project cũ hơn**: `Project Settings` → **API** → mục *Project URL* và
  *Project API keys* → dòng **`anon` `public`**.

Cả hai loại khoá đều dùng được với app này (`supabase-js` v2 nhận cả `anon` key kiểu JWT và
publishable key mới).

> ⚠️ **Đừng lấy `service_role` hay `sb_secret_...`.** Khoá đó bỏ qua toàn bộ RLS, và mọi biến
> `VITE_*` đều bị nhúng vào bundle nên ai mở web cũng đọc được. `npm run check` sẽ báo lỗi
> nếu bạn dán nhầm.

### 2. Điền vào `.env`

```bash
cd app
cp .env.example .env
```

```ini
VITE_SUPABASE_URL=https://abcdefghijklmnop.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_xxxxxxxxxxxxxxxxxxxx
```

Không đặt dấu ngoặc kép, không có dấu `/` ở cuối URL. File `.env` đã được `.gitignore`.

### 3. Chạy 3 migration

**Cách A — không cài gì thêm** (nhanh nhất): Dashboard → **SQL Editor** → *New query*, dán
lần lượt **đúng thứ tự**, mỗi file bấm *Run* một lần:

1. `supabase/migrations/0001_schema.sql`
2. `supabase/migrations/0002_functions.sql`
3. `supabase/migrations/0003_rls.sql`

**Cách B — có Supabase CLI**:

```bash
supabase link --project-ref <project-ref>   # project-ref là phần abcdefghijklmnop trong URL
supabase db push
```

Muốn có sẵn vài bản ghi để xem giao diện thì chạy thêm `supabase/seed.sql` (dữ liệu hư cấu).

### 4. Cấu hình Authentication

Dashboard → **Authentication**:

- **Sign In / Providers → Email**: để bật (mặc định đã bật).
- **Confirm email**: nếu bật (mặc định), người đăng ký phải mở link trong hộp thư mới đăng nhập
  được. Dùng cho lớp thì **tắt** đi cho nhanh — đổi lại là email không được xác thực, nhưng
  hệ thống này chỉ nhận email đã được mời nên rủi ro thấp.
- **URL Configuration**: đặt *Site URL* = `http://localhost:5173` khi phát triển, và thêm vào
  *Redirect URLs*:
  `http://localhost:5173/doi-mat-khau` (link đặt lại mật khẩu trả về đây).
  Khi deploy thì thêm domain thật, ví dụ `https://quy-lop.netlify.app/doi-mat-khau`.

### 5. Kiểm tra rồi chạy

```bash
npm install
npm run check     # xác nhận URL/khoá đúng, đã chạy đủ 3 migration, và RLS đang chặn đúng chỗ
npm run dev
```

`npm run check` gọi thẳng REST API bằng anon key — đúng như trình duyệt của sinh viên — nên nó
kiểm tra được cả việc **khách không đọc được** bảng `students`, `profiles`, `audit_logs`. Nếu
bước này báo "anon ĐỌC ĐƯỢC bảng students" thì bạn chưa chạy `0003_rls.sql`, đừng dùng thật.

Mở `http://localhost:5173/dang-ky` — **người đăng ký đầu tiên tự động thành chủ sở hữu**,
không cần chạy SQL tay. Sau đó vào trang **Tài khoản** để mời những người còn lại.

### Gặp lỗi?

| Hiện tượng | Nguyên nhân |
|---|---|
| `npm run check` báo *không tìm thấy view v_class_public* | Chưa chạy `0001_schema.sql` |
| Báo *không tìm thấy RPC log_event* | Chưa chạy `0002_functions.sql` |
| Báo *anon ĐỌC ĐƯỢC bảng students* | Chưa chạy `0003_rls.sql` |
| Đăng ký báo *Database error saving new user* | Email chưa được mời. Đây là trigger `handle_new_user()` chặn đúng thiết kế, nhưng Supabase đôi khi che câu tiếng Việt gốc ("Email … chưa được mời vào hệ thống Quỹ Lớp"). Người đầu tiên của hệ thống thì không cần lời mời. |
| Đăng nhập được nhưng không thấy nút thêm thu/chi | Tài khoản đang là *thành viên*. Nhờ quản trị nâng lên *thủ quỹ* ở trang Tài khoản. |
| Trang trắng sau khi deploy | Thiếu SPA fallback về `index.html`, hoặc chưa khai 2 biến môi trường ở nhà cung cấp hosting |

### Deploy

```bash
npm run build     # ra thư mục dist/
```

Đưa `dist/` lên Netlify / Vercel / Cloudflare Pages. Nhớ:
- khai `VITE_SUPABASE_URL` và `VITE_SUPABASE_ANON_KEY` trong phần environment variables,
- bật **SPA fallback** (mọi đường dẫn trả về `index.html`) để `/thu`, `/lop`… không bị 404,
- thêm domain thật vào *Redirect URLs* của Supabase.

---

## Năm vai trò

| Vai trò | Làm được gì |
|---|---|
| **Khách** (chưa đăng nhập) | Xem tổng thu / tổng chi / tồn quỹ từng quỹ, danh sách thu chi, tiến độ đợt thu, công nợ. **Không** thấy ngày sinh, số tài khoản, lịch sử thao tác, danh sách tài khoản. |
| **Thành viên** | Xem đầy đủ + xem công nợ của chính mình + xuất Excel + xem QR của mình |
| **Thủ quỹ** | + thêm/sửa thu, chi, sinh viên, nhập danh sách lớp, xác nhận đã nhận chuyển khoản. Chỉ xoá được bản ghi **do chính mình tạo, trong 24 giờ** |
| **Quản trị** | + đợt thu, cấu hình lớp và tài khoản nhận tiền, quản lý tài khoản, phục hồi bản ghi đã xoá |
| **Chủ sở hữu** | + cấp và thu quyền chủ sở hữu. Hệ thống luôn giữ ít nhất một chủ sở hữu đang hoạt động |

Phân quyền được thực thi bằng **Row Level Security trong Postgres**, không phải bằng việc ẩn nút:
kể cả gọi API trực tiếp bằng anon key cũng không vượt qua được. `src/lib/permissions.ts` chỉ để
giao diện biết nút nào nên hiện, và phải luôn khớp với `supabase/migrations/0003_rls.sql`.

---

## Thu tiền bằng QR

1. **Cài đặt → Tài khoản nhận chuyển khoản**: chọn ngân hàng (26 mã BIN Napas), số tài khoản,
   tên chủ tài khoản, mẫu nội dung (`{ma} {dot}` → `2400000001 QUY LOP HK1`).
2. **Đợt thu → “QR cả lớp”**: mỗi sinh viên còn nợ có một mã riêng, đã gắn sẵn **đúng số tiền
   còn thiếu** và nội dung chứa **mã SV**. In cả lớp một trang hoặc chụp từng ô gửi nhóm.
3. Sinh viên quét → chuyển khoản. Thủ quỹ đối chiếu sao kê rồi bấm **“Đã nhận được tiền”**;
   bản ghi được lưu với hình thức *Chuyển khoản* và ghi chú *Chuyển khoản QR*.

Payload dựng theo chuẩn **VietQR (Napas 247) / EMVCo**, CRC16/CCITT-FALSE, và được **vẽ ngay trên
máy người dùng** — số tài khoản không gửi tới dịch vụ sinh QR bên ngoài nào.

**Chưa có đối soát tự động với ngân hàng.** Tiền chỉ vào quỹ khi có người có quyền xác nhận —
đây là lựa chọn có ý thức, không phải thiếu sót: sổ quỹ không được tự tăng khi chưa ai kiểm tra.

---

## Nhập danh sách lớp

Kéo file Excel vào **Nhập / Xuất**. Parser xử lý sẵn 5 đặc thù của file danh sách thật
(đã kiểm thử trên `Danh sách đóng góp quỹ lớp DCXDXD69_03B`):

| Vấn đề của file thật | App xử lý |
|---|---|
| 9 dòng tiêu đề hành chính trước bảng | Tự dò dòng tiêu đề, tự điền mã lớp / khoa / học kỳ / năm học |
| Ô “Họ và tên SV” merge 2 cột | Ghép cột họ đệm + cột tên |
| Mã SV lưu dạng số → `2.400000001E9` | Ép về chuỗi số nguyên, giữ số 0 đầu |
| Ngày sinh là serial Excel (`38918`) | Quy đổi hệ 1900 (gốc `1899-12-30`) → `20/07/2006` |
| Dòng “Tổng quỹ” cách bảng 4 dòng trống | Không thành sinh viên; vẫn đọc riêng để đối chiếu |

Import **chỉ tạo danh sách sinh viên**: cột “Trạng thái”/“Số tiền” trong file chỉ để đối chiếu.
Toàn bộ lần nhập chạy trong **một transaction** (RPC `import_students`) và **hoàn tác được**
theo `batch_id`.

---

## Xuất Excel

8 sheet: `Tong quan` · `Thu` · `Chi` · `Cong no` · `Ma tran dot thu` · `Danh sach lop` ·
`Nhat ky theo ngay` (có số dư luỹ kế) · `QR chuyen khoan` (đối chiếu sao kê).
Cột tiền là **số thật** + format `#,##0`; cột ngày là **ngày thật** `dd/mm/yyyy`.

Hai chi tiết dễ sai đã được xử lý:
- Ô ngày **không** dùng `Date` của SheetJS mà tự tính serial, vì SheetJS quy đổi theo offset múi
  giờ *lịch sử* năm 1899 (Asia/Bangkok là +6:59:56) làm ô ngày dính phân số ~4 giây.
- Mọi danh sách **tải hết bằng phân trang** (`fetchAll`), vì Supabase mặc định chỉ trả 1000 dòng.
  Khi xuất “tất cả”, tổng tính từ các dòng còn được **đối chiếu với tồn quỹ do DB tính**; lệch thì
  file ghi thẳng cảnh báo `⚠ LỆCH SỐ LIỆU` thay vì im lặng xuất một con số sai.

---

## Kiểm thử

```bash
npm test              # 45 phép kiểm tra logic + smoke test mount App (vitest)
npm run build         # tsc strict + vite build
bash ../tests/db/run.sh   # 89 phép kiểm tra RLS/nghiệp vụ trên Postgres 17 thật (cần Docker)
```

Bộ DB dựng một Postgres sạch trong Docker, chạy đúng 3 migration, rồi kiểm tra ma trận quyền của
cả 5 vai trò (kể cả `anon`), đẳng thức tồn quỹ, tách biệt hai quỹ, quy tắc xoá mềm, bảo vệ tài
khoản, nội dung audit log và RPC import.

---

## Cấu trúc

```
supabase/migrations/   0001 schema + view · 0002 function/trigger/RPC · 0003 RLS
src/lib/               supabase · format (tiền, ngày, bỏ dấu) · vietqr · excel · permissions · motion
src/types/db.ts        kiểu dữ liệu DB (viết tay; sinh lại bằng npm run db:types)
src/data/api.ts        toàn bộ query/mutation — chọn nguồn dữ liệu theo vai trò, phân trang, kiểm tra số dòng
src/app/               App (router) · AuthProvider · ThemeProvider · ToastProvider
src/components/        ui.tsx (bộ thành phần) · Layout.tsx
src/features/          dashboard · students · incomes · expenses · periods · qr · users · audit · io · settings · auth
```

**Thêm quỹ thứ ba?** Thêm giá trị vào enum `fund_type` trong một migration mới, thêm entry vào
`FUNDS` ở `src/types/db.ts`, và thêm 2 biến màu `--c-<tên>` / `--c-<tên>-soft` trong `src/index.css`.
Mọi chỗ khác đều lặp theo `FUND_KEYS`.

---

## Giao diện

- Font **Be Vietnam Pro** (thiết kế cho tiếng Việt, dấu không bị đè) + **Lexend** cho tiêu đề.
  Cỡ chữ gốc 16px; số tiền dùng `tabular-nums` nên các cột tiền thẳng hàng.
- Sáng / Tối / Theo hệ thống · **Chế độ dễ đọc** · 3 mức cỡ chữ · **Giảm chuyển động**
  (và tôn trọng `prefers-reduced-motion`).
- Animation lấy từ token trong `src/lib/motion.ts`: chuyển trang, count-up số liệu,
  stagger hàng bảng 24ms, modal spring + backdrop blur, thanh tiến độ spring, toast xếp chồng.
- **Màu biểu đồ đã được kiểm định bằng máy**, không chọn theo cảm giác: cặp xanh-lá/đỏ quen dùng
  cho thu/chi **không đạt** (ΔE 5.5 với người mù màu deutan) nên biểu đồ tháng dùng chính hai màu
  định danh quỹ (ΔE 31.7 — đạt), tách làm hai biểu đồ nhỏ *Tiền vào* / *Tiền ra* dùng chung một
  thang đo thay vì gộp 4 cột, và luôn có legend kèm nhãn chữ.
- Điều hướng bàn phím đầy đủ, focus ring rõ, modal có focus trap, vùng bấm ≥ 44px,
  `aria-live` cho thông báo động, `<table>` thật có `<caption>` cho mọi bảng dữ liệu.
