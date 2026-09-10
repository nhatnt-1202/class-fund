/**
 * Lượt truy cập — trang giám sát của quản trị.
 *
 * Trả lời đúng ba câu hỏi, theo thứ tự đó:
 *   1. Có bao nhiêu người vào web (và bao nhiêu trong số đó là khách chưa đăng nhập)?
 *   2. Họ vào lúc nào, ở lại bao lâu?
 *   3. Từng lượt cụ thể là ai, từ máy nào, xem trang gì?
 *
 * "Lượt truy cập" = một PHIÊN (một lần mở app), không phải một lượt xem trang: mở app rồi
 * bấm qua 8 trang vẫn là MỘT người vào, đếm thành 8 là tự phóng đại.
 *
 * Trang này chứa dữ liệu cá nhân của khách (IP, trình duyệt). Đó là lựa chọn có ý thức của
 * chủ hệ thống; đổi lại RLS chỉ cho quản trị đọc, và có nút xoá dữ liệu cũ ở cuối trang.
 */
import { motion } from 'framer-motion';
import { RefreshCw, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useKlassContext } from '@/app/ClassProvider';
import { useToast } from '@/app/ToastProvider';
import {
  Badge, Button, Card, CardHead, Chip, ConfirmModal, EmptyState, Note, Select, TableSkeleton, TableWrap,
} from '@/components/ui';
import {
  usePurgeVisits, useVisitDaily, useVisitPaths, useVisitSessions, useVisitSummary,
} from '@/data/api';
import { fmtDateTime, fmtDuration, fmtNum, fmtRelative } from '@/lib/format';
import { can } from '@/lib/permissions';
import { pageVariants, rowStagger } from '@/lib/motion';
import { ROLE_LABEL } from '@/types/db';
import VisitBars, { type DayPoint } from './VisitBars';

const RANGES = [7, 30, 90] as const;

/** Đường dẫn → tên trang người đọc hiểu ngay. Trang lạ thì hiện nguyên đường dẫn. */
const PAGE_LABEL: Record<string, string> = {
  '/': 'Tổng quan', '/students': 'Danh sách lớp', '/incomes': 'Thu', '/expenses': 'Chi',
  '/periods': 'Đợt thu', '/import-export': 'Nhập / Xuất', '/members': 'Thành viên & quyền',
  '/classes': 'Quản lý lớp', '/audit-log': 'Lịch sử thao tác', '/visits': 'Lượt truy cập',
  '/settings': 'Cài đặt', '/profile': 'Tài khoản của tôi', '/login': 'Đăng nhập',
  '/signup': 'Đăng ký', '/forgot-password': 'Quên mật khẩu', '/reset-password': 'Đặt lại mật khẩu',
};
const pageName = (p: string) => PAGE_LABEL[p] ?? (p || '—');

/**
 * Đoán thiết bị từ user agent. Cố ý thô: chỉ cần biết "điện thoại hay máy tính, trình duyệt
 * nào" để hiểu người dùng đang xem quỹ lớp bằng gì — không phải để nhận dạng một người.
 */
function deviceOf(ua: string): string {
  if (!ua) return '—';
  const mobile = /iPhone|Android.+Mobile|Windows Phone/i.test(ua);
  const tablet = /iPad|Android(?!.+Mobile)|Tablet/i.test(ua);
  const os = /iPhone|iPad|iPod/i.test(ua) ? 'iOS'
    : /Android/i.test(ua) ? 'Android'
      : /Windows/i.test(ua) ? 'Windows'
        : /Mac OS X/i.test(ua) ? 'macOS'
          : /Linux/i.test(ua) ? 'Linux' : 'Khác';
  const browser = /Edg\//i.test(ua) ? 'Edge'
    : /OPR\/|Opera/i.test(ua) ? 'Opera'
      : /Chrome\//i.test(ua) ? 'Chrome'
        : /Firefox\//i.test(ua) ? 'Firefox'
          : /Safari\//i.test(ua) ? 'Safari' : 'Khác';
  const kind = mobile ? 'Điện thoại' : tablet ? 'Máy tính bảng' : 'Máy tính';
  return `${kind} · ${os} · ${browser}`;
}

/** Số giây một phiên kéo dài. Phiên chỉ mở một trang rồi đi thì bằng 0 — đó là sự thật. */
const secondsOf = (from: string, to: string) =>
  Math.max(0, (new Date(to).getTime() - new Date(from).getTime()) / 1000);

/** 'YYYY-MM-DD' của n ngày trước, theo giờ Việt Nam để khớp cách DB cắt ngày. */
function dayKey(offsetDays: number): string {
  const ms = Date.now() - offsetDays * 86_400_000 + 7 * 3_600_000;
  return new Date(ms).toISOString().slice(0, 10);
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="p-4">
      <div className="text-[0.78rem] font-semibold uppercase tracking-wider text-ink3">{label}</div>
      <div className="mt-1 font-head text-[1.9rem] font-bold leading-tight">{value}</div>
      {hint && <p className="mt-1 text-[13px] text-ink3">{hint}</p>}
    </Card>
  );
}

