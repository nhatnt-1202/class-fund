import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AnimatePresence } from 'framer-motion';
import { Suspense, lazy } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import Layout from '@/components/Layout';
import { Card, Note } from '@/components/ui';
import { isConfigured } from '@/lib/supabase';
import { AuthProvider, useAuth } from './AuthProvider';
import { ThemeProvider } from './ThemeProvider';
import { ToastProvider } from './ToastProvider';
import { ForgotPasswordPage, LoginPage, ResetPasswordPage, SignupPage } from '@/features/auth/AuthPages';
import ProfilePage from '@/features/auth/ProfilePage';
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
  if (!session) return <Navigate to="/dang-nhap" replace />;
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

function AppRoutes() {
  const location = useLocation();
  return (
    <AnimatePresence mode="wait">
      <Routes location={location} key={location.pathname}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/lop" element={<StudentsPage />} />
        <Route path="/thu" element={<IncomesPage />} />
        <Route path="/chi" element={<ExpensesPage />} />
        <Route path="/dot-thu" element={<PeriodsPage />} />
        <Route path="/nhap-xuat" element={<Lazy><ImportExportPage /></Lazy>} />
        <Route path="/tai-khoan" element={<RequireLogin><Lazy><UsersPage /></Lazy></RequireLogin>} />
        <Route path="/lich-su" element={<RequireLogin><Lazy><AuditPage /></Lazy></RequireLogin>} />
        <Route path="/cai-dat" element={<RequireLogin><SettingsPage /></RequireLogin>} />
        <Route path="/toi" element={<RequireLogin><ProfilePage /></RequireLogin>} />
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
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <AuthProvider>
            {!isConfigured ? (
              <ConfigWarning />
            ) : (
              <BrowserRouter>
                <Routes>
                  <Route path="/dang-nhap" element={<LoginPage />} />
                  <Route path="/dang-ky" element={<SignupPage />} />
                  <Route path="/quen-mat-khau" element={<ForgotPasswordPage />} />
                  <Route path="/doi-mat-khau" element={<ResetPasswordPage />} />
                  <Route path="*" element={<Layout><AppRoutes /></Layout>} />
                </Routes>
              </BrowserRouter>
            )}
          </AuthProvider>
        </ToastProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
