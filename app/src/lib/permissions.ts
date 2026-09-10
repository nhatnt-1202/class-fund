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

/** Admin hành xử như quản trị lớp ở mọi lớp. */
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
  showQr: (r: UiRole) => atLeast(r, 'guest'),
  /**
   * Ai xem được QR chuyển khoản của một sinh viên.
   *
   * - Thủ quỹ trở lên: của mọi người, vì chính họ đi thu.
   * - Thành viên: chỉ của CHÍNH MÌNH — QR mang số tiền và mã SV của người khác thì không
   *   việc gì phải cho họ thấy.
   * - Khách: được, nhưng chỉ khi lớp KHÔNG bật che tên sinh viên (`guestQrAllowed`). Người
   *   phải nộp tiền thường không đăng nhập, nên chặn khách là chặn đúng người cần trả tiền.
   *   Còn khi lớp đã bật che tên thì mã SV trong nội dung chuyển khoản cũng bị che, tiền về
   *   sẽ không đối chiếu được với ai — thà không cho tạo mã còn hơn tạo mã vô danh.
   */
  showQrFor: (
    r: UiRole,
    myStudentId: string | null | undefined,
    studentId: string,
    guestQrAllowed = false,
  ) =>
    atLeast(r, 'treasurer')
    || (r === 'member' && Boolean(myStudentId) && myStudentId === studentId)
    || (r === 'guest' && guestQrAllowed),
  confirmTransfer: (r: UiRole) => atLeast(r, 'treasurer'),
  writePeriod: (r: UiRole) => atLeast(r, 'admin'),
  manageUsers: (r: UiRole) => atLeast(r, 'admin'),
  /**
   * Lịch sử thao tác là công cụ giám sát: chỉ quản trị lớp (và tài khoản gốc) đọc được.
   * Thủ quỹ — người bị giám sát nhiều nhất — cố ý KHÔNG thấy trang này, và RLS ở
   * 0010_audit_admin_only.sql chặn thật chứ không chỉ ẩn menu.
   */
  viewAudit: (r: UiRole) => atLeast(r, 'admin'),
  /**
   * Thống kê lượt truy cập. Cùng lý lẽ với lịch sử thao tác: là công cụ giám sát nên chỉ
   * quản trị thấy. Tài khoản gốc thấy toàn hệ thống, quản trị lớp chỉ thấy lớp mình —
   * việc phân tách đó do RLS ở 0012_visits.sql làm, không phải do giao diện.
   */
  viewVisits: (r: UiRole) => atLeast(r, 'admin'),
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
