/**
 * Ma trận quyền dùng cho GIAO DIỆN (ẩn/hiện nút).
 * Đây KHÔNG phải lớp bảo vệ: mọi quyền thật đều do RLS trong Postgres thực thi
 * (xem supabase/migrations/0003_rls.sql). Hai bên phải luôn khớp nhau.
 */
import type { UiRole } from '@/types/db';

const RANK: Record<UiRole, number> = { guest: 0, member: 1, treasurer: 2, admin: 3, owner: 4 };

export const atLeast = (role: UiRole, min: UiRole) => RANK[role] >= RANK[min];

export const can = {
  viewReports: (r: UiRole) => atLeast(r, 'guest'),
  viewStudentDob: (r: UiRole) => atLeast(r, 'member'),
  viewOwnDebt: (r: UiRole) => atLeast(r, 'member'),
  exportExcel: (r: UiRole) => atLeast(r, 'member'),
  writeIncome: (r: UiRole) => atLeast(r, 'treasurer'),
  writeExpense: (r: UiRole) => atLeast(r, 'treasurer'),
  writeStudent: (r: UiRole) => atLeast(r, 'treasurer'),
  importStudents: (r: UiRole) => atLeast(r, 'treasurer'),
  showQr: (r: UiRole) => atLeast(r, 'member'),
  /**
   * Thành viên chỉ được xem QR chuyển khoản CỦA CHÍNH MÌNH — QR mang số tiền và mã SV của
   * người khác thì không việc gì phải cho họ thấy. Thủ quỹ trở lên xem được của mọi người
   * vì chính họ đi thu.
   */
  showQrFor: (r: UiRole, myStudentId: string | null | undefined, studentId: string) =>
    atLeast(r, 'treasurer') || (r === 'member' && Boolean(myStudentId) && myStudentId === studentId),
  confirmTransfer: (r: UiRole) => atLeast(r, 'treasurer'),
  writePeriod: (r: UiRole) => atLeast(r, 'admin'),
  manageUsers: (r: UiRole) => atLeast(r, 'admin'),
  viewAudit: (r: UiRole) => atLeast(r, 'treasurer'),
  restoreRecords: (r: UiRole) => atLeast(r, 'admin'),
  editSettings: (r: UiRole) => atLeast(r, 'admin'),
  grantOwner: (r: UiRole) => atLeast(r, 'owner'),
};

/** Thông báo khi người dùng chạm vào chỗ vượt quyền — nói rõ cần vai trò nào. */
export function needRoleMessage(min: UiRole): string {
  const label: Record<UiRole, string> = {
    guest: 'khách', member: 'thành viên', treasurer: 'thủ quỹ',
    admin: 'quản trị', owner: 'chủ sở hữu',
  };
  return `Việc này cần quyền ${label[min]} trở lên. Hãy nhờ quản trị lớp cấp quyền cho bạn.`;
}