export default function VisitsPage() {
  const { role, options, isSystemOwner } = useKlassContext();
  const toast = useToast();
  const qc = useQueryClient();
  const allowed = can.viewVisits(role);
  const [days, setDays] = useState<number>(30);
  const [scope, setScope] = useState<string>('');       // '' = mọi lớp mình được xem
  const [confirmPurge, setConfirmPurge] = useState(false);

  const classId = scope || null;
  const summary = useVisitSummary(days, allowed, classId);
  const daily = useVisitDaily(days, allowed, classId);
  const sessions = useVisitSessions(days, allowed, classId);
  const paths = useVisitPaths(days, allowed, classId);
  const purge = usePurgeVisits();

  const classCode = useMemo(
    () => new Map(options.map((o) => [o.id, o.code])),
    [options],
  );

  // Ngày không có ai vào vẫn phải là một cột 0 — bỏ trống sẽ làm biểu đồ nói dối về nhịp độ.
  const points = useMemo<DayPoint[]>(() => {
    const byDay = new Map<string, DayPoint>();
    for (const r of daily.data ?? []) {
      const cur = byDay.get(r.day) ?? { day: r.day, sessions: 0, guests: 0, pageviews: 0 };
      cur.sessions += Number(r.sessions);
      cur.guests += Number(r.guest_sessions);
      cur.pageviews += Number(r.pageviews);
      byDay.set(r.day, cur);
    }
    return Array.from({ length: days }, (_, i) => {
      const day = dayKey(days - 1 - i);
      return byDay.get(day) ?? { day, sessions: 0, guests: 0, pageviews: 0 };
    });
  }, [daily.data, days]);

  const topPaths = useMemo(() => {
    const byPath = new Map<string, number>();
    for (const r of paths.data ?? []) byPath.set(r.path, (byPath.get(r.path) ?? 0) + Number(r.views));
    return Array.from(byPath, ([path, views]) => ({ path, views }))
      .sort((a, b) => b.views - a.views).slice(0, 10);
  }, [paths.data]);

  if (!allowed) {
    return (
      <Card className="p-6">
        <Note tone="warn">
          <span>
            Trang này chỉ dành cho quản trị. Số liệu truy cập là công cụ giám sát nên không mở
            cho thủ quỹ hay thành viên — cơ sở dữ liệu cũng chặn, không chỉ ẩn trang.
          </span>
        </Note>
      </Card>
    );
  }

  const s = summary.data;
  const avgSeconds = s && s.sessions > 0 ? s.seconds / s.sessions : 0;
  const guestPct = s && s.sessions > 0 ? Math.round((s.guest_sessions / s.sessions) * 100) : 0;
  const loading = summary.isLoading || daily.isLoading;

  return (
    <motion.div variants={pageVariants} initial="hidden" animate="show" className="space-y-4">
      <Card>
        <CardHead
          title="Lượt truy cập"
          sub={isSystemOwner
            ? 'Toàn hệ thống. Một lượt = một lần mở app, tính cả khách chưa đăng nhập.'
            : 'Lượt truy cập vào lớp bạn quản trị. Một lượt = một lần mở app, tính cả khách chưa đăng nhập.'}
          actions={
            <Button
              size="sm" variant="ghost" icon={<RefreshCw className="h-4 w-4" />}
              onClick={() => { void qc.invalidateQueries({ queryKey: ['visits'] }); }}
            >
              Làm mới
            </Button>
          }
        />
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          {RANGES.map((r) => (
            <Chip key={r} className="filter-action" on={days === r} onClick={() => setDays(r)}>
              {r} ngày gần nhất
            </Chip>
          ))}
          {options.length > 1 && (
            <>
              <label className="sr-only" htmlFor="vs-class">Lọc theo lớp</label>
              <Select id="vs-class" className="filter-field" value={scope} onChange={(e) => setScope(e.target.value)}>
                {/* Nhãn ngắn: ô lọc rộng cố định 200px, chữ dài hơn sẽ bị cắt ngay trong ô */}
                <option value="">{isSystemOwner ? 'Mọi lớp' : 'Lớp tôi quản trị'}</option>
                {options.map((o) => <option key={o.id} value={o.id}>{o.code}</option>)}
              </Select>
            </>
          )}
        </div>

        <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4">
          <Tile
            label="Đang xem lúc này"
            value={fmtNum(s?.online ?? 0)}
            hint="Có dấu hiệu hoạt động trong 5 phút qua"
          />
          <Tile
            label="Lượt truy cập"
            value={fmtNum(s?.sessions ?? 0)}
            hint={`${fmtNum(s?.pageviews ?? 0)} lượt xem trang`}
          />
          <Tile
            label="Máy khác nhau"
            value={fmtNum(s?.visitors ?? 0)}
            hint={`${fmtNum(s?.guest_visitors ?? 0)} máy của khách · ${fmtNum(s?.accounts ?? 0)} tài khoản đăng nhập`}
          />
          <Tile
            label="Ở lại trung bình"
            value={fmtDuration(avgSeconds)}
            hint={`${guestPct}% số lượt là khách chưa đăng nhập`}
          />
        </div>
      </Card>

      {/* Biểu đồ và bảng xếp hạng trang đứng cạnh nhau; bảng từng lượt cần cả bề ngang
          vì có 8 cột, nhét vào nửa màn hình là phải cuộn ngang mới thấy IP. */}
      <div className="grid gap-4 lg:grid-cols-[1.7fr_1fr]">
        <Card>
          <CardHead title={`Lượt truy cập mỗi ngày · ${days} ngày gần nhất`}
            sub="Cột là số lần mở app trong ngày (giờ Việt Nam). Rê chuột để xem chi tiết từng ngày." />
          <div className="p-4">
            {loading ? <div className="skel h-[132px]" /> : <VisitBars points={points} />}
          </div>
        </Card>

        <Card>
          <CardHead title="Trang được xem nhiều nhất" />
          {paths.isLoading ? (
            <TableSkeleton rows={5} cols={2} />
          ) : topPaths.length === 0 ? (
            <EmptyState title="Chưa có lượt xem trang nào" />
          ) : (
            <TableWrap>
              <table>
                <caption className="sr-only">Trang được xem nhiều nhất</caption>
                <thead><tr><th>Trang</th><th className="text-right">Lượt xem</th></tr></thead>
                <tbody>
                  {topPaths.map((p) => (
                    <tr key={p.path}>
                      <td>
                        {pageName(p.path)}
                        <span className="ml-2 text-xs text-ink3">{p.path}</span>
                      </td>
                      <td className="num text-right font-semibold">{fmtNum(p.views)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>
      </div>

      <Card>
        <CardHead
          title="Từng lượt truy cập"
          sub="Mới nhất trước, tối đa 300 lượt gần đây trong khoảng đang xem."
        />
        {sessions.isLoading ? (
          <TableSkeleton rows={8} cols={5} />
        ) : (sessions.data ?? []).length === 0 ? (
          <EmptyState title="Chưa có lượt truy cập nào trong khoảng này" />
        ) : (
          <TableWrap>
            <table>
              <caption className="sr-only">Danh sách từng lượt truy cập</caption>
              <thead>
                <tr>
                  <th>Bắt đầu</th>
                  <th>Ai</th>
                  <th>Lớp</th>
                  <th className="text-right">Trang</th>
                  <th className="text-right">Ở lại</th>
                  <th>Thiết bị</th>
                  <th>IP</th>
                  <th>Trang cuối</th>
                </tr>
              </thead>
              <tbody>
                {(sessions.data ?? []).map((v, i) => (
                  <motion.tr key={v.id} {...rowStagger(i)}>
                    <td className="whitespace-nowrap">
                      <time dateTime={v.started_at} title={fmtDateTime(v.started_at)}>
                        {fmtRelative(v.started_at)}
                      </time>
                    </td>
                    <td>
                      {v.user_id
                        ? <Badge tone="brand">{ROLE_LABEL[v.role] ?? 'Đã đăng nhập'}</Badge>
                        : <Badge tone="neutral">Khách</Badge>}
                    </td>
                    <td className="whitespace-nowrap">{v.class_id ? classCode.get(v.class_id) ?? '—' : '—'}</td>
                    <td className="num text-right">{fmtNum(v.views)}</td>
                    <td className="num whitespace-nowrap text-right">
                      {fmtDuration(secondsOf(v.started_at, v.last_seen_at))}
                    </td>
                    <td className="whitespace-nowrap text-xs text-ink2">{deviceOf(v.user_agent)}</td>
                    <td className="num whitespace-nowrap text-xs text-ink2">{v.ip ?? '—'}</td>
                    <td className="whitespace-nowrap text-xs text-ink2">{pageName(v.last_path)}</td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>

      {can.grantOwner(role) && (
        <Card className="p-4">
          <h3 className="font-head text-[1.05rem] font-semibold">Dọn dữ liệu truy cập</h3>
          <p className="mt-1 text-sm text-ink3">
            Bảng này lưu IP và trình duyệt của cả khách chưa đăng nhập. Giữ càng lâu càng
            nhiều dữ liệu cá nhân mà không thêm ích lợi gì — nên xoá phần cũ định kỳ.
          </p>
          <Button
            className="mt-3" variant="danger" icon={<Trash2 className="h-4 w-4" />}
            loading={purge.isPending} onClick={() => setConfirmPurge(true)}
          >
            Xoá dữ liệu cũ hơn 90 ngày
          </Button>
        </Card>
      )}

      <ConfirmModal
        open={confirmPurge}
        onOpenChange={setConfirmPurge}
        title="Xoá dữ liệu truy cập cũ hơn 90 ngày?"
        message="Mọi lượt truy cập cũ hơn 90 ngày sẽ bị xoá vĩnh viễn, không phục hồi được. Số liệu 90 ngày gần đây giữ nguyên."
        okLabel="Xoá"
        danger
        onConfirm={() => {
          purge.mutate(90, {
            onSuccess: (r) => toast.ok(`Đã xoá ${fmtNum(r.sessions)} lượt truy cập cũ`),
            onError: (e) => toast.err('Không xoá được', e instanceof Error ? e.message : undefined),
          });
          setConfirmPurge(false);
        }}
      />
    </motion.div>
  );
}
