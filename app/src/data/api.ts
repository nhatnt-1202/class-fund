/**
 * Tầng dữ liệu: mọi truy vấn và ghi dữ liệu đi qua đây.
 *
 * Hai điều quan trọng:
 *  1. Khách chưa đăng nhập đọc các VIEW CÔNG KHAI (không có ngày sinh, không có số tài
 *     khoản); người đã đăng nhập đọc bảng gốc. Việc chọn nguồn nằm ở đây, không rải rác
 *     trong các trang.
 *  2. Supabase mặc định chỉ trả 1000 dòng. Báo cáo tài chính không được phép thiếu dòng
 *     nên mọi danh sách đều tải hết bằng fetchAll().
 */
import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';
import { assertChanged, friendlyError, supabase } from '@/lib/supabase';
import type {
  AuditLog, ClassPublic, ClassSettings, Expense, ExpensePublic, Fund, FundBalance, Income,
  IncomePublic, Invite, LedgerRow, Period, PeriodProgress, Profile, Student, StudentDebt,
  StudentPublic, UiRole,
} from '@/types/db';

const PAGE = 1000;

/** Tải hết mọi dòng theo trang, không bao giờ để báo cáo thiếu số liệu vì giới hạn 1000. */
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
  classInfo: ['classInfo'] as const,
  settings: ['settings'] as const,
  balances: ['balances'] as const,
  periods: ['periods'] as const,
  progress: ['progress'] as const,
  students: (role: UiRole) => ['students', role] as const,
  debts: (role: UiRole) => ['debts', role] as const,
  incomes: (role: UiRole) => ['incomes', role] as const,
  expenses: (role: UiRole) => ['expenses', role] as const,
  ledger: ['ledger'] as const,
  audit: ['audit'] as const,
  profiles: ['profiles'] as const,
  invites: ['invites'] as const,
};

const isGuest = (role: UiRole) => role === 'guest';

/* ============================== ĐỌC ============================== */

export interface ClassInfo extends ClassPublic {}

export function useClassInfo(role: UiRole) {
  return useQuery({
    queryKey: qk.classInfo,
    queryFn: async (): Promise<ClassInfo> => {
      const { data, error } = await supabase.from('v_class_public').select('*').maybeSingle();
      if (error) throw new Error(friendlyError(error.message));
      return (data as ClassInfo | null) ?? {
        class_name: '', faculty: '', term: '', school_year: '',
        hide_student_names_from_guest: false, bank_configured: false,
      };
    },
    staleTime: 60_000,
    enabled: role !== undefined,
  });
}

/** Cấu hình đầy đủ (có số tài khoản) — chỉ người đã đăng nhập đọc được. */
export function useSettings(role: UiRole) {
  return useQuery({
    queryKey: qk.settings,
    queryFn: async (): Promise<ClassSettings | null> => {
      const { data, error } = await supabase.from('class_settings').select('*').eq('id', 1).maybeSingle();
      if (error) throw new Error(friendlyError(error.message));
      return (data as ClassSettings | null) ?? null;
    },
    enabled: !isGuest(role),
    staleTime: 60_000,
  });
}

export function useBalances() {
  return useQuery({
    queryKey: qk.balances,
    queryFn: async (): Promise<FundBalance[]> => {
      const { data, error } = await supabase.from('v_fund_balance').select('*');
      if (error) throw new Error(friendlyError(error.message));
      return (data ?? []) as FundBalance[];
    },
  });
}

export function usePeriods() {
  return useQuery({
    queryKey: qk.periods,
    queryFn: () => fetchAll<Period>((from, to) =>
      supabase.from('periods').select('*').is('deleted_at', null).order('open_date').range(from, to)),
  });
}

export function usePeriodProgress() {
  return useQuery({
    queryKey: qk.progress,
    queryFn: async (): Promise<PeriodProgress[]> => {
      const { data, error } = await supabase.from('v_period_progress').select('*').order('open_date');
      if (error) throw new Error(friendlyError(error.message));
      return (data ?? []) as PeriodProgress[];
    },
  });
}

