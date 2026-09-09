-- =====================================================================================
-- seed.sql — dữ liệu mẫu để xem giao diện ngay sau khi dựng DB.
-- Chạy sau khi đã có ít nhất 1 tài khoản (người đăng ký đầu tiên là chủ sở hữu).
-- Trên Supabase: SQL Editor → dán file này → Run.
-- =====================================================================================
update class_settings set
  class_name = 'DCXDXD69_03B', faculty = 'Xây dựng', term = 'Học kỳ I', school_year = '2026-2027',
  bank_bin = '970436', bank_name = 'Vietcombank', account_no = '1021234567',
  account_name = 'NGUYEN VAN THU QUY', note_template = '{ma} {dot}'
where id = 1;

insert into students (stt, code, last_name, first_name, dob, class_code) values
  (1, '2400000001', 'Trần Văn',  'Mẫu',  '2005-01-15', 'DCXDXD69_03B'),
  (2, '2400000002', 'Lê Thị',    'Thử', '2005-02-20', 'DCXDXD69_03B'),
  (3, '2400000003', 'Phạm Minh', 'Ví', '2005-03-25', 'DCXDXD69_03B')
on conflict do nothing;

insert into periods (name, fund, amount_per_student, open_date, due_date) values
  ('Quỹ lớp học kỳ I 2026-2027',  'QUY_LOP',  50000, '2026-09-01', '2026-09-30'),
  ('Quỹ Đoàn học kỳ I 2026-2027', 'QUY_DOAN', 20000, '2026-09-01', '2026-10-15')
on conflict do nothing;

insert into incomes (date, fund, period_id, student_id, payer_name, amount, method, collected_by, note)
select '2026-09-03', 'QUY_LOP', p.id, s.id, s.full_name, 50000, 'TRANSFER', 'Thủ quỹ', 'Chuyển khoản QR'
from periods p, students s where p.fund = 'QUY_LOP' and s.code = '2400000001';

insert into incomes (date, fund, period_id, student_id, payer_name, amount, method, collected_by, note)
select '2026-09-03', 'QUY_LOP', p.id, s.id, s.full_name, 30000, 'CASH', 'Thủ quỹ', 'Nộp thiếu 20.000'
from periods p, students s where p.fund = 'QUY_LOP' and s.code = '2400000002';

insert into expenses (date, fund, item, category, buyer, amount, has_receipt) values
  ('2026-09-05', 'QUY_LOP',  'Nước + bánh sinh hoạt lớp', 'Sinh hoạt', 'Phạm Minh Ví', 120000, false),
  ('2026-09-06', 'QUY_DOAN', 'In giấy khen chi đoàn',     'In ấn',     'Trần Văn Mẫu',   15000, true);
