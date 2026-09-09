/**
 * Kiểu dữ liệu của DB, viết tay để đọc là hiểu (và để không phải chạy Supabase mới build được).
 * Muốn sinh lại từ DB thật: npm run db:types
 */
export type Fund = 'QUY_LOP' | 'QUY_DOAN';
export type PayMethod = 'CASH' | 'TRANSFER';
export type PeriodStatus = 'OPEN' | 'CLOSED';
export type AppRole = 'member' | 'treasurer' | 'admin' | 'owner';
/** Vai trò dùng trong UI, có thêm "khách chưa đăng nhập". */
export type UiRole = AppRole | 'guest';

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  role: AppRole;
  is_active: boolean;
  student_id: string | null;
  created_at: string;
  last_sign_in_at: string | null;
}

export interface Invite {
  id: string;
  email: string;
  role: AppRole;
  student_id: string | null;
  note: string;
  invited_by: string | null;
  created_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
}

export interface ClassSettings {
  id: number;
  class_name: string;
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
  updated_at: string;
}

/** Những gì khách chưa đăng nhập được biết về lớp (không có số tài khoản). */
export interface ClassPublic {
  class_name: string;
  faculty: string;
  term: string;
  school_year: string;
  hide_student_names_from_guest: boolean;
  bank_configured: boolean;
}

export interface Student {
  id: string;
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
  fund: Fund;
  total_income: number;
  total_expense: number;
  balance: number;
}

export interface StudentDebt {
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
  admin: 'Quản trị',
  owner: 'Chủ sở hữu',
};
