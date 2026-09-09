/**
 * 0009 — Khách cũng quét được QR và chuyển khoản
 * =============================================
 * Người phải nộp tiền thường KHÔNG đăng nhập: họ mở link lớp, tìm dòng của mình, quét mã,
 * chuyển khoản. Trước 0009, view công khai chỉ nói "lớp này đã cấu hình QR hay chưa" nên
 * khách không sinh được mã — mã QR VietQR bắt buộc phải có mã ngân hàng và số tài khoản.
 *
 * Vì thế view công khai giờ công bố luôn tài khoản NHẬN tiền của lớp. Đây là chủ ý, không
 * phải rò rỉ: số tài khoản nhận tiền là thứ thủ quỹ vẫn dán vào nhóm chat lớp, biết nó chỉ
 * giúp chuyển tiền VÀO quỹ. Những thứ thật sự riêng tư vẫn nằm ngoài view: ngày sinh, email,
 * lịch sử thao tác, danh sách thành viên và mọi bảng gốc.
 *
 * Mã QR vẫn được vẽ ngay trên máy người dùng, không đi qua dịch vụ sinh QR nào.
 */
create or replace view v_classes_public with (security_invoker = false) as
select c.id as class_id, c.code, c.name, c.faculty, c.term, c.school_year,
       c.hide_student_names_from_guest,
       (btrim(c.bank_bin) <> '' and btrim(c.account_no) <> '') as bank_configured,
       (select count(*) from students s where s.class_id = c.id and s.deleted_at is null and s.is_active) as student_count,
       -- Tài khoản nhận tiền: đủ để khách tự sinh mã QR chuyển khoản
       c.bank_bin, c.bank_name, c.account_no, c.account_name, c.note_template
from classes c where c.is_active;

comment on view v_classes_public is
  'Thông tin lớp cho khách chưa đăng nhập, gồm tài khoản NHẬN tiền để khách tự sinh QR. '
  'Không có ngày sinh, email, thành viên hay lịch sử thao tác.';

grant select on v_classes_public to anon, authenticated;
