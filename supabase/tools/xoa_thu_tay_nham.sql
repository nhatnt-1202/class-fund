-- =====================================================================================
-- XOÁ KHOẢN "THU TAY" BẤM NHẦM
-- =====================================================================================
-- Dùng khi bấm nhầm nút "Thu tay" nhiều lần cho cùng một sinh viên trong cùng một đợt,
-- làm sinh viên đó đóng thừa và tồn quỹ bị đội lên.
--
-- Xoá ở đây là XOÁ MỀM (deleted_at = now()) — đúng như nút thùng rác trong app:
-- bản ghi biến khỏi mọi con số nhưng vẫn còn trong lịch sử thao tác và phục hồi được.
--
-- Cách dùng: Supabase Dashboard → SQL Editor → New query → dán TỪNG BƯỚC → Run.
-- Chạy ở SQL Editor là chạy với quyền hệ thống nên bỏ qua giới hạn "thủ quỹ chỉ xoá
-- được bản ghi của mình trong 24h" — vì vậy đọc kỹ bước 1 và 2 trước khi xoá.
-- =====================================================================================


-- =====================================================================================
-- BƯỚC 1 — XEM AI ĐANG ĐÓNG THỪA (chỉ đọc, không đổi gì)
-- =====================================================================================
select c.name                  as lop,
       d.period_name           as dot_thu,
       d.code                  as ma_sv,
       d.full_name             as ho_ten,
       d.must_pay              as phai_dong,
       d.paid                  as da_dong,
       d.paid - d.must_pay     as dong_thua
from v_student_debt d
join classes c on c.id = d.class_id
where d.paid > d.must_pay
order by c.name, d.period_name, d.code;


-- =====================================================================================
-- BƯỚC 2 — XEM TỪNG KHOẢN THU CỦA NHỮNG NGƯỜI ĐÓNG THỪA ĐÓ
-- =====================================================================================
-- Cột stt_trong_nhom: 1 là khoản ghi sớm nhất (thường là khoản ĐÚNG),
-- từ 2 trở đi là các lần bấm sau — nhiều khả năng là bấm nhầm.
select i.id                                as id_khoan_thu,   -- copy id ở đây để dùng ở bước 3
       row_number() over (partition by i.student_id, i.period_id order by i.created_at)
                                           as stt_trong_nhom,
       c.name                              as lop,
       p.name                              as dot_thu,
       s.code                              as ma_sv,
       s.full_name                         as ho_ten,
       i.amount                            as so_tien,
       i.method                            as hinh_thuc,
       i.date                              as ngay,
       i.created_at                        as luc_ghi,
       i.collected_by                      as nguoi_thu,
       i.note                              as ghi_chu
from incomes i
join students s on s.id = i.student_id
join periods  p on p.id = i.period_id
join classes  c on c.id = i.class_id
where i.deleted_at is null
  and exists (
    select 1 from v_student_debt d
    where d.student_id = i.student_id and d.period_id = i.period_id
      and d.paid > d.must_pay
  )
order by c.name, p.name, s.code, i.created_at;


-- =====================================================================================
-- BƯỚC 3 — XOÁ ĐÍCH DANH (cách an toàn nhất, nên dùng)
-- =====================================================================================
-- Dán id lấy ở bước 2 vào danh sách dưới đây rồi Run. Thêm bao nhiêu id cũng được.
begin;

update incomes
set deleted_at = now()
where deleted_at is null
  and id in (
    '00000000-0000-0000-0000-000000000000',   -- ⬅ thay bằng id thật
    '00000000-0000-0000-0000-000000000001'    -- ⬅ thêm / bớt dòng tuỳ ý
  )
returning id, student_id, period_id, amount, method, date;

-- Xem kết quả trả về ở trên: đúng số khoản, đúng số tiền thì mới commit.
-- Sai thì gõ rollback; thay cho commit;
commit;


-- =====================================================================================
-- BƯỚC 3B — XOÁ TỰ ĐỘNG PHẦN THU VƯỢT QUÁ (tuỳ chọn, nên chạy trước 3C)
-- =====================================================================================
-- Chỉ nhắm vào những sinh viên đang ĐÓNG THỪA ở bước 1, và trong đó chỉ xoá dòng nào
-- mà CÁC DÒNG GHI TRƯỚC NÓ ĐÃ PHỦ ĐỦ số phải đóng — dòng đó chắc chắn là thừa.
-- Nhờ vậy xoá xong không ai tụt xuống dưới mức phải đóng.
-- Chỉ đụng tiền mặt (CASH); chuyển khoản không bị đụng vì đó là tiền thật đã về tài khoản.
--
-- Trường hợp KHÔNG được khối này xử lý (cố ý để lại cho người xem quyết định):
--   phải đóng 100k, ghi 60k rồi 60k → thừa 20k nhưng không dòng nào "chắc chắn thừa",
--   có thể là gõ nhầm số tiền chứ không phải bấm nhầm. Xử lý tay ở bước 3.

