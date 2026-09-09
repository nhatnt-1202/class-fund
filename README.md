# Quỹ Lớp — Quản lý thu chi lớp học

Công cụ quản lý tài chính lớp học **rành mạch đến từng đồng**: theo dõi ai đã nộp / ai còn nợ,
ghi nhật ký mua sắm, và luôn có bảng tổng kết tự động cho **từng quỹ riêng biệt**.

Bản này là **all-in-one một file**: `index.html`. Không cài đặt, không npm, không server.
Mở bằng double-click là chạy.

---

## Dùng ngay

```bash
xdg-open index.html          # Linux
# hoặc kéo file index.html vào trình duyệt
```

Lần mở đầu tiên cần internet để tải 2 thư viện từ CDN (SheetJS đọc/ghi Excel, qrcode-generator vẽ QR);
sau đó trình duyệt cache lại và dùng offline được.

Dữ liệu nằm trong `localStorage` của **chính trình duyệt đó**. Xoá cache hoặc đổi máy là mất
⇒ vào **Nhập / Xuất → Tải sao lưu JSON** định kỳ.

---

## Ba việc app làm

**1. Nguồn thu — đa quỹ, đa đợt**
- Hai quỹ tách biệt tuyệt đối: **Quỹ Lớp** và **Quỹ Đoàn**. Mọi bản ghi bắt buộc gắn đúng một quỹ,
  có badge màu riêng ở mọi dòng nên không bao giờ phải đoán tiền thuộc quỹ nào.
- Nhiều **đợt thu** theo thời gian (tên, mức thu/SV, quỹ, ngày mở, hạn nộp, đóng/mở đợt, nhân bản cho kỳ sau).
- Bảng danh sách lớp có một cột cho mỗi đợt: `Đã đóng` / `Thiếu 20.000` / `Chưa đóng`, kèm tổng đã nộp và còn nợ.

**2. Nguồn chi — nhật ký mua sắm**
- Mỗi khoản chi ghi rõ: ngày, **rút từ quỹ nào**, mua món gì, danh mục, **ai đi mua**, có hoá đơn hay không.
- Chi vượt tồn quỹ thì cảnh báo và hỏi xác nhận, ghi nhận xong sẽ đánh dấu **⚠ vượt quỹ** — không âm quỹ trong im lặng.

**3. Báo cáo tự động**
- Mở app là thấy ngay: Tổng thu · Tổng chi · **Tồn quỹ** cho từng quỹ và cột tổng cộng.
- Tồn quỹ **luôn được tính lại từ bản ghi** (`Tồn = Σ Thu − Σ Chi`), không có ô nhập tay
  ⇒ số liệu không thể bị sửa ngầm.
- Khi đang lọc theo thời gian, app vẫn hiện thêm dòng **“Tồn quỹ luỹ kế toàn thời gian”** để không ai hiểu nhầm.

---

## Thu tiền bằng QR chuyển khoản

1. Vào **Cài đặt → Tài khoản nhận chuyển khoản**: chọn ngân hàng, nhập số tài khoản, tên chủ tài khoản,
   và mẫu nội dung chuyển khoản (mặc định `{ma} {dot}` → `2400000001 QUY LOP HOC KY I`).
2. Tạo **đợt thu** với mức thu mỗi sinh viên.
3. Vào **Đợt thu → “QR cả lớp”**: mỗi sinh viên còn nợ có một mã QR riêng, **đã gắn sẵn đúng số tiền
   và nội dung chứa mã SV**. In ra dán bảng, hoặc chụp từng ô gửi vào nhóm lớp.
4. Sinh viên quét bằng app ngân hàng → chuyển khoản. Thủ quỹ đối chiếu sao kê rồi bấm
   **“Đã nhận được tiền — ghi nhận thu”** (bản ghi được đánh `Chuyển khoản` + ghi chú `Chuyển khoản QR`).

Chi tiết kỹ thuật: app tự dựng payload **VietQR (Napas 247)** theo chuẩn EMVCo và **tự vẽ QR ngay trên máy**
— số tài khoản không được gửi tới bất kỳ dịch vụ sinh QR bên ngoài nào. CRC dùng CRC16/CCITT-FALSE
(kiểm chứng bằng test vector `crc16('123456789') === '29B1'`).

