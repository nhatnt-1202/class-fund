# Finance v2 — Supabase + React

Bản đầy đủ của hệ thống quản lý thu chi quỹ lớp: **nhiều lớp trong một hệ thống, có tài khoản,
phân quyền theo từng lớp, audit log** và thu tiền bằng **QR chuyển khoản VietQR**.

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

### 3. Chạy 9 migration

**Cách A — không cài gì thêm** (nhanh nhất): Dashboard → **SQL Editor** → *New query* → dán
**toàn bộ** file `supabase/setup_all.sql` → *Run*. File này là bản gộp của cả 9 migration nên
chỉ phải dán một lần; thành công thì SQL Editor báo *“Success. No rows returned”*.

Muốn dán từng file (dễ soi lỗi hơn) thì theo **đúng thứ tự** này, mỗi file *Run* một lần:

1. `supabase/migrations/0001_schema.sql`
2. `supabase/migrations/0002_functions.sql`
3. `supabase/migrations/0003_rls.sql`
4. `supabase/migrations/0004_multiclass.sql` — chuyển sang nhiều lớp (bảng `classes`, `memberships`)
5. `supabase/migrations/0005_multiclass_rls.sql` — RLS theo từng lớp
6. `supabase/migrations/0006_root_governance.sql` — chỉ tài khoản gốc mở lớp và giao quản trị lớp
7. `supabase/migrations/0007_class_officers.sql` — công bố ban quản lý lớp để đánh dấu trong danh sách
8. `supabase/migrations/0008_no_email_confirm.sql` — không bao giờ phải xác nhận email
9. `supabase/migrations/0009_guest_qr.sql` — khách cũng quét được QR để chuyển khoản

Sửa migration thì chạy `npm run db:bundle` để sinh lại `setup_all.sql`.

**Cách B — có Supabase CLI**:

```bash
supabase link --project-ref <project-ref>   # project-ref là phần abcdefghijklmnop trong URL
supabase db push
```

Muốn có sẵn vài bản ghi để xem giao diện thì chạy thêm `supabase/seed.sql` (dữ liệu hư cấu).

### 4. Cấu hình Authentication

Dashboard → **Authentication**:

- **Sign In / Providers → Email**: để bật (mặc định đã bật).
- **Confirm email**: không cần quan tâm. `0008_no_email_confirm.sql` tự điền
  `email_confirmed_at` ngay khi tài khoản được tạo, nên bật hay tắt công tắc kia cũng không
  còn ảnh hưởng: tài khoản đúng định dạng là đăng nhập được ngay. Ai không được phép đăng ký
  thì `handle_new_user()` đã chặn từ trước, không phải nhờ email xác nhận. Sinh viên đăng ký bằng email trường dạng
  `<mã SV>@student.humg.edu.vn` và đăng nhập được ngay, không phải mở hộp thư. Rủi ro thấp vì
  trigger `handle_new_user()` chỉ nhận đúng hai loại email: đúng định dạng mã sinh viên của
  trường, hoặc email đã được quản trị lớp thêm sẵn — email lạ bị chặn ngay khi đăng ký.
- **URL Configuration**: đặt *Site URL* = `http://localhost:5173` khi phát triển, và thêm vào
  *Redirect URLs*:
  `http://localhost:5173/reset-password` (link đặt lại mật khẩu trả về đây).
  Khi deploy thì thêm domain thật, ví dụ `https://class-fund.netlify.app/reset-password`.
  (Đường dẫn tiếng Việt cũ — `/doi-mat-khau` — vẫn được app tự chuyển sang đường dẫn mới,
  giữ nguyên cả token trong hash, nên link đã gửi đi trong hộp thư vẫn dùng được.)

### 5. Kiểm tra rồi chạy

```bash
npm install
npm run check     # xác nhận URL/khoá đúng, đã chạy đủ 9 migration, và RLS đang chặn đúng chỗ
npm run dev
```

`npm run check` gọi thẳng REST API bằng anon key — đúng như trình duyệt của sinh viên — nên nó
kiểm tra được cả việc **khách không đọc được** bảng `students`, `profiles`, `audit_logs`. Nếu
bước này báo "anon ĐỌC ĐƯỢC bảng students" thì bạn chưa chạy `0003_rls.sql`, đừng dùng thật.

