import { motion } from 'framer-motion';
import {
  ArrowDownCircle, ArrowUpCircle, Building2, CalendarRange, FileSpreadsheet, LayoutGrid, LogIn,
  LogOut, Menu, ScrollText, Settings, ShieldCheck, Users, X,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '@/app/AuthProvider';
import { useKlassContext } from '@/app/ClassProvider';
import { useToast } from '@/app/ToastProvider';
import { Badge, Button, Select } from '@/components/ui';
import { can } from '@/lib/permissions';
import { ROLE_LABEL } from '@/types/db';

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  show: boolean;
}

export default function Layout({ children }: { children: ReactNode }) {
  const { profile, signOut } = useAuth();
  const { role, classId, setClassId, options, klass, isSystemOwner } = useKlassContext();
  const toast = useToast();
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();

  useEffect(() => setMenuOpen(false), [location.pathname]);

  const items: NavItem[] = [
    { to: '/', label: 'Tổng quan', icon: <LayoutGrid className="h-5 w-5" />, show: true },
    { to: '/students', label: 'Danh sách lớp', icon: <Users className="h-5 w-5" />, show: true },
    { to: '/incomes', label: 'Thu', icon: <ArrowUpCircle className="h-5 w-5" />, show: true },
    { to: '/expenses', label: 'Chi', icon: <ArrowDownCircle className="h-5 w-5" />, show: true },
    { to: '/periods', label: 'Đợt thu', icon: <CalendarRange className="h-5 w-5" />, show: true },
    { to: '/import-export', label: 'Nhập / Xuất', icon: <FileSpreadsheet className="h-5 w-5" />, show: can.exportExcel(role) },
    // "Thành viên & quyền", không phải "Tài khoản": trong app có tới ba thứ mang chữ tài khoản
    // (tài khoản của tôi, tài khoản nhận chuyển khoản), nên tên này nói rõ trang làm gì.
    { to: '/members', label: 'Thành viên & quyền', icon: <ShieldCheck className="h-5 w-5" />, show: can.manageUsers(role) },
    { to: '/classes', label: 'Quản lý lớp', icon: <Building2 className="h-5 w-5" />, show: can.manageClasses(role) },
    { to: '/audit-log', label: 'Lịch sử thao tác', icon: <ScrollText className="h-5 w-5" />, show: can.viewAudit(role) },
    { to: '/settings', label: 'Cài đặt', icon: <Settings className="h-5 w-5" />, show: role !== 'guest' },
  ];

  /*
   * Nav được render hai chỗ (sidebar máy tính và drawer điện thoại) nên layoutId của vạch
   * chỉ mục phải khác nhau: hai phần tử cùng layoutId làm framer-motion cố animate layout
   * giữa chúng, và một trong hai nằm trong cây đang unmount thì animation treo lại.
   */
  const renderNav = (scope: string) => (
    <nav className="flex h-full flex-col gap-1 overflow-y-auto p-3" aria-label="Điều hướng chính">
      <div className="flex items-center gap-3 px-2 pb-4">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-[11px] bg-gradient-to-br
          from-lop to-doan font-head text-[1.05rem] font-bold text-white shadow-s1" aria-hidden>
          F
        </div>
        <div className="min-w-0">
          <div className="font-head text-[1.05rem] font-bold leading-tight">Finance</div>
          <div className="truncate text-xs text-ink3">Quản lý thu chi quỹ lớp</div>
        </div>
      </div>

      {/* Chọn lớp: mọi số liệu bên dưới đều thuộc lớp đang chọn */}
      <div className="mb-3 px-2">
        <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink3"
          htmlFor="class-switch">
          Lớp đang xem
        </label>
        {options.length > 1 ? (
          <Select id="class-switch" value={classId ?? ''} onChange={(e) => setClassId(e.target.value)}
            className="text-[13px]">
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.code}{o.myRole ? ` · ${ROLE_LABEL[o.myRole]}` : ''}
              </option>
            ))}
          </Select>
        ) : (
          <div id="class-switch"
            className="truncate rounded-[10px] border border-line bg-surface2 px-3 py-2 text-[13px] font-semibold">
            {klass?.code || options[0]?.code || 'Chưa có lớp nào'}
          </div>
        )}
        {isSystemOwner && (
          <p className="mt-1 text-[11px] text-ink3">
            Bạn là tài khoản gốc nên thấy mọi lớp. Quản trị lớp chỉ thấy đúng lớp được giao.
          </p>
        )}
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
                  layoutId={`nav-indicator-${scope}`}
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
              <Link to="/profile" className="text-xs text-ink3 underline hover:text-ink">Tài khoản của tôi</Link>
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
              to="/login"
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
      <aside className="sticky top-0 hidden h-screen border-r border-line bg-surface lg:block">
        {renderNav('sidebar')}
      </aside>

      {/*
        * Sidebar dạng trượt trên điện thoại: xem `.drawer` trong index.css. Luôn có trong
        * DOM, đóng/mở bằng CSS, nên không có đường nào để lớp phủ "kẹt" lại chặn cả trang.
        */}
      <div className="drawer fixed inset-0 z-[70] lg:hidden" data-open={menuOpen} aria-hidden={!menuOpen}>
        <div className="absolute inset-0 bg-[rgb(9_11_16/0.5)]" onClick={() => setMenuOpen(false)} aria-hidden />
        <aside className="drawer-panel absolute inset-y-0 left-0 w-[262px] border-r border-line bg-surface shadow-s2">
          <div className="flex justify-end p-2">
            <Button variant="ghost" size="sm" aria-label="Đóng menu" onClick={() => setMenuOpen(false)}>
              <X className="h-5 w-5" />
            </Button>
          </div>
          {renderNav('drawer')}
        </aside>
      </div>

      <div className="flex min-w-0 flex-col">
        <header className="app-bar sticky top-0 z-30 flex flex-wrap items-center gap-2 border-b border-line
          bg-surface/80 px-4 py-3 backdrop-blur-md no-print">
          <Button
            variant="ghost" size="sm" className="lg:hidden" aria-label="Mở menu"
            aria-expanded={menuOpen} onClick={() => setMenuOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </Button>
          <h1 className="font-head text-[1.25rem] font-semibold">
            {items.find((i) => i.to === location.pathname)?.label ?? 'Finance'}
          </h1>
          <div className="flex-1" />
          {/*
            * Nút đăng nhập phải có trên thanh tiêu đề, không chỉ trong sidebar: trên điện
            * thoại sidebar là drawer bị ẩn, nên khách sẽ không thấy đường nào để đăng nhập.
            */}
          {!profile && (
            <Link
              to="/login"
              className="flex h-8 items-center gap-1.5 rounded-[10px] bg-brand px-2.5 text-[13px]
                font-medium text-white shadow-s1 hover:brightness-110"
            >
              <LogIn className="h-4 w-4" aria-hidden /> Đăng nhập
            </Link>
          )}
        </header>

        <main id="main" tabIndex={-1} className="w-full max-w-[1500px] p-4">
          {children}
        </main>
      </div>
    </div>
  );
}