/** Khách nhận bản rút gọn (không ngày sinh, tên có thể bị che). */
export function useStudents(role: UiRole) {
  return useQuery({
    queryKey: qk.students(role),
    queryFn: async (): Promise<Student[]> => {
      if (isGuest(role)) {
        const rows = await fetchAll<StudentPublic>((from, to) =>
          supabase.from('v_students_public').select('*').order('stt').range(from, to));
        return rows.map((r) => ({
          id: r.id, stt: r.stt, code: r.code, last_name: '', first_name: '', full_name: r.full_name,
          dob: null, class_code: r.class_code, note: '', is_active: true, batch_id: null,
          deleted_at: null, created_at: '', created_by: null,
        }));
      }
      return fetchAll<Student>((from, to) =>
        supabase.from('students').select('*').is('deleted_at', null).order('stt').range(from, to));
    },
  });
}

export function useDebts(role: UiRole) {
  return useQuery({
    queryKey: qk.debts(role),
    queryFn: () => fetchAll<StudentDebt>((from, to) =>
      supabase.from(isGuest(role) ? 'v_debt_public' : 'v_student_debt').select('*').range(from, to)),
  });
}

export interface IncomeRow extends Income {
  student_code?: string;
  student_name?: string;
  period_name?: string;
}

export function useIncomes(role: UiRole) {
  return useQuery({
    queryKey: qk.incomes(role),
    queryFn: async (): Promise<IncomeRow[]> => {
      if (isGuest(role)) {
        const rows = await fetchAll<IncomePublic>((from, to) =>
          supabase.from('v_incomes_public').select('*').order('date', { ascending: false }).range(from, to));
        return rows.map((r) => ({
          id: r.id, date: r.date, fund: r.fund, period_id: r.period_id, student_id: null,
          payer_name: r.payer, amount: r.amount, method: r.method, collected_by: '', note: '',
          batch_id: null, deleted_at: null, created_at: '', created_by: null,
          student_name: r.payer, period_name: r.period_name,
        }));
      }
      const rows = await fetchAll<Income & {
        students: { code: string; full_name: string } | null;
        periods: { name: string } | null;
      }>((from, to) =>
        supabase
          .from('incomes')
          .select('*, students(code, full_name), periods(name)')
          .is('deleted_at', null)
          .order('date', { ascending: false })
          .range(from, to));
      return rows.map(({ students, periods, ...rest }) => ({
        ...rest,
        student_code: students?.code,
        student_name: students?.full_name ?? rest.payer_name,
        period_name: periods?.name,
      }));
    },
  });
}

export function useExpenses(role: UiRole) {
  return useQuery({
    queryKey: qk.expenses(role),
    queryFn: async (): Promise<Expense[]> => {
      if (isGuest(role)) {
        const rows = await fetchAll<ExpensePublic>((from, to) =>
          supabase.from('v_expenses_public').select('*').order('date', { ascending: false }).range(from, to));
        return rows.map((r) => ({
          ...r, receipt_url: null, note: '', deleted_at: null, created_at: '', created_by: null,
        }));
      }
      return fetchAll<Expense>((from, to) =>
        supabase.from('expenses').select('*').is('deleted_at', null)
          .order('date', { ascending: false }).range(from, to));
    },
  });
}

export function useLedger(role: UiRole) {
  return useQuery({
    queryKey: qk.ledger,
    queryFn: () => fetchAll<LedgerRow>((from, to) =>
      supabase.from('v_daily_ledger').select('*').order('date').range(from, to)),
    enabled: !isGuest(role),
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

export function useAuditLogs(filter: AuditFilter, enabled: boolean, limit = 200) {
  return useQuery({
    queryKey: [...qk.audit, filter, limit],
    queryFn: async (): Promise<AuditLog[]> => {
      let q = supabase.from('audit_logs').select('*').order('at', { ascending: false }).limit(limit);
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
    enabled,
  });
}

export function useProfiles(enabled: boolean) {
  return useQuery({
    queryKey: qk.profiles,
    queryFn: () => fetchAll<Profile>((from, to) =>
      supabase.from('profiles').select('*').order('created_at').range(from, to)),
    enabled,
  });
}

export function useInvites(enabled: boolean) {
  return useQuery({
    queryKey: qk.invites,
    queryFn: () => fetchAll<Invite>((from, to) =>
      supabase.from('invites').select('*').order('created_at', { ascending: false }).range(from, to)),
    enabled,
  });
}

/* ============================== GHI ============================== */

/** Làm mới mọi thứ liên quan tới số tiền sau khi ghi. */
function useInvalidateMoney() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: qk.balances });
    void qc.invalidateQueries({ queryKey: ['incomes'] });
    void qc.invalidateQueries({ queryKey: ['expenses'] });
    void qc.invalidateQueries({ queryKey: ['debts'] });
    void qc.invalidateQueries({ queryKey: qk.progress });
    void qc.invalidateQueries({ queryKey: qk.ledger });
    void qc.invalidateQueries({ queryKey: qk.audit });
  };
}

