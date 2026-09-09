import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowDownCircle, ArrowUpCircle, CalendarRange, FileSpreadsheet, LayoutGrid, LogIn, LogOut,
  Menu, Moon, ScrollText, Settings, ShieldCheck, Sun, SunMoon, Users, X,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '@/app/AuthProvider';
import { usePrefs } from '@/app/ThemeProvider';
import { useToast } from '@/app/ToastProvider';
import { Badge, Button } from '@/components/ui';
import { can } from '@/lib/permissions';
import { DUR, EASE } from '@/lib/motion';
import { useClassInfo } from '@/data/api';
import { ROLE_LABEL } from '@/types/db';

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  show: boolean;
}

export default function Layout({ children }: { children: ReactNode }) {
  const { role, profile, signOut } = useAuth();
  const prefs = usePrefs();
  const toast = useToast();
  const { data: info } = useClassInfo(role);
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();

  useEffect(() => setMenuOpen(false), [location.pathname]);

  const items: NavItem[] = [
    { to: '/', label: 'Tổng quan', icon: <LayoutGrid className="h-5 w-5" />, show: true },
    { to: '/lop', label: 'Danh sách lớp', icon: <Users className="h-5 w-5" />, show: true },
    { to: '/thu', label: 'Thu', icon: <ArrowUpCircle className="h-5 w-5" />, show: true },
    { to: '/chi', label: 'Chi', icon: <ArrowDownCircle className="h-5 w-5" />, show: true },
    { to: '/dot-thu', label: 'Đợt thu', icon: <CalendarRange className="h-5 w-5" />, show: true },
    { to: '/nhap-xuat', label: 'Nhập / Xuất', icon: <FileSpreadsheet className="h-5 w-5" />, show: can.exportExcel(role) },
    { to: '/tai-khoan', label: 'Tài khoản', icon: <ShieldCheck className="h-5 w-5" />, show: can.manageUsers(role) },
    { to: '/lich-su', label: 'Lịch sử thao tác', icon: <ScrollText className="h-5 w-5" />, show: can.viewAudit(role) },
    { to: '/cai-dat', label: 'Cài đặt', icon: <Settings className="h-5 w-5" />, show: role !== 'guest' },
  ];

  const ThemeIcon = prefs.theme === 'light' ? Sun : prefs.theme === 'dark' ? Moon : SunMoon;

  const nav = (
    <nav className="flex h-full flex-col gap-1 overflow-y-auto p-3" aria-label="Điều hướng chính">
      <div className="flex items-center gap-3 px-2 pb-4">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-[11px] bg-gradient-to-br
          from-lop to-doan font-head text-[1.05rem] font-bold text-white shadow-s1" aria-hidden>
          QL
        </div>
        <div className="min-w-0">
          <div className="font-head text-[1.05rem] font-bold leading-tight">Quỹ Lớp</div>
          <div className="truncate text-xs text-ink3">
            {info?.class_name ? info.class_name : 'Chưa có thông tin lớp'}
          </div>
        </div>
      </div>

      {items.filter((i) => i.show).map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === '/'}
          className={({ isActive }) =>
            `relative flex min-h-[44px] items-center gap-2.5 rounded-[10px] px-3 text-sm font-medium
             transition-colors ${isActive ? 'bg-brandSoft text-brandInk font-semibold' : 'text-ink2 hover:bg-surface2 hover:text-ink'}`}
        >
          {({ isActive }) => (
            <>
              {isActive && (
                <motion.span
                  layoutId="nav-indicator"
                  className="absolute -left-3 h-6 w-[3px] rounded-r bg-brand"
                  transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                />
              )}
              {item.icon}
              {item.label}
            </>
          )}
        </NavLink>
      ))}

      <div className="mt-auto space-y-2 border-t border-line pt-3">
        {profile ? (
          <div className="rounded-[10px] bg-surface2 p-3">
            <div className="truncate text-sm font-semibold">{profile.full_name || profile.email}</div>
            <div className="mt-1 flex items-center gap-2">
              <Badge tone={role === 'owner' || role === 'admin' ? 'brand' : role === 'treasurer' ? 'ok' : 'neutral'}>
                {ROLE_LABEL[role]}
              </Badge>
              <Link to="/toi" className="text-xs text-ink3 underline hover:text-ink">Tài khoản của tôi</Link>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="mt-2 w-full justify-start"
              icon={<LogOut className="h-4 w-4" />}
              onClick={() => {
                void signOut().then(() => toast.ok('Đã đăng xuất'));
              }}
            >
              Đăng xuất
            </Button>
          </div>
        ) : (
          <div className="rounded-[10px] bg-surface2 p-3">
            <div className="text-sm font-semibold">Bạn đang xem với tư cách khách</div>
            <p className="mt-1 text-xs text-ink3">Xem được mọi số liệu, nhưng không thay đổi được gì.</p>
            <Link
              to="/dang-nhap"
              className="mt-2 flex min-h-[32px] items-center justify-center gap-1.5 rounded-[10px]
                bg-brand px-2.5 text-[13px] font-medium text-white shadow-s1 hover:brightness-110"
            >
              <LogIn className="h-4 w-4" aria-hidden /> Đăng nhập
            </Link>
          </div>
        )}
      </div>
    </nav>
  );

  return (
    <div className="grid min-h-screen lg:grid-cols-[246px_1fr]">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-[300]
        focus:rounded focus:bg-surface focus:px-3 focus:py-2 focus:shadow-s2">
        Bỏ qua tới nội dung chính
      </a>

      {/* Sidebar cố định trên máy tính */}
      <aside className="sticky top-0 hidden h-screen border-r border-line bg-surface lg:block">{nav}</aside>

      {/* Sidebar dạng trượt trên điện thoại */}
      <AnimatePresence>
        {menuOpen && (
          <>
            <motion.div
              className="fixed inset-0 z-[70] bg-[rgb(9_11_16/0.5)] lg:hidden"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setMenuOpen(false)}
            />
            <motion.aside
              className="fixed inset-y-0 left-0 z-[80] w-[262px] border-r border-line bg-surface shadow-s2 lg:hidden"
              initial={{ x: '-104%' }} animate={{ x: 0 }} exit={{ x: '-104%' }}
              transition={{ duration: DUR.slow, ease: EASE.out }}
            >
              <div className="flex justify-end p-2">
                <Button variant="ghost" size="sm" aria-label="Đóng menu" onClick={() => setMenuOpen(false)}>
                  <X className="h-5 w-5" />
                </Button>
              </div>
              {nav}
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex flex-wrap items-center gap-2 border-b border-line
          bg-surface/80 px-4 py-3 backdrop-blur-md no-print">
          <Button
            variant="ghost" size="sm" className="lg:hidden" aria-label="Mở menu"
            aria-expanded={menuOpen} onClick={() => setMenuOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </Button>
          <h1 className="font-head text-[1.25rem] font-semibold">
            {items.find((i) => i.to === location.pathname)?.label ?? 'Quỹ Lớp'}
          </h1>
          <div className="flex-1" />
          <Button
            variant="ghost" size="sm" aria-label="Đổi giao diện sáng/tối"
            title={`Giao diện: ${prefs.theme === 'auto' ? 'theo hệ thống' : prefs.theme === 'light' ? 'sáng' : 'tối'}`}
            onClick={prefs.cycleTheme}
          >
            <ThemeIcon className="h-5 w-5" />
          </Button>
        </header>

        <main id="main" tabIndex={-1} className="w-full max-w-[1500px] p-4">
          {children}
        </main>
      </div>
    </div>
  );
}
