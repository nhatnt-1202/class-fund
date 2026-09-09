/**
 * Tầng dữ liệu: mọi truy vấn và ghi dữ liệu đi qua đây.
 *
 * Bốn điều quan trọng:
 *  1. MỌI THỨ ĐỀU THUỘC MỘT LỚP. Hầu hết hook nhận classId và không chạy khi chưa chọn lớp.
 *     RLS trong Postgres cũng chặn chéo lớp, nhưng lọc sẵn ở đây để không tải dữ liệu vô ích.
 *  2. Khách chưa đăng nhập đọc các VIEW CÔNG KHAI (không ngày sinh, không số tài khoản);
 *     người đã đăng nhập đọc bảng gốc. Việc chọn nguồn nằm ở đây, không rải rác trong trang.
 *  3. Supabase mặc định chỉ trả 1000 dòng. Báo cáo tài chính không được thiếu dòng nên mọi
 *     danh sách đều tải hết bằng fetchAll().
 *  4. RLS chặn UPDATE bằng cách lọc hết dòng (0 dòng bị sửa) chứ không báo lỗi, nên mọi
 *     mutation đều đi qua assertChanged().
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { assertChanged, friendlyError, supabase } from '@/lib/supabase';
import type {
  AppConfig, AuditLog, ClassOfficer, ClassRole, Expense, ExpensePublic, Fund, FundBalance, Income, IncomePublic,
  Invite, Klass, KlassPublic, LedgerRow, Membership, Period, PeriodProgress, Profile, Student,
  StudentDebt, StudentPublic, UiRole,
} from '@/types/db';

const PAGE = 1000;

/** Tải hết mọi dòng theo trang, không để báo cáo thiếu số liệu vì giới hạn 1000. */
async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let page = 0; ; page++) {
    const { data, error } = await build(page * PAGE, page * PAGE + PAGE - 1);
    if (error) throw new Error(friendlyError(error.message));
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

export const qk = {
  appConfig: ['appConfig'] as const,
  myClasses: ['myClasses'] as const,
  publicClasses: ['publicClasses'] as const,
  klass: (id: string) => ['klass', id] as const,
  balances: (id: string) => ['balances', id] as const,
  periods: (id: string) => ['periods', id] as const,
  progress: (id: string) => ['progress', id] as const,
  students: (id: string, role: UiRole) => ['students', id, role] as const,
  debts: (id: string, role: UiRole) => ['debts', id, role] as const,
  incomes: (id: string, role: UiRole) => ['incomes', id, role] as const,
  expenses: (id: string, role: UiRole) => ['expenses', id, role] as const,
  ledger: (id: string) => ['ledger', id] as const,
  audit: (id: string) => ['audit', id] as const,
  members: (id: string) => ['members', id] as const,
  officers: (id: string) => ['officers', id] as const,
  invites: (id: string) => ['invites', id] as const,
};

const isGuest = (role: UiRole) => role === 'guest';

/* ============================== HỆ THỐNG & LỚP ============================== */

/** Domain email trường và mẫu mã SV — dùng để kiểm tra ngay trên form đăng ký. */
export function useAppConfig() {
  return useQuery({
    queryKey: qk.appConfig,
    queryFn: async (): Promise<AppConfig> => {
      const { data, error } = await supabase
        .from('app_config').select('student_email_domain, student_code_pattern').maybeSingle();
      if (error) throw new Error(friendlyError(error.message));
      return (data as AppConfig | null)
        ?? { student_email_domain: 'student.humg.edu.vn', student_code_pattern: '^[0-9]{8,12}$' };
    },
    staleTime: 10 * 60_000,
  });
}

export interface MyClass extends Klass {
  myRole: ClassRole;
  /** Sinh viên trong lớp này được gắn với tài khoản của tôi (để xem "công nợ của tôi"). */
  myStudentId: string | null;
}

/** Các lớp người đang đăng nhập thuộc về, kèm vai trò trong từng lớp. */
export function useMyClasses(enabled: boolean, isSystemOwner: boolean) {
  return useQuery({
    queryKey: qk.myClasses,
    queryFn: async (): Promise<MyClass[]> => {
      const [classes, members] = await Promise.all([
        fetchAll<Klass>((from, to) =>
          supabase.from('classes').select('*').eq('is_active', true).order('code').range(from, to)),
        fetchAll<Membership>((from, to) =>
          supabase.from('memberships').select('*').range(from, to)),
      ]);
      const mine = new Map(members.map((m) => [m.class_id, m]));
      return classes.map((c) => ({
        ...c,
        // Chủ sở hữu hệ thống thấy mọi lớp và hành xử như quản trị lớp
        myRole: mine.get(c.id)?.role ?? (isSystemOwner ? 'admin' : 'member'),
        myStudentId: mine.get(c.id)?.student_id ?? null,
      }));
    },
    enabled,
  });
}

/**
 * Ban quản lý của lớp (quản trị lớp, thủ quỹ) — đọc được với mọi vai trò, kể cả khách.
 * Bảng memberships chỉ quản trị lớp mới đọc được, nên phải đi qua view v_class_officers:
 * ai cũng cần biết trong lớp mình ai đang giữ quỹ.
 */
export function useClassOfficers(classId: string | null) {
  return useQuery({
    queryKey: qk.officers(classId ?? ''),
    queryFn: async (): Promise<ClassOfficer[]> => {
      const { data, error } = await supabase.from('v_class_officers').select('*')
        .eq('class_id', classId!).order('role');
      if (error) throw new Error(friendlyError(error.message));
      return (data ?? []) as ClassOfficer[];
    },
    enabled: Boolean(classId),
    staleTime: 60_000,
  });
}

/** Danh sách lớp công khai để khách chọn lớp muốn xem. */
export function usePublicClasses() {
  return useQuery({
    queryKey: qk.publicClasses,
    queryFn: () => fetchAll<KlassPublic>((from, to) =>
      supabase.from('v_classes_public').select('*').order('code').range(from, to)),
    staleTime: 60_000,
  });
}

/** Thông tin lớp: người đã đăng nhập đọc bảng gốc (có số tài khoản), khách đọc view công khai. */
export function useKlass(classId: string | null, role: UiRole) {
  return useQuery({
    queryKey: qk.klass(classId ?? ''),
    queryFn: async (): Promise<Klass | null> => {
      if (!classId) return null;
      if (isGuest(role)) {
        const { data, error } = await supabase
          .from('v_classes_public').select('*').eq('class_id', classId).maybeSingle();
        if (error) throw new Error(friendlyError(error.message));
        const p = data as KlassPublic | null;
        if (!p) return null;
        // Khách không được biết số tài khoản: điền chuỗi rỗng để phần còn lại của app dùng chung một kiểu
        return {
          id: p.class_id, code: p.code, name: p.name, faculty: p.faculty, term: p.term,
          school_year: p.school_year, categories: [], hide_student_names_from_guest: p.hide_student_names_from_guest,
          bank_bin: '', bank_name: '', account_no: '', account_name: '', note_template: '',
          is_active: true, created_at: '',
        };
      }
      const { data, error } = await supabase.from('classes').select('*').eq('id', classId).maybeSingle();
      if (error) throw new Error(friendlyError(error.message));
      return (data as Klass | null) ?? null;
    },
    enabled: Boolean(classId),
    staleTime: 60_000,
  });
}

export function useCreateClass() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: {
      code: string; name?: string; faculty?: string; term?: string; school_year?: string;
      /** Email được giao làm quản trị lớp; để trống thì lớp chưa có quản trị. */
      admin_email?: string;
    }) => {
      const { data, error } = await supabase.rpc('create_class', {
        p_code: values.code,
        p_name: values.name ?? '',
        p_faculty: values.faculty ?? '',
        p_term: values.term ?? '',
        p_school_year: values.school_year ?? '',
        p_admin_email: values.admin_email?.trim().toLowerCase() ?? '',
      });
      if (error) throw new Error(friendlyError(error.message));
      return data as Klass;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.myClasses });
      void qc.invalidateQueries({ queryKey: qk.publicClasses });
    },
  });
}