> **Trước khi dùng thật, hãy tự quét thử một mã bằng app ngân hàng của bạn** để chắc chắn ngân hàng đó
> nhận đúng số tiền và nội dung. Payload được dựng theo đúng chuẩn công bố, nhưng chỉ có việc quét thử
> trên tài khoản thật mới xác nhận được từ đầu đến cuối.

---

## Nhập danh sách lớp từ Excel

Kéo file vào **Nhập / Xuất → Nhập danh sách lớp** (`.xlsx`, `.xls`, `.csv`). Parser xử lý sẵn các
đặc thù của file danh sách thật (đã kiểm thử trên `Danh sách đóng góp quỹ lớp DCXDXD69_03B`):

| Vấn đề của file thật | App xử lý |
|---|---|
| 9 dòng tiêu đề hành chính trước bảng | Tự dò dòng tiêu đề (tìm dòng có `STT` + `Mã SV`), và tự điền mã lớp / khoa / học kỳ / năm học |
| Ô “Họ và tên SV” bị merge 2 cột | Ghép cột họ đệm + cột tên, vẫn giữ riêng `lastName` / `firstName` |
| Mã SV lưu dạng số → `2.400000001E9` | Ép về chuỗi số nguyên `2400000001`, giữ số 0 đầu nếu có |
| Ngày sinh là serial Excel (`38918`) | Quy đổi hệ 1900 (gốc `1899-12-30`) → `20/07/2006`, khớp đúng cách Excel hiển thị |
| Dòng “Tổng quỹ : 1000000” cách bảng 4 dòng trống | Không biến thành sinh viên; vẫn đọc riêng để đối chiếu số liệu |

Có bảng **khớp cột** sửa được bằng tay, **xem trước 20 dòng** trước khi ghi, 3 chế độ chống trùng
(bỏ qua / cập nhật / thêm mới hết), tải file các **dòng lỗi**, và nút **Hoàn tác lần import**.

**Import chỉ tạo danh sách sinh viên.** Cột `Trạng thái` và `Số tiền` trong file chỉ để đối chiếu —
app không dùng chúng để cộng tiền vào quỹ. Tiền vào quỹ luôn phải qua QR chuyển khoản hoặc thu tay có người xác nhận.

---

## Xuất Excel

**Nhập / Xuất → Xuất Excel**, 3 phạm vi: *Tất cả* · *Theo khoảng ngày* · *Theo một ngày*, lọc thêm theo quỹ.
Một workbook gồm các sheet:

| Sheet | Nội dung |
|---|---|
| `Tong quan` | Tổng thu / tổng chi / tồn quỹ, **tách cột theo từng quỹ** + cột tổng cộng |
| `Thu` | Từng khoản thu, có dòng tổng và tổng theo từng quỹ |
| `Chi` | Nhật ký mua sắm, cột người đi mua, cột ⚠ vượt quỹ |
| `Cong no` | Mỗi đợt một cột + Phải nộp / Đã nộp / Còn thiếu / Trạng thái |
| `Ma tran dot thu` | Ma trận SV × đợt |
| `Danh sach lop` | Dữ liệu SV thuần, tái import được |
| `Nhat ky theo ngay` | Thu & chi theo thời gian + **số dư luỹ kế** của từng quỹ |
| `QR chuyen khoan` | Nội dung CK + payload VietQR từng SV còn nợ, để đối chiếu sao kê *(khi đã cấu hình tài khoản)* |

Cột tiền ghi **số thật** + định dạng `#,##0` (Excel `SUM` được); cột ngày là **ngày thật** (`dd/mm/yyyy`),
có autofilter và độ rộng cột tự tính. Tên file: `QuyLop_<MãLớp>_<phạmvi>_<yyyyMMdd-HHmm>.xlsx`.

---

## Kiểm thử

```bash
cd tests
npm install
npm test                 # hoặc: node run.js "/đường/dẫn/danh-sách-lớp.xlsx"
```

78 phép kiểm tra, 4 nhóm:

