/**
 * Kiểu dữ liệu của DB, viết tay để đọc là hiểu (và để không phải chạy Supabase mới build được).
 * Muốn sinh lại từ DB thật: npm run db:types
 */
export type Fund = 'QUY_LOP' | 'QUY_DOAN';
export type PayMethod = 'CASH' | 'TRANSFER';
export type PeriodStatus = 'OPEN' | 'CLOSED';
/** Vai trò HỆ THỐNG trong bảng profiles: chỉ 'owner' có nghĩa. */
export type SystemRole = 'member' | 'owner';
/** Vai trò TRONG MỘT LỚP (bảng memberships). */
export type ClassRole = 'member' | 'treasurer' | 'admin';
/**
 * Vai trò dùng cho giao diện: vai trò trong lớp đang xem, cộng thêm 'guest' (chưa đăng nhập)
 * và 'owner' (chủ sở hữu hệ thống — được coi như quản trị của mọi lớp).
 */
export type UiRole = 'guest' | ClassRole | 'owner';

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  role: SystemRole;
  is_active: boolean;
  created_at: string;
  last_sign_in_at: string | null;
}

/** Một lớp học — đơn vị chứa toàn bộ dữ liệu thu chi. */
export interface Klass {
  id: string;
  code: string;
  name: string;
  faculty: string;
  term: string;
  school_year: string;
  categories: string[];
  hide_student_names_from_guest: boolean;
  bank_bin: string;
  bank_name: string;
  account_no: string;
  account_name: string;
  note_template: string;
  is_active: boolean;
  created_at: string;
}

/** Những gì khách chưa đăng nhập được biết về một lớp (không có số tài khoản). */
export interface KlassPublic {
  class_id: string;
  code: string;
  name: string;
  faculty: string;
  term: string;
  school_year: string;
  hide_student_names_from_guest: boolean;
  bank_configured: boolean;
  student_count: number;
}

/** Ai thuộc lớp nào với vai trò gì. */
export interface Membership {
  id: string;
  user_id: string;
  class_id: string;
  role: ClassRole;
  student_id: string | null;
  created_at: string;
}

export interface Invite {
  id: string;
  email: string;
  class_id: string;
  role: ClassRole;
  student_id: string | null;
  note: string;
  invited_by: string | null;
  created_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
}

export interface Student {
  id: string;
  class_id: string;
  stt: number | null;
  code: string;
  last_name: string;
  first_name: string;
  full_name: string;
  dob: string | null;
  class_code: string;
  note: string;
  is_active: boolean;
  batch_id: string | null;
  deleted_at: string | null;
  created_at: string;
  created_by: string | null;
}
/** Bản rút gọn cho khách: không có ngày sinh, tên có thể bị che. */
export interface StudentPublic {
  id: string;
  stt: number | null;
  code: string;
  full_name: string;
  class_code: string;
}

export interface Period {
  id: string;
  class_id: string;
  name: string;
  fund: Fund;
  amount_per_student: number;
  open_date: string;
  due_date: string | null;
  status: PeriodStatus;
  note: string;
  deleted_at: string | null;
  created_at: string;
  created_by: string | null;
}

export interface Income {
  id: string;
  class_id: string;
  date: string;
  fund: Fund;
  period_id: string | null;
  student_id: string | null;
  payer_name: string;
  amount: number;
  method: PayMethod;
  collected_by: string;
  note: string;
  batch_id: string | null;
  deleted_at: string | null;
  created_at: string;
  created_by: string | null;
}
export interface IncomePublic {
  id: string;
  date: string;
  fund: Fund;
  period_id: string | null;
  amount: number;
  method: PayMethod;
  payer: string;
  period_name: string;
}

export interface Expense {
  id: string;
  class_id: string;
  date: string;
  fund: Fund;
  item: string;
  category: string;
  buyer: string;
  amount: number;
  has_receipt: boolean;
  receipt_url: string | null;
  overdraft: boolean;
  note: string;
  deleted_at: string | null;
  created_at: string;
  created_by: string | null;
}
export interface ExpensePublic {
  id: string;
  date: string;
  fund: Fund;
  item: string;
  category: string;
  buyer: string;
  amount: number;
  has_receipt: boolean;
  overdraft: boolean;
}

export interface FundBalance {
  class_id: string;
  fund: Fund;
  total_income: number;
  total_expense: number;
  balance: number;
}

export interface StudentDebt {
  class_id: string;
  student_id: string;
  code: string;
  full_name: string;
  period_id: string;
  period_name: string;
  fund: Fund;
  must_pay: number;
  paid: number;
  remaining: number;
}

export interface PeriodProgress {
  class_id: string;
  period_id: string;
  name: string;
  fund: Fund;
  amount_per_student: number;
  status: PeriodStatus;
  open_date: string;
  due_date: string | null;
  student_count: number;
  collected: number;
  expected: number;
  remaining: number;
  paid_count: number;
  partial_count: number;
  unpaid_count: number;
}

export interface LedgerRow {
  class_id: string;
  id: string;
  date: string;
  fund: Fund;
  kind: 'THU' | 'CHI';
  amount: number;
  label: string;
  detail: string;
  running_balance: number;
}

export type AuditAction =
  | 'INSERT' | 'UPDATE' | 'SOFT_DELETE' | 'RESTORE'
  | 'LOGIN' | 'LOGOUT' | 'IMPORT' | 'EXPORT' | 'ROLE_CHANGE' | 'INVITE' | 'VIEW_QR';

export interface AuditLog {
  id: number;
  class_id: string | null;
  at: string;
  actor_id: string | null;
  actor_email: string;
  actor_name: string;
  action: AuditAction;
  table_name: string;
  record_id: string | null;
  summary: string;
  before_data: Record<string, unknown> | null;
  after_data: Record<string, unknown> | null;
  changed_fields: string[] | null;
  meta: Record<string, unknown> | null;
}

export const FUNDS: Record<Fund, { label: string; short: string; cls: 'lop' | 'doan' }> = {
  QUY_LOP: { label: 'Quỹ Lớp', short: 'Lớp', cls: 'lop' },
  QUY_DOAN: { label: 'Quỹ Đoàn', short: 'Đoàn', cls: 'doan' },
};
export const FUND_KEYS = Object.keys(FUNDS) as Fund[];

export const METHOD_LABEL: Record<PayMethod, string> = {
  CASH: 'Tiền mặt',
  TRANSFER: 'Chuyển khoản',
};

export const ROLE_LABEL: Record<UiRole, string> = {
  guest: 'Khách',
  member: 'Thành viên',
  treasurer: 'Thủ quỹ',
  admin: 'Quản trị lớp',
  owner: 'Chủ sở hữu hệ thống',
};

export const CLASS_ROLES: ClassRole[] = ['member', 'treasurer', 'admin'];

/** Email trường: <mã SV>@student.humg.edu.vn — đăng ký tự do, không cần lời mời. */
export interface AppConfig {
  student_email_domain: string;
  student_code_pattern: string;
}
