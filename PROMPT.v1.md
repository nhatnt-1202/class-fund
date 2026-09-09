# PROMPT: Hệ thống Quản lý Tài chính Lớp học (All-in-One, 1 file)

Bạn là senior frontend engineer. Hãy tạo cho tôi **một ứng dụng web quản lý thu – chi quỹ lớp, gói gọn trong DUY NHẤT MỘT FILE `index.html`** (HTML + CSS + JS inline, không build, không npm, mở bằng double-click là chạy được, chạy offline sau lần load đầu). Thư viện ngoài chỉ qua CDN: **SheetJS (xlsx)** cho import/export Excel và **qrcode-generator** để vẽ QR ngay trên máy. Không dùng framework nặng; vanilla JS là đủ.

Toàn bộ giao diện, nhãn, thông báo lỗi: **tiếng Việt**. Tiền tệ: **VND**, hiển thị dạng `1.250.000 ₫` (dấu chấm nhóm nghìn), nhập liệu cho phép gõ `50000` hoặc `50.000`. Ngày tháng: hiển thị `dd/MM/yyyy`, lưu nội bộ `YYYY-MM-DD`.

---

## 0. Nguyên tắc bất di bất dịch (quan trọng nhất)

1. **Hai quỹ tách biệt tuyệt đối**: `QUY_LOP` (Quỹ Lớp) và `QUY_DOAN` (Quỹ Đoàn). Mọi bản ghi thu và chi **bắt buộc** phải gắn đúng 1 quỹ. Không có bản ghi nào "chung", không có tổng nào trộn hai quỹ (trừ dòng "Tổng cộng cả 2 quỹ" được ghi nhãn rõ ràng).
2. **Không sửa số liệu ngầm**: mọi thay đổi số dư chỉ đến từ bản ghi Thu hoặc Chi. Không có ô "nhập tồn quỹ tay".
3. **Số học nguyên**: lưu tiền bằng **số nguyên VND** (không float, không chia 1000). Cấm tiền âm ở mức bản ghi.
4. **Công thức tồn quỹ** (tự tính lại mỗi lần render, không cache):
   `Tồn quỹ(quỹ X) = Σ Thu(quỹ X) − Σ Chi(quỹ X)`
5. Dữ liệu lưu ở `localStorage` (key `classFund.v1`), kèm nút **Sao lưu JSON / Phục hồi JSON** để không bao giờ mất dữ liệu khi đổi máy.
6. **Tiền chỉ vào quỹ khi có người xác nhận đã nhận**: sinh viên quét **QR chuyển khoản** rồi thủ quỹ bấm xác nhận, hoặc thủ quỹ thu tiền mặt và nhập tay. **Tuyệt đối không** lấy cột `Trạng thái` / `Số tiền` trong file Excel import để tự cộng vào quỹ — file Excel chỉ dùng để nhập **danh sách lớp**.

---

## 1. Mô hình dữ liệu (dùng đúng các field này)

```js
{
  meta: { className: "DCXDXD69_03B", faculty: "Xây dựng", schoolYear: "2026-2027",
          term: "Học kỳ I", version: 1, updatedAt: "ISO" },
  students: [{
    id: "uuid", stt: 1, code: "2400000001",   // Mã SV LUÔN là string
    lastName: "Trần Văn", firstName: "An", fullName: "Trần Văn Mẫu",
    dob: "2006-07-15", classCode: "DCXDXD69_03B",
    note: "", active: true
  }],
  periods: [{                                  // ĐỢT THU
    id: "uuid", name: "Quỹ lớp HK1 2026-2027",
    fund: "QUY_LOP", amountPerStudent: 50000,
    openDate: "2026-09-01", dueDate: "2026-09-30",
    status: "OPEN" | "CLOSED", note: ""
  }],
  incomes: [{                                  // 1 lần nộp tiền
    id: "uuid", date: "2026-09-05", fund: "QUY_LOP",
    periodId: "uuid|null",                     // null = thu ngoài đợt (VD tài trợ)
    studentId: "uuid|null",                    // null = thu từ nguồn khác
    payerName: "Trần Văn Mẫu",                 // hiển thị khi không phải SV
    amount: 50000, method: "CASH"|"TRANSFER",
    collectedBy: "Thủ quỹ", note: ""
  }],
  expenses: [{                                 // 1 lần chi
    id: "uuid", date: "2026-09-07", fund: "QUY_LOP",
    item: "Nước + bánh sinh hoạt lớp",         // Mua món gì
    category: "Sinh hoạt"|"Sự kiện"|"Văn phòng phẩm"|"Quà tặng"|"Khác",
    buyer: "Phạm Minh Ví",                    // AI đi mua (bắt buộc)
    amount: 120000, hasReceipt: true, note: ""
  }]
}
```