export function useSaveKlass(classId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: Partial<Klass>) => {
      if (!classId) throw new Error('Chưa chọn lớp');
      const { data, error } = await supabase.from('classes')
        .update({ ...values, updated_at: new Date().toISOString() }).eq('id', classId).select();
      if (error) throw new Error(friendlyError(error.message));
      return assertChanged(data, 'Không lưu được thông tin lớp')[0] as Klass;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['klass'] });
      void qc.invalidateQueries({ queryKey: qk.myClasses });
      void qc.invalidateQueries({ queryKey: qk.publicClasses });
      void qc.invalidateQueries({ queryKey: ['audit'] });
    },
  });
}

/* ============================== ĐỌC DỮ LIỆU LỚP ============================== */

export function useBalances(classId: string | null) {
  return useQuery({
    queryKey: qk.balances(classId ?? ''),
    queryFn: async (): Promise<FundBalance[]> => {
      const { data, error } = await supabase.from('v_fund_balance').select('*').eq('class_id', classId!);
      if (error) throw new Error(friendlyError(error.message));
      return (data ?? []) as FundBalance[];
    },
    enabled: Boolean(classId),
  });
}

export function usePeriods(classId: string | null) {
  return useQuery({
    queryKey: qk.periods(classId ?? ''),
    queryFn: () => fetchAll<Period>((from, to) =>
      supabase.from('periods').select('*').eq('class_id', classId!)
        .is('deleted_at', null).order('open_date').range(from, to)),
    enabled: Boolean(classId),
  });
}

