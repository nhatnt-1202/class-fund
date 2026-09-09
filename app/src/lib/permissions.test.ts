import { describe, expect, it } from 'vitest';
import { can } from './permissions';
import type { UiRole } from '@/types/db';

const ALL: UiRole[] = ['guest', 'member', 'treasurer', 'admin', 'owner'];

describe('ma trận quyền của giao diện', () => {
  it('khách chỉ xem báo cáo, không làm gì khác', () => {
    expect(can.viewReports('guest')).toBe(true);
    expect(can.viewStudentDob('guest')).toBe(false);
    expect(can.showQr('guest')).toBe(false);
    expect(can.exportExcel('guest')).toBe(false);
    expect(can.writeIncome('guest')).toBe(false);
    expect(can.viewAudit('guest')).toBe(false);
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

  it('quyền chỉ tăng theo vai trò, không có ngoại lệ ngược', () => {
    for (const key of Object.keys(can) as Array<keyof typeof can>) {
      const results = ALL.map((r) => can[key](r));
      const firstTrue = results.indexOf(true);
      if (firstTrue >= 0) {
        expect(results.slice(firstTrue).every(Boolean)).toBe(true);
      }
    }
  });
});