Ràng buộc: `incomes.fund` phải trùng `periods.fund` nếu có `periodId`. Xoá SV có bản ghi thu → chặn, chỉ cho `active=false`. Xoá đợt thu đã có bản ghi thu → chặn.

---

## 2. Màn hình & chức năng

### 2.1. Dashboard – Báo cáo tự động (mở file là thấy ngay)
- 3 nhóm thẻ số lớn, **tách theo quỹ**: cột **Quỹ Lớp**, cột **Quỹ Đoàn**, cột **Tổng cộng (2 quỹ)**; mỗi cột có: `Tổng thu`, `Tổng chi`, `Tồn quỹ hiện tại`.
- Thanh tiến độ thu theo từng đợt: `đã thu / phải thu`, số SV đã đóng / còn nợ, số tiền còn thiếu.
- Bảng **Top nợ**: SV nợ nhiều nhất, kèm liệt kê tên đợt còn thiếu.
- 5 khoản chi gần nhất + 5 khoản thu gần nhất.
- Bộ lọc thời gian toàn cục (Tất cả / Tháng này / Khoảng ngày tuỳ chọn) áp dụng cho Tổng thu–chi; **luôn hiển thị thêm dòng "Tồn quỹ luỹ kế (toàn thời gian)"** để tránh nhầm lẫn khi đang lọc.
- Không dùng biểu đồ nặng; nếu có, chỉ thanh ngang CSS.

### 2.2. Danh sách lớp
Bảng: STT, Mã SV, Họ và tên, Ngày sinh, Lớp, và **cột động cho từng đợt thu** (ô hiển thị `Đã đóng` / `Thiếu 20.000` / `Chưa đóng`, click vào ô để ghi nhận nộp nhanh), cột `Tổng đã nộp`, `Tổng còn nợ`.
- Tìm kiếm theo tên/mã SV (bỏ dấu vẫn tìm được: "tran van mau" khớp "Trần Văn Mẫu").
- Lọc: theo đợt, theo quỹ, chỉ SV còn nợ, chỉ SV đã đóng đủ.
- Thêm / sửa / ẩn SV; sắp xếp mọi cột; ghim hàng tiêu đề.

### 2.3. THU qua QR chuyển khoản (cách nộp chính)
Thủ quỹ cấu hình **một** tài khoản nhận tiền ở Cài đặt: ngân hàng (danh sách BIN Napas), số tài khoản, tên chủ tài khoản, và **mẫu nội dung chuyển khoản** với biến `{ma} {ten} {dot} {quy} {lop}`.
- App tự dựng **payload VietQR (Napas 247)** theo chuẩn EMVCo và **tự vẽ QR trên máy** — số tài khoản không được gửi ra dịch vụ ngoài nào. Cấu trúc: `00` phiên bản · `01` kiểu (`11` tĩnh / `12` có sẵn số tiền) · `38` thông tin thụ hưởng (GUID `A000000727` + BIN + số TK + `QRIBFTTA`) · `53` = `704` · `54` số tiền · `58` = `VN` · `62.08` nội dung · `63` **CRC16/CCITT-FALSE**.
- **QR riêng cho từng sinh viên, từng đợt**: đã gắn sẵn đúng số tiền còn phải nộp và nội dung có mã SV ⇒ không ai chuyển nhầm, thủ quỹ đối chiếu sao kê được ngay. Nội dung chuyển khoản phải **bỏ dấu, in hoa, ≤ 25 ký tự**.
- Chỗ nào mở được QR: bấm vào ô công nợ của sinh viên trong Danh sách lớp · nút QR ở mỗi hàng · chi tiết đợt thu · trong form thêm thu.
- **"QR cả lớp"** cho một đợt: lưới QR của mọi sinh viên còn nợ, kèm nút **In tất cả** (mở cửa sổ in riêng) để dán bảng hoặc chụp gửi nhóm lớp.
- Trong hộp thoại QR: sửa được số tiền (QR vẽ lại ngay), sao chép nội dung CK / số tài khoản, và 2 nút kết thúc: **"Đã nhận được tiền — ghi nhận thu"** (tạo bản ghi thu `method=TRANSFER`, ghi chú `Chuyển khoản QR`) hoặc **"Nộp tiền mặt…"** (mở form thu tay).
- Chưa cấu hình tài khoản thì mọi chỗ mở QR đều dẫn người dùng sang Cài đặt, không báo lỗi khô khan.