1. **Tính toán nghiệp vụ** — bộ tự kiểm tra dựng sẵn trong app (cũng chạy được từ
   **Cài đặt → Chạy tự kiểm tra**): đẳng thức tồn quỹ sau thêm/sửa/xoá, hai quỹ không ảnh hưởng nhau,
   quy đổi mã SV và ngày Excel, công nợ, payload VietQR, import không tạo khoản thu.
2. **Parser trên file Excel thật** — đối chiếu từng con số với file gốc (49 SV, dòng tiêu đề, dòng tổng…).
3. **Giao diện (jsdom)** — render 7 trang, mở 7 modal, luồng import đầy đủ, luồng QR đầy đủ,
   cảnh báo chi vượt quỹ, và **bắt mọi lỗi runtime**.
4. **Xuất Excel** — dựng workbook thật, đọc lại, kiểm tra kiểu ô, định dạng số/ngày, số liệu từng sheet.

---

## Cấu trúc code

Tất cả trong `index.html`, chia khối rõ (tìm theo mốc `====` trong `<script>`):

```
STATE     hằng số, state gốc, migrate
STORAGE   localStorage, sao lưu / phục hồi JSON
UTILS     tiền, ngày, bỏ dấu tiếng Việt, quy đổi serial Excel
QR        payload VietQR + vẽ QR
COMPUTE   tổng thu/chi/tồn quỹ, công nợ  ← nguồn sự thật duy nhất cho mọi con số
RENDER    7 trang
EVENTS    form, modal, phím tắt
IMPORT    đọc file Excel danh sách lớp
EXPORT    workbook nhiều sheet
SELFTEST  bộ tự kiểm tra
```

**Muốn thêm quỹ thứ 3?** Sửa duy nhất hằng số `FUNDS` ở đầu khối STATE và thêm 2 biến màu
`--fund-xxx` / `--fund-xxx-soft` trong `:root` + khối dark mode. Mọi chỗ khác đều lặp theo
`Object.keys(FUNDS)` nên tự chạy.

---

## Giao diện

- Font **Be Vietnam Pro** (thiết kế riêng cho tiếng Việt, dấu không bị đè) + **Lexend** cho tiêu đề;
  cỡ chữ gốc 16px, số tiền dùng `tabular-nums` nên các cột tiền thẳng hàng.
- Sáng / Tối / Theo hệ thống; **Chế độ dễ đọc** (chữ to hơn, giãn dòng, giãn chữ); 3 mức cỡ chữ.
- Animation lấy từ token thống nhất: chuyển trang, count-up số liệu, stagger hàng bảng, modal spring,
  toast có progress, flash hàng vừa thêm, shake khi lỗi. Tôn trọng `prefers-reduced-motion`
  và có công tắc **Giảm chuyển động**.
- Điều hướng bằng bàn phím, focus ring rõ, modal có focus trap + `Esc`, vùng bấm ≥ 44px, `aria-live` cho thay đổi động.
- Phím tắt: `T` thêm thu · `C` thêm chi · `/` tìm kiếm · `Esc` đóng hộp thoại.

---

## Giới hạn đã biết

- **Dữ liệu chỉ nằm trên một máy/một trình duyệt.** Không có tài khoản, không đồng bộ, ai mở file
  cũng sửa được. Cần nhiều người dùng + phân quyền + audit log thì xem `PROMPT.md`
  (bản Supabase + React đang là bước tiếp theo).
- **Header trong file Excel xuất ra không in đậm được**: bản community của SheetJS không ghi style ô.
  Bù lại đã có autofilter, độ rộng cột và định dạng số/ngày.
- **QR cần được quét thử với ngân hàng thật** trước khi dùng cho cả lớp (xem cảnh báo ở trên).
- Lần mở đầu tiên cần internet để tải SheetJS và qrcode-generator từ CDN.

---

## Tài liệu

- `PROMPT.v1.md` — đặc tả của chính bản này (all-in-one 1 file).
- `PROMPT.md` — đặc tả bản đầy đủ: Supabase + React, có tài khoản, phân quyền 5 vai trò, audit log.
