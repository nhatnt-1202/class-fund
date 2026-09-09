import { describe, expect, it } from 'vitest';
import { can } from './permissions';
import type { UiRole } from '@/types/db';

const ALL: UiRole[] = ['guest', 'member', 'treasurer', 'admin', 'owner'];

describe('ma trận quyền của giao diện', () => {
  it('khách xem báo cáo và quét được QR để chuyển khoản, nhưng không ghi được gì', () => {
    expect(can.viewReports('guest')).toBe(true);
    expect(can.viewStudentDob('guest')).toBe(false);
    expect(can.exportExcel('guest')).toBe(false);
    expect(can.writeIncome('guest')).toBe(false);
    expect(can.viewAudit('guest')).toBe(false);
    // Người phải nộp tiền thường không đăng nhập ⇒ khách phải quét được QR
    expect(can.showQr('guest')).toBe(true);
    expect(can.showQrFor('guest', null, 's1', true)).toBe(true);
    // …nhưng tiền chỉ vào quỹ khi thủ quỹ xác nhận
    expect(can.confirmTransfer('guest')).toBe(false);
  });

  it('lớp bật che tên thì khách không tạo được QR (nội dung chuyển khoản sẽ vô danh)', () => {
    expect(can.showQrFor('guest', null, 's1', false)).toBe(false);
    // cờ này không nới quyền cho người đã đăng nhập: thành viên vẫn chỉ xem QR của mình
    expect(can.showQrFor('member', 's2', 's1', true)).toBe(false);
    expect(can.showQrFor('member', 's1', 's1', false)).toBe(true);
    expect(can.showQrFor('treasurer', null, 's1', false)).toBe(true);
  });

  it('thành viên đọc được nhưng không ghi', () => {
    expect(can.exportExcel('member')).toBe(true);
    expect(can.writeIncome('member')).toBe(false);
    expect(can.writeExpense('member')).toBe(false);
    expect(can.viewAudit('member')).toBe(false);
  });

  it('thủ quỹ ghi thu chi nhưng không quản lý đợt thu hay tài khoản', () => {
    expect(can.writeIncome('treasurer')).toBe(true);
    expect(can.confirmTransfer('treasurer')).toBe(true);
    expect(can.importStudents('treasurer')).toBe(true);
    expect(can.writePeriod('treasurer')).toBe(false);
    expect(can.manageUsers('treasurer')).toBe(false);
    expect(can.restoreRecords('treasurer')).toBe(false);
    expect(can.viewAudit('treasurer')).toBe(true);
  });

  it('quản trị làm được mọi việc nghiệp vụ, trừ cấp quyền chủ sở hữu', () => {
    expect(can.writePeriod('admin')).toBe(true);
    expect(can.manageUsers('admin')).toBe(true);
    expect(can.restoreRecords('admin')).toBe(true);
    expect(can.grantOwner('admin')).toBe(false);
    expect(can.grantOwner('owner')).toBe(true);
  });

  it('chỉ tài khoản gốc mở lớp; quản trị lớp chỉ quản lý trong lớp mình', () => {
    // Nếu quản trị lớp (hay thấp hơn) mở được lớp thì ai cũng tự lập lớp giả rồi tự làm chủ
    expect(can.createClass('admin')).toBe(false);
    expect(can.createClass('treasurer')).toBe(false);
    expect(can.createClass('member')).toBe(false);
    expect(can.createClass('guest')).toBe(false);
    expect(can.createClass('owner')).toBe(true);
    expect(can.manageClasses('admin')).toBe(false);
    expect(can.manageClasses('owner')).toBe(true);
    // nhưng quản trị lớp vẫn tự quản thành viên và cấu hình LỚP CỦA MÌNH
    expect(can.manageUsers('admin')).toBe(true);
    expect(can.editSettings('admin')).toBe(true);
  });

  it('thành viên chỉ xem được QR của chính mình', () => {
    expect(can.showQrFor('member', 's1', 's1')).toBe(true);
    expect(can.showQrFor('member', 's1', 's2')).toBe(false);
    expect(can.showQrFor('member', null, 's1')).toBe(false);
    // không truyền cờ ⇒ mặc định đóng với khách (fail closed)
    expect(can.showQrFor('guest', 's1', 's1')).toBe(false);
    // thủ quỹ trở lên xem được của mọi người vì chính họ đi thu
    expect(can.showQrFor('treasurer', null, 's2')).toBe(true);
    expect(can.showQrFor('admin', null, 's2')).toBe(true);
  });

  it('quyền chỉ tăng theo vai trò, không có ngoại lệ ngược', () => {
    // showQrFor có tham số riêng nên kiểm tra ở phép trên, không đưa vào vòng lặp này
    const simple = (Object.keys(can) as Array<keyof typeof can>).filter((k) => k !== 'showQrFor');
    for (const key of simple) {
      const fn = can[key] as (r: UiRole) => boolean;
      const results = ALL.map((r) => fn(r));
      const firstTrue = results.indexOf(true);
      if (firstTrue >= 0) {
        expect(results.slice(firstTrue).every(Boolean)).toBe(true);
      }
    }
  });
});
