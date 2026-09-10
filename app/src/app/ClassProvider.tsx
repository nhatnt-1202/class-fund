/**
 * Lớp đang xem.
 *
 * Toàn bộ app luôn làm việc trong phạm vi MỘT lớp: mọi hook dữ liệu nhận classId từ đây, và
 * vai trò hiển thị (`role`) là vai trò của người dùng TRONG LỚP ĐÓ — không phải vai trò hệ
 * thống. Nhờ vậy một người có thể là thủ quỹ lớp A nhưng chỉ là thành viên lớp B.
 *
 * Khách chưa đăng nhập chọn lớp từ danh sách công khai; người đã đăng nhập chỉ thấy những
 * lớp mình thuộc (RLS lọc), riêng chủ sở hữu hệ thống thấy tất cả.
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from './AuthProvider';
import { useKlass, useMyClasses, usePublicClasses, type MyClass } from '@/data/api';
import { setTrackedClass } from '@/lib/visits';
import type { Klass, UiRole } from '@/types/db';

export interface ClassOption {
  id: string;
  code: string;
  name: string;
  studentCount?: number;
  myRole?: MyClass['myRole'];
}

interface Ctx {
  loading: boolean;
  /** null khi chưa chọn được lớp nào (chưa có lớp, hoặc chưa tải xong). */
  classId: string | null;
  setClassId: (id: string) => void;
  options: ClassOption[];
  klass: Klass | null;
  /** Vai trò TRONG LỚP đang xem. 'guest' khi chưa đăng nhập. */
  role: UiRole;
  isSystemOwner: boolean;
  myStudentId: string | null;
  hasNoClass: boolean;
  refetch: () => void;
}

const KEY = 'quylop.classId';
const Ctx = createContext<Ctx>({} as Ctx);

export function ClassProvider({ children }: { children: ReactNode }) {
  const { session, profile, loading: authLoading } = useAuth();
  const isSystemOwner = profile?.role === 'owner';
  const signedIn = Boolean(session && profile?.is_active);

  const mine = useMyClasses(signedIn, isSystemOwner, profile?.id ?? null);
  const publicList = usePublicClasses();

  const options = useMemo<ClassOption[]>(() => {
    if (signedIn) {
      return (mine.data ?? []).map((c) => ({ id: c.id, code: c.code, name: c.name, myRole: c.myRole }));
    }
    return (publicList.data ?? []).map((c) => ({
      id: c.class_id, code: c.code, name: c.name, studentCount: c.student_count,
    }));
  }, [signedIn, mine.data, publicList.data]);

  const [classId, setClassIdState] = useState<string | null>(() => {
    try {
      return localStorage.getItem(KEY);
    } catch {
      return null;
    }
  });

  // Lớp đã lưu có thể không còn thuộc về mình (bị chuyển lớp, mất quyền) ⇒ về lớp đầu tiên
  useEffect(() => {
    if (options.length === 0) return;
    if (classId && options.some((o) => o.id === classId)) return;
    setClassIdState(options[0]!.id);
  }, [options, classId]);

  const setClassId = (id: string) => {
    setClassIdState(id);
    try {
      localStorage.setItem(KEY, id);
    } catch {
      /* trình duyệt chặn lưu — chỉ mất việc nhớ lớp đã chọn */
    }
  };

  const current = signedIn ? (mine.data ?? []).find((c) => c.id === classId) : undefined;

  // Bộ đếm lượt truy cập nằm ngoài provider này (nó phải chạy cả ở trang đăng nhập) nên
  // lớp đang xem được đẩy sang bằng biến module thay vì context.
  useEffect(() => {
    setTrackedClass(options.some((o) => o.id === classId) ? classId : options[0]?.id ?? null);
  }, [classId, options]);

  // Tài khoản gốc luôn ở vai 'owner' (cao hơn quản trị lớp) dù ở lớp nào: nó là vai hệ thống,
  // không phải vai trong lớp. Người thường thì lấy đúng vai trò của mình TRONG lớp đang xem.
  const role: UiRole = !signedIn
    ? 'guest'
    : isSystemOwner
      ? 'owner'
      : current?.myRole ?? 'member';

  /*
   * Khách không đọc được bảng classes (RLS), nên thông tin lớp của họ phải lấy từ view công
   * khai — trong đó có tài khoản nhận tiền để tự sinh QR chuyển khoản. Thiếu bước này thì
   * `klass` luôn null với khách và mọi mã QR đều không vẽ được.
   */
  const publicKlass = useKlass(signedIn ? null : classId, 'guest');

  const loading = authLoading || (signedIn ? mine.isLoading : publicList.isLoading);

  const value = useMemo<Ctx>(() => ({
    loading,
    classId: options.some((o) => o.id === classId) ? classId : options[0]?.id ?? null,
    setClassId,
    options,
    klass: (signedIn ? current : publicKlass.data) ?? null,
    role,
    isSystemOwner: Boolean(isSystemOwner),
    myStudentId: current?.myStudentId ?? null,
    hasNoClass: !loading && options.length === 0,
    refetch: () => {
      void mine.refetch();
      void publicList.refetch();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [loading, classId, options, current, publicKlass.data, role, isSystemOwner]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Lớp đang xem + vai trò của tôi trong lớp đó. */
export const useKlassContext = () => useContext(Ctx);