export type NewIncome = Pick<Income, 'date' | 'fund' | 'amount' | 'method'> &
  Partial<Pick<Income, 'period_id' | 'student_id' | 'payer_name' | 'collected_by' | 'note'>>;

export function useSaveIncome() {
  const refresh = useInvalidateMoney();
  return useMutation({
    mutationFn: async ({ id, values }: { id?: string; values: NewIncome }) => {
      if (id) {
        const { data, error } = await supabase.from('incomes').update(values).eq('id', id).select();
        if (error) throw new Error(friendlyError(error.message));
        return assertChanged(data, 'Không lưu được khoản thu')[0] as Income;
      }
      const { data, error } = await supabase.from('incomes').insert(values).select();
      if (error) throw new Error(friendlyError(error.message));
      return assertChanged(data, 'Không ghi được khoản thu')[0] as Income;
    },
    onSuccess: refresh,
  });
}

/** Ghi nhiều khoản thu một lần (thu theo lô cả đợt). */
export function useSaveIncomesBatch() {
  const refresh = useInvalidateMoney();
  return useMutation({
    mutationFn: async (rows: NewIncome[]) => {
      if (rows.length === 0) return [];
      const { data, error } = await supabase.from('incomes').insert(rows).select();
      if (error) throw new Error(friendlyError(error.message));
      return assertChanged(data, 'Không ghi được các khoản thu') as Income[];
    },
    onSuccess: refresh,
  });
}

export type NewExpense = Pick<Expense, 'date' | 'fund' | 'item' | 'category' | 'buyer' | 'amount'> &
  Partial<Pick<Expense, 'has_receipt' | 'note' | 'overdraft'>>;

export function useSaveExpense() {
  const refresh = useInvalidateMoney();
  return useMutation({
    mutationFn: async ({ id, values }: { id?: string; values: NewExpense }) => {
      if (id) {
        const { data, error } = await supabase.from('expenses').update(values).eq('id', id).select();
        if (error) throw new Error(friendlyError(error.message));
        return assertChanged(data, 'Không lưu được khoản chi')[0] as Expense;
      }
      const { data, error } = await supabase.from('expenses').insert(values).select();
      if (error) throw new Error(friendlyError(error.message));
      return assertChanged(data, 'Không ghi được khoản chi')[0] as Expense;
    },
    onSuccess: refresh,
  });
}

/** Xoá mềm / phục hồi. DB tự chặn nếu vượt quyền hoặc quá 24h với thủ quỹ. */
export function useSoftDelete(table: 'incomes' | 'expenses' | 'students' | 'periods') {
  const refresh = useInvalidateMoney();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, restore }: { id: string; restore?: boolean }) => {
      const { data, error } = await supabase
        .from(table)
        .update({ deleted_at: restore ? null : new Date().toISOString() })
        .eq('id', id)
        .select();
      if (error) throw new Error(friendlyError(error.message));
      return assertChanged(data, restore ? 'Không phục hồi được bản ghi' : 'Không xoá được bản ghi');
    },
    onSuccess: () => {
      refresh();
      void qc.invalidateQueries({ queryKey: ['students'] });
      void qc.invalidateQueries({ queryKey: qk.periods });
    },
  });
}

export type NewStudent = Pick<Student, 'code' | 'last_name' | 'first_name'> &
  Partial<Pick<Student, 'stt' | 'dob' | 'class_code' | 'note' | 'is_active'>>;