### 2.4. THU – "Add Thu" (thu tay / nguồn khác)
Form nhanh (modal): `Ngày` (mặc định hôm nay) · `Quỹ` (Lớp/Đoàn, **bắt buộc**) · `Đợt thu` (lọc theo quỹ đã chọn) · `Sinh viên` (combobox tìm theo tên/mã, hoặc chọn "Nguồn khác" rồi gõ tên người nộp) · `Số tiền` (mặc định = `amountPerStudent` của đợt, cho sửa để nộp thiếu/nộp bù) · `Hình thức` · `Người thu` · `Ghi chú`.
- **Thu theo lô**: chọn 1 đợt → tick nhiều SV → 1 cú click ghi nhận tất cả (mỗi SV 1 bản ghi riêng).
- Cảnh báo (không chặn) nếu tổng nộp của SV trong đợt vượt `amountPerStudent`.
- Bảng lịch sử thu: lọc theo quỹ / đợt / SV / khoảng ngày; sửa, xoá (xác nhận 2 bước).

### 2.5. CHI – "Add Chi" (nhật ký mua sắm)
Form: `Ngày` · `Quỹ` (rút từ Quỹ Lớp hay Quỹ Đoàn – **bắt buộc, hiển thị nổi bật**) · `Nội dung / Mua món gì` · `Danh mục` · `Người đi mua` (**bắt buộc**) · `Số tiền` · `Có hoá đơn?` · `Ghi chú`.
- **Cảnh báo vượt quỹ**: nếu số chi > tồn quỹ hiện tại của quỹ đó, hiện cảnh báo đỏ nêu rõ số tồn và số thiếu; vẫn cho lưu nếu người dùng xác nhận (thực tế có ứng trước), và bản ghi đó được đánh dấu ⚠ trong danh sách.
- Bảng nhật ký chi: mặc định sắp xếp mới → cũ; lọc theo quỹ / danh mục / người mua / khoảng ngày; hiển thị dòng tổng của kết quả đang lọc.

### 2.6. Quản lý đợt thu
CRUD đợt thu; đóng/mở đợt; nhân bản đợt cho học kỳ sau; xem chi tiết một đợt: danh sách đã đóng, chưa đóng, đóng thiếu, tổng thu thực tế / tổng dự kiến.

---

## 3. IMPORT danh sách lớp (bám đúng file thật)

File mẫu tham chiếu: `Danh sách đóng góp quỹ lớp DCXDXD69_03B (2).xlsx` — cấu trúc thật của nó như sau, parser **phải xử lý được đúng file này**:

- Chỉ có 1 sheet, tên `Trang tính1` (tên sheet không cố định → **không hard-code tên sheet**, mặc định lấy sheet đầu, nhưng cho phép người dùng chọn sheet khác).
- Dòng 1–9 là phần tiêu đề văn bản hành chính, KHÔNG phải dữ liệu:
  `BỘ GIÁO DỤC VÀ ĐÀO TẠO`, `TRƯỜNG ĐẠI HỌC MỎ - ĐỊA CHẤT`, `CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM`, `Hà Nội, ngày … năm 2026`, `DANH SÁCH ĐÓNG GÓP QUỸ LỚP HỌC KỲ I - NĂM HỌC 2026-2027`, `KHOA: XÂY DỰNG - LỚP: DCXDXD69_03B`.
  → **Tự dò dòng tiêu đề bảng** (quét 30 dòng đầu, tìm dòng chứa đồng thời `STT` và `Mã SV`/`Họ và tên`), không giả định header ở dòng 1.
  → Nếu bắt được các dòng tiêu đề trên thì **tự điền sẵn** `meta.className` (`DCXDXD69_03B`), `faculty`, `term`, `schoolYear` để người dùng chỉ cần xác nhận.
