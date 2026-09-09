import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AnimatePresence } from 'framer-motion';
import { Suspense, lazy } from 'react';
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import Layout from '@/components/Layout';
import { Button, Card, Note } from '@/components/ui';
import { isConfigured } from '@/lib/supabase';
import { AuthProvider, useAuth } from './AuthProvider';
import { ClassProvider, useKlassContext } from './ClassProvider';
import { PrefsProvider } from './PrefsProvider';
import { ToastProvider } from './ToastProvider';
import { ForgotPasswordPage, LoginPage, ResetPasswordPage, SignupPage } from '@/features/auth/AuthPages';
import ProfilePage from '@/features/auth/ProfilePage';
import ClassesPage from '@/features/classes/ClassesPage';
import DashboardPage from '@/features/dashboard/DashboardPage';
import ExpensesPage from '@/features/expenses/ExpensesPage';
import IncomesPage from '@/features/incomes/IncomesPage';
import PeriodsPage from '@/features/periods/PeriodsPage';
import SettingsPage from '@/features/settings/SettingsPage';
import StudentsPage from '@/features/students/StudentsPage';

/**
 * Ba trang này nạp riêng: trang Nhập/Xuất kéo theo thư viện Excel (~800KB) mà phần lớn
 * người dùng không mở tới, còn Tài khoản và Lịch sử thao tác chỉ dành cho quản trị.
 */
const ImportExportPage = lazy(() => import('@/features/io/ImportExportPage'));
const UsersPage = lazy(() => import('@/features/users/UsersPage'));
const AuditPage = lazy(() => import('@/features/audit/AuditPage'));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

