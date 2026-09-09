/**
 * Ma trận quyền dùng cho GIAO DIỆN (ẩn/hiện nút), xét TRONG LỚP đang xem.
 * Đây KHÔNG phải lớp bảo vệ: mọi quyền thật đều do RLS trong Postgres thực thi
 * (xem supabase/migrations/0005_multiclass_rls.sql). Hai bên phải luôn khớp nhau.
 *
 * 'owner' là tài khoản gốc của hệ thống: coi như quản trị của MỌI lớp, và là người duy nhất
 * mở lớp mới + chỉ định quản trị cho từng lớp. Quản trị lớp thì chỉ trong lớp được giao.
 */
import type { UiRole } from '@/types/db';

const RANK: Record<UiRole, number> = { guest: 0, member: 1, treasurer: 2, admin: 3, owner: 4 };

/** Chủ sở hữu hệ thống hành xử như quản trị lớp ở mọi lớp. */
export const isClassAdmin = (r: UiRole) => r === 'admin' || r === 'owner';

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
  /**
   * Chỉ tài khoản gốc (chủ sở hữu hệ thống) mở lớp và chỉ định quản trị cho lớp đó.
   * Nếu để ai cũng tạo được lớp thì một sinh viên tự mở lớp giả rồi tự làm quản trị.
   */
  createClass: (r: UiRole) => r === 'owner',
  /** Trang danh sách mọi lớp trong hệ thống — chỉ tài khoản gốc. */
  manageClasses: (r: UiRole) => r === 'owner',
  switchClass: (r: UiRole) => atLeast(r, 'guest'),
};

/** Thông báo khi người dùng chạm vào chỗ vượt quyền — nói rõ cần vai trò nào. */
export function needRoleMessage(min: UiRole): string {
  const label: Record<UiRole, string> = {
    guest: 'khách', member: 'thành viên của lớp', treasurer: 'thủ quỹ',
    admin: 'quản trị lớp', owner: 'chủ sở hữu hệ thống',
  };
  return `Việc này cần quyền ${label[min]} trở lên trong lớp này. Hãy nhờ quản trị lớp cấp quyền cho bạn.`;
}