- Dòng tiêu đề bảng (dòng 10) gồm: `STT | Mã SV | Họ và tên SV | | Ngày sinh | Lớp | Trạng thái | Số tiền | Ngày | Mua | Phát sinh | Tổng tiền còn lại | Tiền thiếu`.
- **Ô `Họ và tên SV` bị merge 2 cột (C10:D10)**: họ + đệm ở cột C, tên ở cột D. → Nếu cột kế bên cột tên có dữ liệu chữ và không khớp header nào khác, phải **ghép `C + " " + D`** thành `fullName`, đồng thời giữ `lastName`/`firstName`. Chuẩn hoá: bỏ khoảng trắng kép, trim, giữ nguyên hoa/thường tiếng Việt.
- **Mã SV bị lưu dạng số** (`2400000001` đọc ra có thể thành `2.400000001E9` / `2400000001.0`). → Luôn ép về **string số nguyên, không dấu chấm thập phân, không ký hiệu khoa học**, giữ số 0 ở đầu nếu có.
- **Ngày sinh là serial date của Excel** (VD `38918`). → Đổi sang ngày thật theo hệ 1900 (có xử lý bug 1900 leap year của Excel), xuất `YYYY-MM-DD`. Nếu ô là chuỗi thì nhận cả `dd/MM/yyyy` và `d/M/yy`.
- **Cột `Trạng thái` có khoảng trắng ở cuối**: `"Đã đóng "`, `"Chưa đóng "`, hoặc trống. → trim + so sánh không phân biệt hoa thường/dấu. Hai cột `Trạng thái` và `Số tiền` **chỉ được hiển thị để đối chiếu**, **không** tạo bản ghi Thu (xem §0.6). Bước xem trước phải nói rõ điều này bằng chữ.
- **Dòng cuối là dòng tổng** (`Tổng quỹ :` … `1000000`, nằm cách bảng vài dòng trống). → Dừng đọc khi gặp dòng trống liên tiếp ≥ 2 hoặc gặp ô bắt đầu bằng `Tổng`/`Cộng`; **tuyệt đối không** biến dòng tổng thành sinh viên. Sau import, đối chiếu: "Tổng trong file: 1.000.000 ₫ / Tổng hệ thống tính được: … ₫" và cảnh báo nếu lệch.
- File mẫu có 49 SV (dòng 11–59) → thông báo kết quả phải nói rõ: `Đọc được 49 sinh viên`.

Yêu cầu chung cho luồng import:
1. Nhận `.xlsx`, `.xls`, `.csv` qua nút chọn file **và** kéo–thả.
2. **Bảng mapping cột**: hệ thống tự đoán (theo alias, bỏ dấu, không phân biệt hoa thường), người dùng có thể chỉnh lại từng cột qua dropdown. Alias tối thiểu:
   - `STT`: stt, số tt, no
   - `Mã SV`: ma sv, masv, mssv, mã sinh viên, student code
   - `Họ và tên`: ho va ten, ho ten, họ và tên sv, fullname, tên
   - `Ngày sinh`: ngay sinh, dob, ns
   - `Lớp`: lop, class, lớp
   - `Trạng thái`: trang thai, tình trạng
   - `Số tiền`: so tien, số tiền đã nộp, đã nộp
   - `Ngày (nộp)`: ngay, ngày nộp
   - `Ghi chú`: ghi chu, note, phát sinh