export function usePeriodProgress(classId: string | null) {
  return useQuery({
    queryKey: qk.progress(classId ?? ''),
    queryFn: async (): Promise<PeriodProgress[]> => {
      const { data, error } = await supabase.from('v_period_progress').select('*')
        .eq('class_id', classId!).order('open_date');
      if (error) throw new Error(friendlyError(error.message));
      return (data ?? []) as PeriodProgress[];
    },
    enabled: Boolean(classId),
  });
}

export function useStudents(classId: string | null, role: UiRole) {
  return useQuery({
    queryKey: qk.students(classId ?? '', role),
    queryFn: async (): Promise<Student[]> => {
      if (isGuest(role)) {
        const rows = await fetchAll<StudentPublic & { class_id: string }>((from, to) =>
          supabase.from('v_students_public').select('*').eq('class_id', classId!).order('stt').range(from, to));
        return rows.map((r) => ({
          id: r.id, class_id: r.class_id, stt: r.stt, code: r.code, last_name: '', first_name: '',
          full_name: r.full_name, dob: null, class_code: r.class_code, note: '', is_active: true,
          batch_id: null, deleted_at: null, created_at: '', created_by: null,
        }));
      }
      return fetchAll<Student>((from, to) =>
        supabase.from('students').select('*').eq('class_id', classId!)
          .is('deleted_at', null).order('stt').range(from, to));
    },
    enabled: Boolean(classId),
  });
}

export function useDebts(classId: string | null, role: UiRole) {
  return useQuery({
    queryKey: qk.debts(classId ?? '', role),
    queryFn: () => fetchAll<StudentDebt>((from, to) =>
      supabase.from(isGuest(role) ? 'v_debt_public' : 'v_student_debt')
        .select('*').eq('class_id', classId!).range(from, to)),
    enabled: Boolean(classId),
  });
}

export interface IncomeRow extends Income {
  student_code?: string;
  student_name?: string;
  period_name?: string;
}

export function useIncomes(classId: string | null, role: UiRole) {
  return useQuery({
    queryKey: qk.incomes(classId ?? '', role),
    queryFn: async (): Promise<IncomeRow[]> => {
      if (isGuest(role)) {
        const rows = await fetchAll<IncomePublic & { class_id: string }>((from, to) =>
          supabase.from('v_incomes_public').select('*').eq('class_id', classId!)
            .order('date', { ascending: false }).range(from, to));
        return rows.map((r) => ({
          id: r.id, class_id: r.class_id, date: r.date, fund: r.fund, period_id: r.period_id,
          student_id: null, payer_name: r.payer, amount: r.amount, method: r.method,
          collected_by: '', note: '', batch_id: null, deleted_at: null, created_at: '', created_by: null,
          student_name: r.payer, period_name: r.period_name,
        }));
      }
      const rows = await fetchAll<Income & {
        students: { code: string; full_name: string } | null;
        periods: { name: string } | null;
      }>((from, to) =>
        supabase.from('incomes').select('*, students(code, full_name), periods(name)')
          .eq('class_id', classId!).is('deleted_at', null)
          .order('date', { ascending: false }).range(from, to));
      return rows.map(({ students, periods, ...rest }) => ({
        ...rest,
        student_code: students?.code,
        student_name: students?.full_name ?? rest.payer_name,
        period_name: periods?.name,
      }));
    },
    enabled: Boolean(classId),
  });
}