-- 3B.1 — Xem trước sẽ xoá những gì (chỉ đọc):
with xep as (
  select i.id, i.student_id, i.period_id, i.amount, i.method, i.date, i.created_at,
         d.must_pay, d.paid,
         coalesce(sum(i.amount) over (partition by i.student_id, i.period_id
                                      order by i.created_at
                                      rows between unbounded preceding and 1 preceding), 0)
           as da_ghi_truoc_do
  from incomes i
  join v_student_debt d on d.student_id = i.student_id and d.period_id = i.period_id
  where i.deleted_at is null and d.paid > d.must_pay
)
select x.id            as se_xoa,
       c.name          as lop,
       p.name          as dot_thu,
       s.code          as ma_sv,
       s.full_name     as ho_ten,
       x.must_pay      as phai_dong,
       x.paid          as da_dong,
       x.da_ghi_truoc_do as cac_dong_truoc_da_ghi,
       x.amount        as so_tien_dong_nay,
       x.date          as ngay,
       x.created_at    as luc_ghi
from xep x
join students s on s.id = x.student_id
join periods  p on p.id = x.period_id
join classes  c on c.id = s.class_id
where x.da_ghi_truoc_do >= x.must_pay and x.method = 'CASH'
order by c.name, p.name, s.code, x.created_at;

-- 3B.2 — Nếu danh sách trên đúng ý thì chạy khối này để xoá:
begin;

with xep as (
  select i.id, i.student_id, i.period_id, i.amount, i.method,
         d.must_pay,
         coalesce(sum(i.amount) over (partition by i.student_id, i.period_id
                                      order by i.created_at
                                      rows between unbounded preceding and 1 preceding), 0)
           as da_ghi_truoc_do
  from incomes i
  join v_student_debt d on d.student_id = i.student_id and d.period_id = i.period_id
  where i.deleted_at is null and d.paid > d.must_pay
),
thua as (
  select id from xep where da_ghi_truoc_do >= must_pay and method = 'CASH'
)
update incomes i
set deleted_at = now()
from thua t
where t.id = i.id
returning i.id, i.student_id, i.period_id, i.amount, i.date;

-- Soi dòng returning ở trên rồi mới commit; sai thì gõ rollback;
commit;


-- =====================================================================================
-- BƯỚC 3C — XOÁ TỰ ĐỘNG CÁC BẢN GHI TRÙNG HỆT NHAU (bắt cả trường hợp không thừa)
-- =====================================================================================
-- Chỉ đụng vào các khoản thu tiền mặt TRÙNG HỆT: cùng sinh viên, cùng đợt, cùng số tiền,
-- cùng ngày — tức đúng dấu hiệu bấm nhầm nút "Thu tay" mấy lần liền.
-- Giữ lại khoản ghi SỚM NHẤT trong mỗi nhóm, xoá mềm các khoản còn lại.
-- Chuyển khoản (TRANSFER) không bị đụng tới vì đó là tiền thật đã về tài khoản.

-- 3C.1 — Xem trước sẽ xoá những gì (chỉ đọc):
with trung as (
  select i.id, i.student_id, i.period_id, i.amount, i.date, i.created_at,
         row_number() over (partition by i.student_id, i.period_id, i.amount, i.date
                            order by i.created_at) as stt
  from incomes i
  where i.deleted_at is null and i.method = 'CASH'
    and i.student_id is not null and i.period_id is not null
)
select t.id as se_xoa, c.name as lop, p.name as dot_thu, s.code as ma_sv, s.full_name as ho_ten,
       t.amount as so_tien, t.date as ngay, t.created_at as luc_ghi, t.stt as lan_bam_thu
from trung t
join students s on s.id = t.student_id
join periods  p on p.id = t.period_id
join classes  c on c.id = s.class_id
where t.stt > 1
order by c.name, p.name, s.code, t.created_at;

-- 3C.2 — Nếu danh sách trên đúng ý thì chạy khối này để xoá:
begin;

with trung as (
  select i.id,
         row_number() over (partition by i.student_id, i.period_id, i.amount, i.date
                            order by i.created_at) as stt
  from incomes i
  where i.deleted_at is null and i.method = 'CASH'
    and i.student_id is not null and i.period_id is not null
)
update incomes i
set deleted_at = now()
from trung t
where t.id = i.id and t.stt > 1
returning i.id, i.student_id, i.period_id, i.amount, i.date;

commit;


-- =====================================================================================
-- BƯỚC 4 — KIỂM TRA LẠI
-- =====================================================================================
-- Không còn ai đóng thừa thì câu này không trả về dòng nào.
select c.name as lop, d.period_name as dot_thu, d.code as ma_sv,
       d.must_pay as phai_dong, d.paid as da_dong, d.paid - d.must_pay as dong_thua
from v_student_debt d
join classes c on c.id = d.class_id
where d.paid > d.must_pay
order by c.name, d.period_name, d.code;

-- Tồn quỹ sau khi dọn
select c.name as lop, b.fund as quy, b.total_income as tong_thu,
       b.total_expense as tong_chi, b.balance as ton_quy
from v_fund_balance b
join classes c on c.id = b.class_id
order by c.name, b.fund;


-- =====================================================================================
-- LỠ XOÁ NHẦM — PHỤC HỒI
-- =====================================================================================
-- Xem các khoản vừa xoá trong 1 giờ qua:
select i.id, s.code, s.full_name, p.name as dot_thu, i.amount, i.date, i.deleted_at
from incomes i
left join students s on s.id = i.student_id
left join periods  p on p.id = i.period_id
where i.deleted_at > now() - interval '1 hour'
order by i.deleted_at desc;

-- Phục hồi đích danh:
-- update incomes set deleted_at = null where id in ('...');