3. **Xem trước trước khi ghi**: bảng preview 20 dòng đầu + thống kê `hợp lệ / lỗi / trùng`, và **chỉ ghi vào dữ liệu khi bấm "Xác nhận import"**.
4. **Chống trùng**: khoá theo `Mã SV` (nếu thiếu mã thì theo `fullName + ngày sinh`). Cho chọn: `Bỏ qua dòng trùng` / `Cập nhật thông tin SV đã có` / `Thêm mới hết`.
5. Bỏ qua dòng rỗng, dòng chỉ có STT, dòng lặp lại header.
6. Import **chỉ** tạo/cập nhật sinh viên. Kết thúc phải hướng dẫn bước tiếp theo: tạo đợt thu → "QR cả lớp".
7. Kết thúc: hiện báo cáo `Thêm mới: n · Cập nhật: n · Bỏ qua: n · Lỗi: n (kèm số dòng và lý do)`, và nút **Hoàn tác lần import này** (undo toàn bộ batch vừa ghi).
8. Kèm nút **"Tải file mẫu import"** (xuất .xlsx đúng định dạng chuẩn) để lần sau nhập cho nhanh.

---

## 4. EXPORT Excel (nhiều sheet, 1 workbook)

Nút **Xuất Excel** với 3 phạm vi: **Tất cả** · **Theo khoảng ngày** (từ – đến) · **Theo một ngày cụ thể**; kèm bộ lọc tuỳ chọn theo quỹ (Cả hai / chỉ Quỹ Lớp / chỉ Quỹ Đoàn).

Workbook xuất ra phải có các sheet sau, **đúng thứ tự và đúng tên**:

1. **`Tong quan`** — Thông tin lớp, phạm vi xuất, ngày xuất; bảng 3 cột (Quỹ Lớp | Quỹ Đoàn | Tổng cộng) × 3 dòng (Tổng thu | Tổng chi | Tồn quỹ). Có thêm dòng "Tồn quỹ luỹ kế toàn thời gian" nếu đang xuất theo khoảng ngày.
2. **`Thu`** — Ngày, Quỹ, Đợt thu, Mã SV, Họ và tên, Số tiền, Hình thức, Người thu, Ghi chú. Dòng cuối: tổng, và tổng tách theo từng quỹ.
3. **`Chi`** — Ngày, Quỹ, Nội dung, Danh mục, Người đi mua, Số tiền, Có hoá đơn, Ghi chú. Dòng cuối: tổng + tổng theo quỹ.
4. **`Cong no`** — STT, Mã SV, Họ và tên, Lớp, và mỗi đợt thu 1 cột (số đã nộp), cột `Phải nộp`, `Đã nộp`, `Còn thiếu`, `Trạng thái`.
5. **`Ma tran dot thu`** — ma trận SV × đợt, ô ghi `Đã đóng` / `Thiếu x` / `Chưa đóng`.
6. **`Danh sach lop`** — dữ liệu SV thuần để tái import.
7. **`Nhat ky theo ngay`** — gộp thu & chi theo thứ tự thời gian: Ngày, Loại (Thu/Chi), Quỹ, Nội dung/Người nộp, Số tiền thu, Số tiền chi, Số dư luỹ kế của quỹ tương ứng.
8. **`QR chuyen khoan`** (chỉ khi đã cấu hình tài khoản) — Mã SV, Họ tên, Đợt thu, Quỹ, Còn phải nộp, Nội dung chuyển khoản, Ngân hàng, Số tài khoản, và **payload VietQR** dạng text; dùng để đối chiếu sao kê ngân hàng hoặc sinh QR ở chỗ khác.

Quy ước xuất:
- Tên file: `QuyLop_<MaLop>_<phamvi>_<yyyyMMdd-HHmm>.xlsx`, ví dụ `QuyLop_DCXDXD69_03B_20260901-20260930_20260909-1530.xlsx`.
- Cột tiền: ghi **số thật** (không phải chuỗi) + định dạng `#,##0` để Excel còn tính SUM được; cột ngày ghi dạng ngày thật.
- Có freeze dòng tiêu đề, độ rộng cột tự tính theo nội dung, header in đậm.
- Nếu phạm vi lọc ra 0 bản ghi: vẫn xuất sheet có header + dòng "Không có dữ liệu trong khoảng đã chọn".
- Thêm nút **Xuất PDF / In báo cáo** dùng `window.print()` với CSS `@media print` gọn gàng (tuỳ chọn, làm sau cùng).