export function useExpenses(classId: string | null, role: UiRole) {
  return useQuery({
    queryKey: qk.expenses(classId ?? '', role),
    queryFn: async (): Promise<Expense[]> => {
      if (isGuest(role)) {
        const rows = await fetchAll<ExpensePublic & { class_id: string }>((from, to) =>
          supabase.from('v_expenses_public').select('*').eq('class_id', classId!)
            .order('date', { ascending: false }).range(from, to));
        return rows.map((r) => ({
          ...r, receipt_url: null, note: '', deleted_at: null, created_at: '', created_by: null,
        }));
      }
      return fetchAll<Expense>((from, to) =>
        supabase.from('expenses').select('*').eq('class_id', classId!).is('deleted_at', null)
          .order('date', { ascending: false }).range(from, to));
    },
    enabled: Boolean(classId),
  });
}

export function useLedger(classId: string | null, role: UiRole) {
  return useQuery({
    queryKey: qk.ledger(classId ?? ''),
    queryFn: () => fetchAll<LedgerRow>((from, to) =>
      supabase.from('v_daily_ledger').select('*').eq('class_id', classId!).order('date').range(from, to)),
    enabled: Boolean(classId) && !isGuest(role),
  });
}

export interface AuditFilter {
  actor?: string;
  action?: string;
  table?: string;
  from?: string;
  to?: string;
  q?: string;
}

export function useAuditLogs(classId: string | null, filter: AuditFilter, enabled: boolean, limit = 200) {
  return useQuery({
    queryKey: [...qk.audit(classId ?? ''), filter, limit],
    queryFn: async (): Promise<AuditLog[]> => {
      let q = supabase.from('audit_logs').select('*').eq('class_id', classId!)
        .order('at', { ascending: false }).limit(limit);
      if (filter.actor) q = q.eq('actor_id', filter.actor);
      if (filter.action) q = q.eq('action', filter.action);
      if (filter.table) q = q.eq('table_name', filter.table);
      if (filter.from) q = q.gte('at', `${filter.from}T00:00:00`);
      if (filter.to) q = q.lte('at', `${filter.to}T23:59:59`);
      if (filter.q) q = q.ilike('summary', `%${filter.q}%`);
      const { data, error } = await q;
      if (error) throw new Error(friendlyError(error.message));
      return (data ?? []) as AuditLog[];
    },
    enabled: enabled && Boolean(classId),
  });
}

export interface MemberRow extends Membership {
  profile: Pick<Profile, 'id' | 'email' | 'full_name' | 'role' | 'is_active' | 'last_sign_in_at'> | null;
}

/** Thành viên của một lớp, kèm thông tin tài khoản. */
export function useMembers(classId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: qk.members(classId ?? ''),
    queryFn: async (): Promise<MemberRow[]> => {
      const rows = await fetchAll<Membership & {
        profiles: MemberRow['profile'];
      }>((from, to) =>
        supabase.from('memberships')
          .select('*, profiles(id, email, full_name, role, is_active, last_sign_in_at)')
          .eq('class_id', classId!).order('created_at').range(from, to));
      return rows.map(({ profiles, ...rest }) => ({ ...rest, profile: profiles }));
    },
    enabled: enabled && Boolean(classId),
  });
}

/**
 * Quản trị của TỪNG lớp trong hệ thống, cho trang quản lý lớp của tài khoản gốc.
 * RLS chỉ trả về những dòng người gọi được thấy, nên với quản trị lớp thường
 * hook này tự thu về đúng lớp của họ.
 */
export interface ClassAdminRow {
  class_id: string;
  user_id: string;
  email: string;
  full_name: string;
  pending: boolean;
}