/** Chặn ở tầng giao diện cho gọn; quyền thật do RLS trong Postgres thực thi. */
function RequireLogin({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth();
  if (loading) return null;
  if (!session) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

/** Khung chờ khi nạp trang tách riêng — giữ hình dáng nội dung, không dùng spinner toàn trang. */
function Lazy({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={
      <div className="space-y-3" aria-busy="true" aria-label="Đang tải trang">
        <div className="skel h-8 w-1/3" />
        <div className="skel h-40" />
      </div>
    }>
      {children}
    </Suspense>
  );
}

/**
 * Toàn bộ app luôn làm việc trong phạm vi một lớp, nên khi chưa có lớp nào để xem thì các
 * trang số liệu chỉ hiện bảng trống vô nghĩa. Cổng này nói rõ việc cần làm tiếp, khác nhau
 * theo vai trò: tài khoản gốc thì mở lớp, người khác thì chờ được gán vào lớp.
 */
function ClassGate({ children }: { children: React.ReactNode }) {
  const { loading, hasNoClass, isSystemOwner } = useKlassContext();
  const { session } = useAuth();
  const location = useLocation();

  // Trang quản lý lớp và trang tài khoản của tôi phải vào được kể cả khi chưa có lớp nào
  const bypass = location.pathname === '/classes' || location.pathname === '/profile';
  if (loading || !hasNoClass || bypass) return <>{children}</>;

  if (isSystemOwner) {
    return (
      <Card className="p-6">
        <h2 className="font-head text-lg font-semibold">Chưa có lớp nào</h2>
        <p className="mt-1 text-sm text-ink3">
          Bạn là tài khoản gốc: hãy mở lớp đầu tiên và giao nó cho một tài khoản quản trị. Từ đó
          họ tự nhập danh sách lớp và thu chi trong lớp của họ.
        </p>
        <Link to="/classes" className="mt-4 inline-block">
          <Button variant="primary">Mở lớp mới</Button>
        </Link>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <h2 className="font-head text-lg font-semibold">
        {session ? 'Tài khoản của bạn chưa thuộc lớp nào' : 'Chưa có lớp nào được công khai'}
      </h2>
      <Note tone="info">
        <span>
          {session ? (
            <>
              Hai lý do thường gặp: lớp của bạn <b>chưa nhập danh sách sinh viên</b> nên hệ thống chưa
              khớp được mã sinh viên trong email của bạn, hoặc bạn cần <b>quản trị lớp thêm bạn vào lớp</b>.
              Nhập danh sách xong là tài khoản của bạn tự vào lớp, không cần đăng ký lại.
            </>
          ) : (
            <>Hãy chờ quản trị lớp mở lớp và nhập danh sách, hoặc đăng nhập bằng email trường của bạn.</>
          )}
        </span>
      </Note>
    </Card>
  );
}

/**
 * Đường dẫn tiếng Việt của các bản trước.
 *
 * Giữ lại vì link đã được gửi cho sinh viên (và cả link đặt lại mật khẩu trong hộp thư của
 * họ) vẫn phải mở đúng trang, không phải rơi về trang chủ.
 */
const LEGACY_PATHS: Record<string, string> = {
  '/lop': '/students',
  '/thu': '/incomes',
  '/chi': '/expenses',
  '/dot-thu': '/periods',
  '/nhap-xuat': '/import-export',
  '/tai-khoan': '/members',
  '/lich-su': '/audit-log',
  '/cai-dat': '/settings',
  '/lop-hoc': '/classes',
  '/toi': '/profile',
};

/**
 * Chuyển sang đường dẫn mới nhưng GIỮ query và hash: link đặt lại mật khẩu của Supabase mang
 * token trong hash (#access_token=…), mất hash là mất luôn phiên đặt lại.
 */
function LegacyRedirect({ to }: { to: string }) {
  const { search, hash } = useLocation();
  return <Navigate to={`${to}${search}${hash}`} replace />;
}

function AppRoutes() {
  const location = useLocation();
  return (
    <AnimatePresence mode="wait">
      <Routes location={location} key={location.pathname}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/students" element={<StudentsPage />} />
        <Route path="/incomes" element={<IncomesPage />} />
        <Route path="/expenses" element={<ExpensesPage />} />
        <Route path="/periods" element={<PeriodsPage />} />
        <Route path="/import-export" element={<Lazy><ImportExportPage /></Lazy>} />
        <Route path="/members" element={<RequireLogin><Lazy><UsersPage /></Lazy></RequireLogin>} />
        <Route path="/audit-log" element={<RequireLogin><Lazy><AuditPage /></Lazy></RequireLogin>} />
        <Route path="/classes" element={<RequireLogin><ClassesPage /></RequireLogin>} />
        <Route path="/settings" element={<RequireLogin><SettingsPage /></RequireLogin>} />
        <Route path="/profile" element={<RequireLogin><ProfilePage /></RequireLogin>} />
        {Object.entries(LEGACY_PATHS).map(([from, to]) => (
          <Route key={from} path={from} element={<LegacyRedirect to={to} />} />
        ))}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AnimatePresence>
  );
}

function ConfigWarning() {
  return (
    <div className="grid min-h-screen place-items-center p-4">
      <Card className="max-w-[520px] p-6">
        <h1 className="mb-3 font-head text-xl font-semibold">Chưa kết nối Supabase</h1>
        <Note tone="warn">
          <span>
            Chưa có <code>VITE_SUPABASE_URL</code> và <code>VITE_SUPABASE_ANON_KEY</code>.
            Sao <code>.env.example</code> thành <code>.env</code>, điền 2 giá trị lấy ở Supabase Dashboard →
            Project Settings → API, rồi chạy lại <code>npm run dev</code>.
          </span>
        </Note>
        <p className="mt-3 text-sm text-ink3">
          Migrations nằm trong <code>supabase/migrations</code> — chạy <code>supabase db push</code> hoặc dán
          từng file vào SQL Editor theo thứ tự 0001 → 0002 → 0003.
        </p>
      </Card>
    </div>
  );
}

export default function App() {
  return (
    <PrefsProvider>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <AuthProvider>
            {!isConfigured ? (
              <ConfigWarning />
            ) : (
              <BrowserRouter>
                <Routes>
                  <Route path="/login" element={<LoginPage />} />
                  <Route path="/signup" element={<SignupPage />} />
                  <Route path="/forgot-password" element={<ForgotPasswordPage />} />
                  <Route path="/reset-password" element={<ResetPasswordPage />} />
                  {/* Link cũ trong email đặt lại mật khẩu vẫn phải dùng được */}
                  <Route path="/dang-nhap" element={<LegacyRedirect to="/login" />} />
                  <Route path="/dang-ky" element={<LegacyRedirect to="/signup" />} />
                  <Route path="/quen-mat-khau" element={<LegacyRedirect to="/forgot-password" />} />
                  <Route path="/doi-mat-khau" element={<LegacyRedirect to="/reset-password" />} />
                  <Route path="*" element={
                    <ClassProvider>
                      <Layout><ClassGate><AppRoutes /></ClassGate></Layout>
                    </ClassProvider>
                  } />
                </Routes>
              </BrowserRouter>
            )}
          </AuthProvider>
        </ToastProvider>
      </QueryClientProvider>
    </PrefsProvider>
  );
}