export function useSaveStudent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, values }: { id?: string; values: NewStudent }) => {
      if (id) {
        const { data, error } = await supabase.from('students').update(values).eq('id', id).select();
        if (error) throw new Error(friendlyError(error.message));
        return assertChanged(data, 'Không lưu được sinh viên')[0] as Student;
      }
      const { data, error } = await supabase.from('students').insert(values).select();
      if (error) throw new Error(friendlyError(error.message));
      return assertChanged(data, 'Không thêm được sinh viên')[0] as Student;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['students'] });
      void qc.invalidateQueries({ queryKey: ['debts'] });
      void qc.invalidateQueries({ queryKey: qk.progress });
      void qc.invalidateQueries({ queryKey: qk.audit });
    },
  });
}

export type NewPeriod = Pick<Period, 'name' | 'fund' | 'amount_per_student' | 'open_date'> &
  Partial<Pick<Period, 'due_date' | 'status' | 'note'>>;

export function useSavePeriod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, values }: { id?: string; values: Partial<NewPeriod> }) => {
      if (id) {
        const { data, error } = await supabase.from('periods').update(values).eq('id', id).select();
        if (error) throw new Error(friendlyError(error.message));
        return assertChanged(data, 'Không lưu được đợt thu')[0] as Period;
      }
      const { data, error } = await supabase.from('periods').insert(values as NewPeriod).select();
      if (error) throw new Error(friendlyError(error.message));
      return assertChanged(data, 'Không tạo được đợt thu')[0] as Period;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.periods });
      void qc.invalidateQueries({ queryKey: qk.progress });
      void qc.invalidateQueries({ queryKey: ['debts'] });
      void qc.invalidateQueries({ queryKey: qk.audit });
    },
  });
}

export function useSaveSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: Partial<ClassSettings>) => {
      const { data, error } = await supabase.from('class_settings')
        .update({ ...values, updated_at: new Date().toISOString() }).eq('id', 1).select();
      if (error) throw new Error(friendlyError(error.message));
      return assertChanged(data, 'Không lưu được cấu hình lớp')[0] as ClassSettings;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.settings });
      void qc.invalidateQueries({ queryKey: qk.classInfo });
      void qc.invalidateQueries({ queryKey: qk.audit });
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

export function useImportStudents() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ rows, dedupe }: { rows: unknown[]; dedupe: 'skip' | 'update' | 'insert' }) => {
      const { data, error } = await supabase.rpc('import_students', { p_rows: rows, p_dedupe: dedupe });
      if (error) throw new Error(friendlyError(error.message));
      return data as ImportResult;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['students'] });
      void qc.invalidateQueries({ queryKey: ['debts'] });
      void qc.invalidateQueries({ queryKey: qk.progress });
      void qc.invalidateQueries({ queryKey: qk.audit });
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
      void qc.invalidateQueries({ queryKey: qk.progress });
      void qc.invalidateQueries({ queryKey: qk.audit });
    },
  });
}

export function useInviteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: Pick<Invite, 'email' | 'role'> & Partial<Pick<Invite, 'student_id' | 'note'>>) => {
      const { data, error } = await supabase.from('invites').insert(values).select();
      if (error) throw new Error(friendlyError(error.message));
      return assertChanged(data, 'Không tạo được lời mời')[0] as Invite;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.invites });
      void qc.invalidateQueries({ queryKey: qk.audit });
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
      void qc.invalidateQueries({ queryKey: qk.invites });
      void qc.invalidateQueries({ queryKey: qk.audit });
    },
  });
}

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, values }: { id: string; values: Partial<Profile> }) => {
      const { data, error } = await supabase.from('profiles').update(values).eq('id', id).select();
      if (error) throw new Error(friendlyError(error.message));
      return assertChanged(data, 'Không cập nhật được tài khoản')[0] as Profile;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.profiles });
      void qc.invalidateQueries({ queryKey: qk.audit });
    },
  });
}

/** Ghi log EXPORT / IMPORT / VIEW_QR — không được cản trở việc chính nếu thất bại. */
export async function logEvent(action: 'EXPORT' | 'IMPORT' | 'VIEW_QR', summary: string, meta?: unknown) {
  const { error } = await supabase.rpc('log_event', { p_action: action, p_summary: summary, p_meta: meta ?? null });
  if (error) console.warn('Không ghi được audit log:', error.message);
}

export type { UseQueryOptions, Fund };