export function useClassAdmins(enabled: boolean) {
  return useQuery({
    queryKey: ['class-admins'],
    queryFn: async (): Promise<ClassAdminRow[]> => {
      const [members, invites] = await Promise.all([
        fetchAll<Membership & { profiles: Pick<Profile, 'email' | 'full_name'> | null }>((from, to) =>
          supabase.from('memberships').select('*, profiles(email, full_name)')
            .eq('role', 'admin').range(from, to)),
        fetchAll<Invite>((from, to) =>
          supabase.from('invites').select('*').eq('role', 'admin')
            .is('accepted_at', null).is('revoked_at', null).range(from, to)),
      ]);
      return [
        ...members.map((m) => ({
          class_id: m.class_id, user_id: m.user_id,
          email: m.profiles?.email ?? '', full_name: m.profiles?.full_name ?? '', pending: false,
        })),
        ...invites.map((i) => ({
          class_id: i.class_id, user_id: '', email: i.email, full_name: '', pending: true,
        })),
      ];
    },
    enabled,
  });
}

export function useInvites(classId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: qk.invites(classId ?? ''),
    queryFn: () => fetchAll<Invite>((from, to) =>
      supabase.from('invites').select('*').eq('class_id', classId!)
        .order('created_at', { ascending: false }).range(from, to)),
    enabled: enabled && Boolean(classId),
  });
}

/* ============================== GHI DỮ LIỆU ============================== */

/** Làm mới mọi thứ liên quan tới tiền của một lớp. */
function useInvalidateMoney(classId: string | null) {
  const qc = useQueryClient();
  return () => {
    for (const key of ['balances', 'incomes', 'expenses', 'debts', 'progress', 'ledger', 'audit']) {
      void qc.invalidateQueries({ queryKey: [key, classId ?? ''] });
      void qc.invalidateQueries({ queryKey: [key] });
    }
  };
}

export type NewIncome = Pick<Income, 'date' | 'fund' | 'amount' | 'method'> &
  Partial<Pick<Income, 'period_id' | 'student_id' | 'payer_name' | 'collected_by' | 'note'>>;

export function useSaveIncome(classId: string | null) {
  const refresh = useInvalidateMoney(classId);
  return useMutation({
    mutationFn: async ({ id, values }: { id?: string; values: NewIncome }) => {
      if (id) {
        const { data, error } = await supabase.from('incomes').update(values).eq('id', id).select();
        if (error) throw new Error(friendlyError(error.message));
        return assertChanged(data, 'Không lưu được khoản thu')[0] as Income;
      }
      if (!classId) throw new Error('Chưa chọn lớp');
      const { data, error } = await supabase.from('incomes').insert({ ...values, class_id: classId }).select();
      if (error) throw new Error(friendlyError(error.message));
      return assertChanged(data, 'Không ghi được khoản thu')[0] as Income;
    },
    onSuccess: refresh,
  });
}

/** Ghi nhiều khoản thu một lần: thu theo lô, hoặc một lần chuyển khoản trả cho nhiều đợt. */
export function useSaveIncomesBatch(classId: string | null) {
  const refresh = useInvalidateMoney(classId);
  return useMutation({
    mutationFn: async (rows: NewIncome[]) => {
      if (rows.length === 0) return [];
      if (!classId) throw new Error('Chưa chọn lớp');
      const { data, error } = await supabase.from('incomes')
        .insert(rows.map((r) => ({ ...r, class_id: classId }))).select();
      if (error) throw new Error(friendlyError(error.message));
      return assertChanged(data, 'Không ghi được các khoản thu') as Income[];
    },
    onSuccess: refresh,
  });
}

export type NewExpense = Pick<Expense, 'date' | 'fund' | 'item' | 'category' | 'buyer' | 'amount'> &
  Partial<Pick<Expense, 'has_receipt' | 'note' | 'overdraft'>>;

