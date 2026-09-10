import { motion } from 'framer-motion';
import { RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { useKlassContext } from '@/app/ClassProvider';
import { useToast } from '@/app/ToastProvider';
import {
  Badge, Button, Card, CardHead, DateBox, EmptyState, Input, Modal, Note, Select, TableSkeleton,
  TableWrap,
} from '@/components/ui';
import { useAuditLogs, useMembers, useSoftDelete, type AuditFilter } from '@/data/api';
import { fmtDateTime, fmtRelative, fmtVnd } from '@/lib/format';
import { can } from '@/lib/permissions';
import { pageVariants, rowStagger } from '@/lib/motion';
import type { AuditLog } from '@/types/db';

const ACTION_LABEL: Record<string, string> = {
  INSERT: 'Thêm mới', UPDATE: 'Sửa', SOFT_DELETE: 'Xoá', RESTORE: 'Phục hồi',
  LOGIN: 'Đăng nhập', LOGOUT: 'Đăng xuất', IMPORT: 'Nhập danh sách', EXPORT: 'Xuất Excel',
  ROLE_CHANGE: 'Đổi vai trò', INVITE: 'Mời tài khoản', VIEW_QR: 'In / xem QR',
};
const TABLE_LABEL: Record<string, string> = {
  incomes: 'Khoản thu', expenses: 'Khoản chi', students: 'Sinh viên', periods: 'Đợt thu',
  profiles: 'Tài khoản', invites: 'Lời mời', class_settings: 'Cấu hình lớp', '-': 'Hệ thống',
};
const TONE: Record<string, 'ok' | 'warn' | 'bad' | 'brand' | 'neutral'> = {
  INSERT: 'ok', RESTORE: 'ok', UPDATE: 'brand', SOFT_DELETE: 'bad',
  ROLE_CHANGE: 'warn', INVITE: 'brand', IMPORT: 'brand', EXPORT: 'neutral',
  LOGIN: 'neutral', LOGOUT: 'neutral', VIEW_QR: 'neutral',
};

const MONEY_FIELDS = new Set(['amount', 'amount_per_student']);

/** Hiển thị giá trị cho người thường đọc: tiền có dấu phân cách, rỗng ghi rõ là trống. */
function showValue(field: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return '(trống)';
  if (MONEY_FIELDS.has(field) && typeof v === 'number') return fmtVnd(v);
  if (typeof v === 'boolean') return v ? 'có' : 'không';
  return String(v);
}

export default function AuditPage() {
  const { role, classId } = useKlassContext();
  const toast = useToast();
  const allowed = can.viewAudit(role);
  const [filter, setFilter] = useState<AuditFilter>({});
  const [detail, setDetail] = useState<AuditLog | null>(null);
  const [showJson, setShowJson] = useState(false);
  const logs = useAuditLogs(classId, filter, allowed);
  const members = useMembers(classId, can.manageUsers(role));
  const restoreIncome = useSoftDelete('incomes', classId);
  const restoreExpense = useSoftDelete('expenses', classId);

  if (!allowed) {
    return (
      <Card className="p-6">
        <Note tone="warn">
          <span>
            Trang này chỉ dành cho quản trị lớp. Lịch sử thao tác là công cụ giám sát nên không
            mở cho thủ quỹ hay thành viên — cơ sở dữ liệu cũng chặn, không chỉ ẩn trang.
          </span>
        </Note>
      </Card>
    );
  }

  const restore = (log: AuditLog) => {
    if (!log.record_id) return;
    const m = log.table_name === 'incomes' ? restoreIncome : log.table_name === 'expenses' ? restoreExpense : null;
    if (!m) {
      toast.err('Chưa hỗ trợ phục hồi loại bản ghi này', TABLE_LABEL[log.table_name] ?? log.table_name);
      return;
    }
    m.mutate({ id: log.record_id, restore: true }, {
      onSuccess: () => { toast.ok('Đã phục hồi bản ghi'); setDetail(null); },
      onError: (e) => toast.err('Không phục hồi được', e instanceof Error ? e.message : undefined),
    });
  };

  return (
    <motion.div variants={pageVariants} initial="hidden" animate="show">
      <Card>
        <CardHead
          title="Lịch sử thao tác"
          sub="Chỉ hiện thao tác của lớp đang xem. Do database ghi tự động và không ai sửa được — kể cả chủ sở hữu."
        />
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <label className="sr-only" htmlFor="au-q">Tìm trong diễn giải</label>
          <Input id="au-q" type="search" className="filter-field" placeholder="Tìm trong diễn giải…"
            value={filter.q ?? ''} onChange={(e) => setFilter((f) => ({ ...f, q: e.target.value }))} />
          <label className="sr-only" htmlFor="au-action">Lọc hành động</label>
          <Select id="au-action" className="filter-field" value={filter.action ?? ''}
            onChange={(e) => setFilter((f) => ({ ...f, action: e.target.value }))}>
            <option value="">Mọi hành động</option>
            {Object.entries(ACTION_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          <label className="sr-only" htmlFor="au-table">Lọc bảng</label>
          <Select id="au-table" className="filter-field" value={filter.table ?? ''}
            onChange={(e) => setFilter((f) => ({ ...f, table: e.target.value }))}>
            <option value="">Mọi loại dữ liệu</option>
            {Object.entries(TABLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          {can.manageUsers(role) && (
            <>
              <label className="sr-only" htmlFor="au-actor">Lọc người thực hiện</label>
              <Select id="au-actor" className="filter-field" value={filter.actor ?? ''}
                onChange={(e) => setFilter((f) => ({ ...f, actor: e.target.value }))}>
                <option value="">Mọi người</option>
                {(members.data ?? []).map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.profile?.full_name || m.profile?.email || m.user_id}
                  </option>
                ))}
              </Select>
            </>
          )}
          <DateBox id="au-from" className="filter-field" label="Từ ngày" value={filter.from ?? ''}
            onChange={(v) => setFilter((f) => ({ ...f, from: v }))} />
          <DateBox id="au-to" className="filter-field" label="Đến ngày" value={filter.to ?? ''}
            onChange={(v) => setFilter((f) => ({ ...f, to: v }))} />
          {Object.values(filter).some(Boolean) && (
            <Button size="sm" variant="ghost" className="filter-action" onClick={() => setFilter({})}>Xoá lọc</Button>
          )}
        </div>

        {logs.isLoading ? (
          <TableSkeleton rows={8} cols={3} />
        ) : (logs.data ?? []).length === 0 ? (
          <EmptyState title="Chưa có thao tác nào khớp bộ lọc" />
        ) : (
          <ol className="divide-y divide-line">
            {(logs.data ?? []).map((log, i) => (
              <motion.li key={log.id} {...rowStagger(i)}>
                <button
                  type="button"
                  onClick={() => setDetail(log)}
                  className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-surface2"
                >
                  <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface3
                    text-xs font-bold text-ink2" aria-hidden>
                    {(log.actor_name || log.actor_email || '?').slice(0, 1).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm">{log.summary}</span>
                    <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink3">
                      <Badge tone={TONE[log.action] ?? 'neutral'}>{ACTION_LABEL[log.action] ?? log.action}</Badge>
                      <span>{TABLE_LABEL[log.table_name] ?? log.table_name}</span>
                      <time dateTime={log.at} title={fmtDateTime(log.at)}>{fmtRelative(log.at)}</time>
                    </span>
                  </span>
                </button>
              </motion.li>
            ))}
          </ol>
        )}
      </Card>

      <Modal
        open={Boolean(detail)}
        onOpenChange={(v) => { if (!v) { setDetail(null); setShowJson(false); } }}
        wide
        title="Chi tiết thao tác"
        sub={detail ? `${detail.actor_name || detail.actor_email} · ${fmtDateTime(detail.at)}` : ''}
        footer={
          <>
            {detail?.action === 'SOFT_DELETE' && can.restoreRecords(role) && (
              <Button
                variant="primary"
                className="mr-auto"
                icon={<RotateCcw className="h-4 w-4" />}
                loading={restoreIncome.isPending || restoreExpense.isPending}
                onClick={() => detail && restore(detail)}
              >
                Phục hồi bản ghi này
              </Button>
            )}
            <Button onClick={() => setDetail(null)}>Đóng</Button>
          </>
        }
      >
        {detail && (
          <div className="space-y-3">
            <p className="text-sm">{detail.summary}</p>
            {/* Bảng nằm trong TableWrap chứ không phải div overflow-hidden: trên điện thoại
                cột "Sau" — thứ quan trọng nhất — nằm ngoài màn hình và không cuộn tới được. */}
            {detail.changed_fields && detail.changed_fields.length > 0 ? (
              <TableWrap className="rounded-[10px] border border-line">
                <table>
                  <caption className="sr-only">Các trường đã thay đổi</caption>
                  <thead>
                    <tr><th>Trường</th><th>Trước</th><th>Sau</th></tr>
                  </thead>
                  <tbody>
                    {detail.changed_fields.map((f) => (
                      <tr key={f}>
                        <td className="font-medium">{f}</td>
                        <td className="text-expense">{showValue(f, detail.before_data?.[f])}</td>
                        <td className="text-income">{showValue(f, detail.after_data?.[f])}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            ) : (
              <Note tone="info"><span>Thao tác này không sửa trường nào (thêm mới hoặc sự kiện hệ thống).</span></Note>
            )}
            {can.grantOwner(role) && (
              <div>
                <Button size="sm" variant="ghost" onClick={() => setShowJson((v) => !v)}>
                  {showJson ? 'Ẩn JSON gốc' : 'Xem JSON gốc'}
                </Button>
                {showJson && (
                  <pre className="mt-2 max-h-[40vh] overflow-auto rounded-[10px] bg-surface2 p-3 text-xs">
                    {JSON.stringify({ before: detail.before_data, after: detail.after_data, meta: detail.meta }, null, 2)}
                  </pre>
                )}
              </div>
            )}
          </div>
        )}
      </Modal>
    </motion.div>
  );
}