Mở `http://localhost:5173/signup` — **người đăng ký đầu tiên tự động thành tài khoản gốc**
(chủ sở hữu hệ thống), không cần chạy SQL tay. Sau đó:

1. Vào **Quản lý lớp** → *Mở lớp mới*, điền mã lớp và **email của người sẽ quản trị lớp đó**.
   Email chưa có tài khoản cũng được: hệ thống giữ sẵn quyền, họ đăng ký là có ngay.
2. Người quản trị lớp đăng nhập, vào **Nhập / Xuất** để nhập danh sách lớp từ Excel.
3. Sinh viên tự đăng ký bằng `<mã SV>@student.humg.edu.vn` và **tự vào đúng lớp** có mã sinh
   viên đó trong danh sách — không cần ai mời.

### Gặp lỗi?

| Hiện tượng | Nguyên nhân |
|---|---|
| `npm run check` báo *không tìm thấy view v_class_public* | Chưa chạy `0001_schema.sql` |
| Báo *không tìm thấy RPC log_event* | Chưa chạy `0002_functions.sql` |
| Báo *anon ĐỌC ĐƯỢC bảng students* | Chưa chạy `0003_rls.sql` |
| Đăng ký báo *Database error saving new user* | Email không đúng dạng `<mã SV>@student.humg.edu.vn` và cũng chưa được quản trị lớp thêm sẵn. Đây là trigger `handle_new_user()` chặn đúng thiết kế, nhưng Supabase đôi khi che câu tiếng Việt gốc. Người đầu tiên của hệ thống thì vào được bằng email nào cũng được. |
| Đăng nhập được nhưng *chưa thuộc lớp nào* | Lớp chưa nhập danh sách nên chưa khớp được mã sinh viên trong email, hoặc cần quản trị lớp thêm bạn vào lớp. Nhập danh sách xong là tài khoản tự vào lớp. |
| Đăng nhập được nhưng không thấy nút thêm thu/chi | Tài khoản đang là *thành viên* của lớp. Nhờ quản trị lớp nâng lên *thủ quỹ* ở trang Thành viên & quyền. |
| Không thấy menu *Quản lý lớp* | Menu đó chỉ dành cho tài khoản gốc. Quản trị lớp không mở được lớp mới — đúng thiết kế. |
| Trang trắng sau khi deploy | Thiếu SPA fallback về `index.html`, hoặc chưa khai 2 biến môi trường ở nhà cung cấp hosting |

### Deploy

```bash
npm run build     # ra thư mục dist/
```

Đưa `dist/` lên Netlify / Vercel / Cloudflare Pages. Nhớ:
- khai `VITE_SUPABASE_URL` và `VITE_SUPABASE_ANON_KEY` trong phần environment variables,
- thêm domain thật vào *Redirect URLs* của Supabase (`https://…/reset-password`).

### SPA fallback — thiếu là ra 404

App là single-page: chỉ có đúng một file `index.html`, còn `/students`, `/login`… là đường
dẫn do router trong trình duyệt xử lý. Máy chủ tĩnh không biết điều đó, nên nếu không cấu
hình thì **mọi đường dẫn khác `/` đều trả 404**: bấm F5 giữa trang, mở link đã gửi cho sinh
viên, hay bấm Back sau một lần tải trang thật.

```
/            200
/students    404   ← không có file nào tên students
/login       404
```

Cấu hình đã đi kèm repo, không phải làm gì thêm:

| Host | File | Ghi chú |
|---|---|---|
| Vercel | `vercel.json` (có ở cả `app/` và gốc repo) | `rewrites` mọi đường dẫn về `/index.html` |
| Netlify · Cloudflare Pages | `app/public/_redirects` | Vite copy sang `dist/` khi build |
| Host khác | — | tự trả `index.html` cho mọi đường dẫn không khớp file |

**Vercel đọc `vercel.json` trong đúng "Root Directory" của project**, nên có hai bản: một ở
`app/` (khi Root Directory = `app`) và một ở gốc repo (khi để trống). Kiểm tra sau khi deploy:

```bash
curl -o /dev/null -w '%{http_code}\n' https://<domain>/students   # phải là 200, không phải 404
```

---

## Nhiều lớp, và ai quản lý cái gì

Một hệ thống chạy cho **nhiều lớp**. Mỗi lớp có quỹ, đợt thu, danh sách sinh viên, lịch sử thao
tác và **số tài khoản nhận chuyển khoản riêng** — không dùng chung gì cả.

Quyền chia làm hai tầng, và đây là chỗ dễ hiểu sai nhất nên nói rõ:

| Tầng | Ở đâu trong DB | Nghĩa |
|---|---|---|
| **Hệ thống** | `profiles.role = 'owner'` | Tài khoản gốc. Mở lớp và giao lớp cho người khác. |
| **Trong từng lớp** | `memberships(user_id, class_id, role)` | Vai trò chỉ có hiệu lực **trong đúng lớp đó**. |

Cách vận hành:

1. **Tài khoản gốc** (người đăng ký đầu tiên) mở lớp và chỉ định **một tài khoản quản trị** cho
   mỗi lớp. Nó không tham gia thu chi hằng ngày.
2. **Quản trị lớp** toàn quyền trong lớp được giao và **không thấy lớp nào khác**. Một người có
   thể được giao nhiều lớp; ở mỗi lớp vai trò tính riêng (thủ quỹ lớp A, thành viên lớp B).
3. Quản trị lớp tự thêm **thủ quỹ / thành viên** cho lớp mình.
4. **Sinh viên** tự đăng ký bằng email trường, tự vào đúng lớp có mã sinh viên đó.

| Vai trò | Làm được gì |
|---|---|
| **Khách** (chưa đăng nhập) | Chọn một lớp công khai và xem tổng thu / tổng chi / tồn quỹ từng quỹ, danh sách thu chi, tiến độ đợt thu, công nợ; **quét QR để chuyển khoản**. **Không** thấy ngày sinh, email, lịch sử thao tác, danh sách thành viên — và không ghi được gì. |
| **Thành viên** của lớp | Xem đầy đủ dữ liệu lớp mình + công nợ của chính mình + xuất Excel + xem QR của chính mình |
| **Thủ quỹ** của lớp | + thêm/sửa thu, chi, sinh viên, nhập danh sách lớp, xác nhận đã nhận chuyển khoản. Chỉ xoá được bản ghi **do chính mình tạo, trong 24 giờ** |
| **Quản trị lớp** | + đợt thu, cấu hình lớp và tài khoản nhận tiền, thêm/rút thành viên của lớp, phục hồi bản ghi đã xoá — **chỉ trong lớp của mình** |
| **Tài khoản gốc** | + mở lớp mới, giao quản trị cho từng lớp, xem mọi lớp (vai cứu hộ khi một lớp mất quản trị) |

Những việc **quản trị lớp cố tình không làm được**, chặn ngay ở tầng dữ liệu:

- mở lớp mới (`create_class` đòi `is_system_owner()`, và policy `classes_insert_owner` chặn cả
  việc chèn thẳng vào bảng),
- đọc hay sửa bất cứ gì của lớp khác,
- giao quyền ở lớp khác, hay chuyển một `membership` từ lớp mình sang lớp khác,
- tự đổi vai trò của chính mình, hay hạ nốt người quản trị cuối cùng của lớp.

Phân quyền được thực thi bằng **Row Level Security trong Postgres**, không phải bằng việc ẩn nút:
kể cả gọi API trực tiếp bằng anon key cũng không vượt qua được. `src/lib/permissions.ts` chỉ để
giao diện biết nút nào nên hiện, và phải luôn khớp với `supabase/migrations/0005_multiclass_rls.sql`
cùng `0006_root_governance.sql`.

---

## Thu tiền bằng QR

1. **Cài đặt → Tài khoản nhận chuyển khoản**: chọn ngân hàng (26 mã BIN Napas), số tài khoản,
   tên chủ tài khoản, mẫu nội dung (`{ma} {dot}` → `2400000001 QUY LOP HK1`).