export function useSaveExpense(classId: string | null) {
  const refresh = useInvalidateMoney(classId);
  return useMutation({
    mutationFn: async ({ id, values }: { id?: string; values: NewExpense }) => {
      if (id) {
        const { data, error } = await supabase.from('expenses').update(values).eq('id', id).select();
        if (error) throw new Error(friendlyError(error.message));
        return assertChanged(data, 'Không lưu được khoản chi')[0] as Expense;
      }
      if (!classId) throw new Error('Chưa chọn lớp');
      const { data, error } = await supabase.from('expenses').insert({ ...values, class_id: classId }).select();
      if (error) throw new Error(friendlyError(error.message));
      return assertChanged(data, 'Không ghi được khoản chi')[0] as Expense;
    },
    onSuccess: refresh,
  });
}

export function useSoftDelete(table: 'incomes' | 'expenses' | 'students' | 'periods', classId: string | null) {
  const refresh = useInvalidateMoney(classId);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, restore }: { id: string; restore?: boolean }) => {
      const { data, error } = await supabase.from(table)
        .update({ deleted_at: restore ? null : new Date().toISOString() }).eq('id', id).select();
      if (error) throw new Error(friendlyError(error.message));
      return assertChanged(data, restore ? 'Không phục hồi được bản ghi' : 'Không xoá được bản ghi');
    },
    onSuccess: () => {
      refresh();
      void qc.invalidateQueries({ queryKey: ['students'] });
      void qc.invalidateQueries({ queryKey: ['periods'] });
    },
  });
}

export type NewStudent = Pick<Student, 'code' | 'last_name' | 'first_name'> &
  Partial<Pick<Student, 'stt' | 'dob' | 'class_code' | 'note' | 'is_active'>>;

export function useSaveStudent(classId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, values }: { id?: string; values: NewStudent }) => {
      if (id) {
        const { data, error } = await supabase.from('students').update(values).eq('id', id).select();
        if (error) throw new Error(friendlyError(error.message));
        return assertChanged(data, 'Không lưu được sinh viên')[0] as Student;
      }
      if (!classId) throw new Error('Chưa chọn lớp');
      const { data, error } = await supabase.from('students').insert({ ...values, class_id: classId }).select();
      if (error) throw new Error(friendlyError(error.message));
      return assertChanged(data, 'Không thêm được sinh viên')[0] as Student;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['students'] });
      void qc.invalidateQueries({ queryKey: ['debts'] });
      void qc.invalidateQueries({ queryKey: ['progress'] });
      void qc.invalidateQueries({ queryKey: ['audit'] });
    },
  });
}

export type NewPeriod = Pick<Period, 'name' | 'fund' | 'amount_per_student' | 'open_date'> &
  Partial<Pick<Period, 'due_date' | 'status' | 'note'>>;

export function useSavePeriod(classId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, values }: { id?: string; values: Partial<NewPeriod> }) => {
      if (id) {
        const { data, error } = await supabase.from('periods').update(values).eq('id', id).select();
        if (error) throw new Error(friendlyError(error.message));
        return assertChanged(data, 'Không lưu được đợt thu')[0] as Period;
      }
      if (!classId) throw new Error('Chưa chọn lớp');
      const { data, error } = await supabase.from('periods')
        .insert({ ...(values as NewPeriod), class_id: classId }).select();
      if (error) throw new Error(friendlyError(error.message));
      return assertChanged(data, 'Không tạo được đợt thu')[0] as Period;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['periods'] });
      void qc.invalidateQueries({ queryKey: ['progress'] });
      void qc.invalidateQueries({ queryKey: ['debts'] });
      void qc.invalidateQueries({ queryKey: ['audit'] });
    },
  });
}

export interface ImportResult {
  batch_id: string;
  added: number;
  updated: number;
  skipped: number;
  failed: number;
}

export function useImportStudents(classId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ rows, dedupe }: { rows: unknown[]; dedupe: 'skip' | 'update' | 'insert' }) => {
      if (!classId) throw new Error('Chưa chọn lớp');
      const { data, error } = await supabase.rpc('import_students', {
        p_class: classId, p_rows: rows, p_dedupe: dedupe,
      });
      if (error) throw new Error(friendlyError(error.message));
      return data as ImportResult;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['students'] });
      void qc.invalidateQueries({ queryKey: ['debts'] });
      void qc.invalidateQueries({ queryKey: ['progress'] });
      void qc.invalidateQueries({ queryKey: ['audit'] });
    },
  });
}