---

## 5. Giao diện & UX
- Layout: sidebar (hoặc tab ngang) 6 mục: `Tổng quan` · `Danh sách lớp` · `Thu` · `Chi` · `Đợt thu` · `Nhập/Xuất`.
- Sạch, mật độ cao, đọc được số nhanh: font số dạng tabular, tiền dương màu xanh dương/đen, chi màu đỏ nhạt, tồn quỹ in đậm to.
- **Màu định danh quỹ nhất quán toàn app**: Quỹ Lớp = một màu, Quỹ Đoàn = màu khác; badge quỹ xuất hiện trên MỌI dòng thu/chi. Không bao giờ để người dùng phải đoán tiền thuộc quỹ nào.
- Responsive: dùng được trên điện thoại (thủ quỹ ghi chi ngay lúc đi mua), bảng cuộn ngang trong khung riêng, thân trang không cuộn ngang.
- Hỗ trợ dark mode theo `prefers-color-scheme`.
- Toast thông báo, modal xác nhận cho hành động xoá, phím tắt: `T` = thêm thu, `C` = thêm chi, `/` = focus tìm kiếm, `Esc` = đóng modal.
- Có **Undo** cho lần xoá gần nhất.

## 6. Chất lượng & kiểm thử (bắt buộc kèm theo)
Trong file, thêm một mục **"Tự kiểm tra"** (ẩn sau nút Debug) chạy các test nhỏ và in kết quả pass/fail:
1. `Tồn quỹ = Thu − Chi` đúng cho từng quỹ, sau chuỗi thao tác thêm/sửa/xoá.
2. Thu vào Quỹ Đoàn **không** làm thay đổi tồn Quỹ Lớp (và ngược lại).
3. Parse `2.400000001E9` → `"2400000001"`.
4. Quy đổi serial Excel (hệ 1900, gốc `1899-12-30`): `38918` → **2006-07-20**, `38873` → **2006-06-05**, `38399` → **2005-02-16**. Mọi ngày sinh sau khi quy đổi phải nằm trong khoảng 2000–2010; nếu lệch ra ngoài thì cảnh báo dòng đó thay vì ghi bừa.
5. Import file mẫu → đúng **49** sinh viên, không có dòng "Tổng quỹ".
6. Import 2 lần cùng file với chế độ "Bỏ qua trùng" → vẫn 49 SV.
7. Export theo 1 ngày cụ thể chỉ chứa bản ghi của ngày đó.
8. Tổng cột `Còn thiếu` = `Σ(số SV × mức thu mỗi đợt) − Σ đã nộp` cho từng quỹ.
9. `crc16('123456789') === '29B1'` (test vector chuẩn của CRC16/CCITT-FALSE).
10. Payload VietQR: bóc TLV ra phải đúng `01=12`, `53=704`, `54=<số tiền>`, `58=VN`, BIN và số TK đúng, `QRIBFTTA` có mặt, và 4 ký tự CRC cuối khớp với `crc16(payload_không_gồm_CRC)`.
11. QR không có số tiền ⇒ `01=11` và **không** có trường `54`. Chưa cấu hình tài khoản ⇒ `buildVietQR()` trả chuỗi rỗng.
12. Import file mẫu (có 22 dòng ghi 50.000 ở cột Số tiền) ⇒ **0 khoản thu** được tạo, tồn quỹ vẫn bằng 0.

## 7. Bàn giao
- Xuất ra **1 file `index.html`** duy nhất, chạy được ngay, có sẵn dữ liệu demo nhỏ (2 đợt thu, 3 SV, 2 khoản chi) kèm nút **"Xoá dữ liệu demo"**.
- Đầu file có comment block: mô tả kiến trúc, sơ đồ dữ liệu, chỗ cần sửa khi muốn thêm quỹ thứ 3.
- Code chia rõ khối: `STATE / STORAGE / UTILS / IMPORT / EXPORT / RENDER / EVENTS`, hàm ngắn, tên tiếng Anh, comment tiếng Việt ở các chỗ nghiệp vụ dễ sai (quy đổi ngày Excel, tách quỹ, tính công nợ).