2. **Đợt thu → “QR cả lớp”**: mỗi sinh viên còn nợ có một mã riêng, đã gắn sẵn **đúng số tiền
   còn thiếu** và nội dung chứa **mã SV**. In cả lớp một trang hoặc chụp từng ô gửi nhóm.
3. Sinh viên quét → chuyển khoản. Thủ quỹ đối chiếu sao kê rồi bấm **“Đã nhận được tiền”**;
   bản ghi được lưu với hình thức *Chuyển khoản* và ghi chú *Chuyển khoản QR*.

**Khách chưa đăng nhập cũng quét được QR** (`0009_guest_qr.sql`): người phải nộp tiền thường
không đăng nhập, nên chặn khách là chặn đúng người cần trả tiền. Vì thế view công khai công bố
luôn tài khoản **nhận** tiền của lớp — thứ thủ quỹ vẫn dán vào nhóm chat lớp. Ngoại lệ: lớp bật
**che tên sinh viên với khách** thì khách không tạo được mã, vì mã SV trong nội dung chuyển khoản
cũng bị che ⇒ tiền về sẽ không đối chiếu được với ai. Xác nhận đã nhận tiền vẫn là việc của thủ quỹ.

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
npm test              # 49 phép kiểm tra logic + smoke test mount App (vitest)
npm run build         # tsc strict + vite build
bash ../tests/db/run.sh   # 141 phép kiểm tra RLS/nghiệp vụ trên Postgres 17 thật (cần Docker)
```

E2E bằng Playwright — 59 phép kiểm tra × 3 cấu hình (desktop sáng, desktop tối, Pixel 7):

```bash
npx playwright install chromium     # một lần
npm run test:e2e                    # tự build và tự chạy server
npm run test:e2e:ui                 # chế độ có giao diện để soi từng bước
npm run test:all                    # build + vitest + e2e
```

E2E chạy trên bản build thật nhưng **Supabase bị giả lập hoàn toàn ở tầng network**
(`e2e/fixtures.ts`): phiên đăng nhập được bơm vào localStorage, mọi request `/rest/v1` bị
chặn và trả dữ liệu mẫu. Nhờ vậy test chạy offline, không phụ thuộc dữ liệu của ai, và
**kiểm tra được đúng những gì app gửi lên** — quỹ nào, số tiền nào, có cờ `overdraft` không,
`method` có phải `TRANSFER` không.

| Nhóm | Kiểm tra |
|---|---|
| `thu-chi.spec.ts` | Quỹ âm vì có người ứng tiền mua trước: tổng quan nói rõ đang âm bao nhiêu, khoản chi mang dấu ⚠ vượt quỹ, chi tiếp thì cảnh báo tính từ tồn quỹ âm · ghi thu/chi gửi lên đúng dữ liệu · chọn đợt Quỹ Đoàn thì quỹ đi theo đợt và bị khoá · cảnh báo nộp thừa · chi vượt tồn quỹ phải xác nhận rồi mới ghi kèm cờ vượt quỹ · thiếu người nộp/người mua thì không gửi gì lên · người thu chọn từ danh sách hoặc nhập tay |
| `quyen.spec.ts` | Khách xem được số liệu nhưng không có nút ghi chép, không thấy menu quản trị, không thấy cột ngày sinh, che tên khi bật công tắc · danh sách lớp đánh dấu thủ quỹ / quản trị lớp · thành viên chỉ xem QR của chính mình · thủ quỹ không tạo được đợt thu · quản trị tạo được |
| `qr.spec.ts` | Khách chưa đăng nhập cũng quét được QR và chuyển khoản (lớp bật che tên thì không, vì nội dung chuyển khoản sẽ vô danh) · QR mang đúng số còn thiếu, số tài khoản và mã SV · xác nhận đã nhận tiền ghi khoản thu dạng chuyển khoản · QR cả lớp đúng số người còn nợ |
| `dang-ky.spec.ts` | Đăng ký xong rồi bấm Back vẫn ở trong app và không có request nào ra máy chủ (phát hiện điều hướng bằng `window.location`, thứ chỉ nhìn URL sẽ không thấy) · mọi liên kết ở khu đăng nhập/đăng ký đều là điều hướng trong app |
| `giao-dien.spec.ts` | Đường dẫn tiếng Anh và link tiếng Việt cũ vẫn mở đúng trang (giữ cả hash của link đặt lại mật khẩu) · hộp thoại đúng tâm màn hình · mọi ô nhập cao bằng nhau · không cuộn ngang · Esc đóng hộp thoại · bảng có `<caption>` · đổi sáng/tối |
| `nhieu-lop.spec.ts` | Gắn tài khoản với sinh viên trong danh sách (bỏ gắn gửi `null`, không phải chuỗi rỗng) · quản trị lớp không thấy menu *Quản lý lớp* và vào thẳng URL cũng bị từ chối · mọi truy vấn số liệu đều kèm `class_id` của lớp đang xem · tài khoản gốc thấy mọi lớp, đổi lớp thì dữ liệu hỏi theo lớp mới · mở lớp mới gửi đúng `create_class` (email hạ chữ thường) · giao quản trị gửi đúng `grant_class_role` · chưa có lớp thì được dẫn đi mở lớp / được nói rõ vì sao chưa thấy gì |
| `mobile.spec.ts` | Khách thấy nút đăng nhập trên thanh tiêu đề · menu hamburger điều hướng được · không trang nào cuộn ngang · bảng cuộn trong khung riêng · hộp thoại vừa màn hình · form xếp một cột · vùng bấm ≥ 32px · mã QR ≥ 140px để quét được |

Soi giao diện bằng ảnh chụp thật, không cần Supabase:

```bash
npx playwright install chromium     # một lần
npm run build && npx vite preview --port 4173 &
npm run shot                        # ảnh vào screenshots/
```

`npm run shot` bơm một phiên đăng nhập giả và chặn network bằng dữ liệu mẫu, nên mở được cả
các hộp thoại chỉ dành cho thủ quỹ. Nó còn **đo** chiều cao từng loại control và độ lệch tâm
của hộp thoại — hai thứ từng sai mà đọc code không thấy: framer-motion ghi `transform` inline
làm hỏng cách căn giữa bằng `-translate-x/y-1/2`, và CSS chọn `input[type='text']` không khớp
`<input>` không có thuộc tính `type`.

Bộ DB dựng một Postgres sạch trong Docker, chạy cả 9 migration, rồi kiểm tra ma trận quyền của
mọi vai trò (kể cả `anon`), **cách ly dữ liệu giữa các lớp**, việc chỉ tài khoản gốc mở được lớp,
đẳng thức tồn quỹ, tách biệt hai quỹ, quy tắc xoá mềm, bảo vệ tài khoản, nội dung audit log và
RPC import. Đây là chỗ chứng minh phân quyền, chứ không phải giao diện.

---

## Đường dẫn

| Đường dẫn | Trang | Ai vào được |
|---|---|---|
| `/` | Tổng quan | mọi người, kể cả khách |
| `/students` | Danh sách lớp | mọi người |
| `/incomes` · `/expenses` | Thu · Chi | mọi người (ghi thì cần thủ quỹ) |
| `/periods` | Đợt thu | mọi người (tạo/sửa cần quản trị lớp) |
| `/import-export` | Nhập / Xuất Excel | thành viên trở lên |
| `/members` | Thành viên & quyền | quản trị lớp |
| `/audit-log` | Lịch sử thao tác | thủ quỹ trở lên |
| `/classes` | Quản lý lớp | tài khoản gốc |
| `/settings` · `/profile` | Cài đặt lớp · Tài khoản của tôi | đã đăng nhập |
| `/login` · `/signup` · `/forgot-password` · `/reset-password` | Đăng nhập / đăng ký / mật khẩu | — |

Đường dẫn tiếng Việt của các bản trước (`/lop`, `/thu`, `/chi`, `/dot-thu`, `/nhap-xuat`,
`/tai-khoan`, `/lich-su`, `/cai-dat`, `/lop-hoc`, `/toi`, `/dang-nhap`, `/dang-ky`,
`/quen-mat-khau`, `/doi-mat-khau`) vẫn tự chuyển sang đường dẫn mới, **giữ nguyên query và
hash** — link đặt lại mật khẩu đã gửi trong hộp thư vì thế vẫn dùng được.

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