export function useUndoImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (batchId: string) => {
      const { data, error } = await supabase.rpc('undo_import', { p_batch: batchId });
      if (error) throw new Error(friendlyError(error.message));
      return data as { students: number };
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['students'] });
      void qc.invalidateQueries({ queryKey: ['debts'] });
      void qc.invalidateQueries({ queryKey: ['progress'] });
      void qc.invalidateQueries({ queryKey: ['audit'] });
    },
  });
}

/**
 * Giao vai trò trong lớp cho một email.
 *
 * Một RPC lo cả hai trường hợp, vì trình duyệt KHÔNG tra được email đó đã có tài khoản hay
 * chưa (RLS che bảng profiles của người khác): có tài khoản ⇒ cấp quyền ngay, chưa có ⇒ ghi
 * lời mời và người đó nhận đúng vai trò lúc đăng ký.
 */
export interface GrantResult {
  status: 'granted' | 'changed' | 'invited';
  email: string;
  role: ClassRole;
  role_before: ClassRole | null;
}

export function useGrantClassRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { classId: string; email: string; role: ClassRole; studentId?: string | null }) => {
      const { data, error } = await supabase.rpc('grant_class_role', {
        p_class: v.classId,
        p_email: v.email.trim().toLowerCase(),
        p_role: v.role,
        p_student: v.studentId || null,
      });
      if (error) throw new Error(friendlyError(error.message));
      return data as GrantResult;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['members'] });
      void qc.invalidateQueries({ queryKey: ['officers'] });
      void qc.invalidateQueries({ queryKey: ['invites'] });
      void qc.invalidateQueries({ queryKey: qk.myClasses });
      void qc.invalidateQueries({ queryKey: ['audit'] });
    },
  });
}

/** Rút một người khỏi lớp (không xoá tài khoản của họ). */
export function useRevokeClassRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { classId: string; userId: string }) => {
      const { error } = await supabase.rpc('revoke_class_role', { p_class: v.classId, p_user: v.userId });
      if (error) throw new Error(friendlyError(error.message));
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['members'] });
      void qc.invalidateQueries({ queryKey: ['officers'] });
      void qc.invalidateQueries({ queryKey: qk.myClasses });
      void qc.invalidateQueries({ queryKey: ['audit'] });
    },
  });
}

export function useRevokeInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.from('invites')
        .update({ revoked_at: new Date().toISOString() }).eq('id', id).select();
      if (error) throw new Error(friendlyError(error.message));
      return assertChanged(data, 'Không thu hồi được lời mời');
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['invites'] });
      void qc.invalidateQueries({ queryKey: ['audit'] });
    },
  });
}

/** Đổi vai trò của một thành viên TRONG LỚP. */
export function useUpdateMembership() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, values }: { id: string; values: Partial<Pick<Membership, 'role' | 'student_id'>> }) => {
      const { data, error } = await supabase.from('memberships').update(values).eq('id', id).select();
      if (error) throw new Error(friendlyError(error.message));
      return assertChanged(data, 'Không cập nhật được thành viên')[0] as Membership;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['members'] });
      void qc.invalidateQueries({ queryKey: ['officers'] });
      void qc.invalidateQueries({ queryKey: ['audit'] });
    },
  });
}

/** Sửa tên/trạng thái của một tài khoản. */
export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, values }: { id: string; values: Partial<Profile> }) => {
      const { data, error } = await supabase.from('profiles').update(values).eq('id', id).select();
      if (error) throw new Error(friendlyError(error.message));
      return assertChanged(data, 'Không cập nhật được tài khoản')[0] as Profile;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['members'] });
      void qc.invalidateQueries({ queryKey: ['officers'] });
      void qc.invalidateQueries({ queryKey: ['audit'] });
    },
  });
}

/** Ghi log EXPORT / IMPORT / VIEW_QR — không được cản trở việc chính nếu thất bại. */
export async function logEvent(
  action: 'EXPORT' | 'IMPORT' | 'VIEW_QR',
  summary: string,
  classId: string | null,
  meta?: unknown,
) {
  const { error } = await supabase.rpc('log_event', {
    p_action: action, p_summary: summary, p_meta: meta ?? null, p_class: classId,
  });
  if (error) console.warn('Không ghi được audit log:', error.message);
}

export type { Fund };
