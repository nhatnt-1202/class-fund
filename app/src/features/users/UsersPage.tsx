import { motion } from 'framer-motion';
import { Mail, ShieldAlert, UserPlus, X } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '@/app/AuthProvider';
import { useToast } from '@/app/ToastProvider';
import {
  Badge, Button, Card, CardHead, ConfirmModal, EmptyState, Field, Input, Modal, Note, Select,
  TableSkeleton, TableWrap,
} from '@/components/ui';
import { useInviteUser, useInvites, useProfiles, useRevokeInvite, useStudents, useUpdateProfile } from '@/data/api';
import { fmtDateTime, fmtRelative } from '@/lib/format';
import { can } from '@/lib/permissions';
import { pageVariants, rowStagger } from '@/lib/motion';
import { ROLE_LABEL, type AppRole, type Profile } from '@/types/db';

const ROLE_OPTIONS: AppRole[] = ['member', 'treasurer', 'admin', 'owner'];

const ROLE_EFFECT: Record<AppRole, string> = {
  member: 'chỉ xem số liệu và xem công nợ của chính mình',
  treasurer: 'thêm và sửa mọi khoản thu, chi, sinh viên, nhập danh sách lớp',
  admin: 'toàn quyền nghiệp vụ, quản lý đợt thu và quản lý tài khoản',
  owner: 'toàn quyền, kể cả cấp và thu quyền chủ sở hữu',
};

export default function UsersPage() {
  const { role, profile: me } = useAuth();
  const toast = useToast();
  const allowed = can.manageUsers(role);
  const profiles = useProfiles(allowed);
  const invites = useInvites(allowed);
  const students = useStudents(role);
  const invite = useInviteUser();
  const revoke = useRevokeInvite();
  const update = useUpdateProfile();

  const [inviteOpen, setInviteOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<AppRole>('member');
  const [studentId, setStudentId] = useState('');
  const [confirmRole, setConfirmRole] = useState<{ p: Profile; next: AppRole } | null>(null);
  const [confirmActive, setConfirmActive] = useState<Profile | null>(null);

  if (!allowed) {
    return (
      <Card className="p-6">
        <Note tone="warn">
          <span>Trang này chỉ dành cho quản trị lớp. Nếu bạn cần quyền, hãy nhờ quản trị cấp cho tài khoản của bạn.</span>
        </Note>
      </Card>
    );
  }

  const pending = (invites.data ?? []).filter((i) => !i.accepted_at && !i.revoked_at);
  const activeOwners = (profiles.data ?? []).filter((p) => p.role === 'owner' && p.is_active).length;

  const sendInvite = async () => {
    if (!email.trim()) return;
    try {
      await invite.mutateAsync({
        email: email.trim().toLowerCase(),
        role: inviteRole,
        student_id: studentId || null,
      });
      toast.ok('Đã tạo lời mời', `${email.trim()} · ${ROLE_LABEL[inviteRole]}`);
      setInviteOpen(false);
      setEmail('');
      setStudentId('');
      setInviteRole('member');
    } catch (e) {
      toast.err('Không tạo được lời mời', e instanceof Error ? e.message : undefined);
    }
  };

  return (
    <motion.div variants={pageVariants} initial="hidden" animate="show" className="space-y-4">
      <Card>
        <CardHead
          title="Tài khoản"
          sub="Vô hiệu hoá thay cho xoá, để giữ nguyên vết trong lịch sử thao tác."
          actions={
            <Button size="sm" variant="primary" icon={<UserPlus className="h-4 w-4" />} onClick={() => setInviteOpen(true)}>
              Mời tài khoản
            </Button>
          }
        />
        {profiles.isLoading ? (
          <TableSkeleton rows={4} cols={5} />
        ) : (
          <TableWrap>
            <table>
              <caption className="sr-only">Danh sách tài khoản và vai trò</caption>
              <thead>
                <tr>
                  <th>Họ tên</th><th>Email</th><th>Vai trò</th><th>Gắn với SV</th>
                  <th>Đăng nhập gần nhất</th><th>Trạng thái</th><th />
                </tr>
              </thead>
              <tbody>
                {(profiles.data ?? []).map((p, i) => {
                  const isMe = p.id === me?.id;
                  const lockedRow = p.role === 'owner' && !can.grantOwner(role);
                  return (
                    <motion.tr key={p.id} {...rowStagger(i)}>
                      <td className="font-semibold">
                        {p.full_name || '(chưa đặt tên)'}
                        {isMe && <Badge className="ml-2">bạn</Badge>}
                      </td>
                      <td className="text-[13px]">{p.email}</td>
                      <td>
                        <Select
                          className="w-auto"
                          aria-label={`Vai trò của ${p.full_name || p.email}`}
                          value={p.role}
                          disabled={isMe || lockedRow}
                          onChange={(e) => setConfirmRole({ p, next: e.target.value as AppRole })}
                        >
                          {ROLE_OPTIONS
                            .filter((r) => r !== 'owner' || can.grantOwner(role) || p.role === 'owner')
                            .map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                        </Select>
                      </td>
                      <td className="text-[13px] text-ink3">
                        {(students.data ?? []).find((s) => s.id === p.student_id)?.full_name ?? '—'}
                      </td>
                      <td className="text-[13px] text-ink3" title={fmtDateTime(p.last_sign_in_at)}>
                        {p.last_sign_in_at ? fmtRelative(p.last_sign_in_at) : 'chưa đăng nhập'}
                      </td>
                      <td>{p.is_active ? <Badge tone="ok">Đang hoạt động</Badge> : <Badge tone="bad">Đã vô hiệu</Badge>}</td>
                      <td className="text-right">
                        <Button
                          size="sm"
                          variant={p.is_active ? 'danger' : 'default'}
                          disabled={isMe || lockedRow || (p.role === 'owner' && p.is_active && activeOwners <= 1)}
                          onClick={() => setConfirmActive(p)}
                        >
                          {p.is_active ? 'Vô hiệu hoá' : 'Kích hoạt lại'}
                        </Button>
                      </td>
                    </motion.tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>

      <Card>
        <CardHead title="Lời mời đang chờ" sub="Người được mời tự đăng ký bằng đúng email này." />
        {pending.length === 0 ? (
          <EmptyState title="Không có lời mời nào đang chờ" hint="Bấm “Mời tài khoản” để thêm người vào hệ thống." />
        ) : (
          <TableWrap>
            <table>
              <caption className="sr-only">Các lời mời đang chờ</caption>
              <thead>
                <tr><th>Email</th><th>Vai trò</th><th>Gửi lúc</th><th /></tr>
              </thead>
              <tbody>
                {pending.map((iv, i) => (
                  <motion.tr key={iv.id} {...rowStagger(i)}>
                    <td className="flex items-center gap-2"><Mail className="h-4 w-4 text-ink3" aria-hidden />{iv.email}</td>
                    <td><Badge tone="brand">{ROLE_LABEL[iv.role]}</Badge></td>
                    <td className="text-[13px] text-ink3" title={fmtDateTime(iv.created_at)}>{fmtRelative(iv.created_at)}</td>
                    <td className="text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<X className="h-4 w-4" />}
                        loading={revoke.isPending}
                        onClick={() => revoke.mutate(iv.id, {
                          onSuccess: () => toast.ok('Đã thu hồi lời mời', iv.email),
                          onError: (e) => toast.err('Không thu hồi được', e instanceof Error ? e.message : undefined),
                        })}
                      >
                        Thu hồi
                      </Button>
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>

      <Modal
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        title="Mời tài khoản"
        sub="Không có đăng ký tự do: chỉ email được mời mới tạo được tài khoản."
        footer={
          <>
            <Button onClick={() => setInviteOpen(false)}>Huỷ</Button>
            <Button variant="primary" loading={invite.isPending} onClick={() => void sendInvite()}>Tạo lời mời</Button>
          </>
        }
      >
        <Field label="Email" required>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus
            placeholder="sinhvien@lop.vn" />
        </Field>
        <Field label="Vai trò" hint={`Người này sẽ được ${ROLE_EFFECT[inviteRole]}.`}>
          <Select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as AppRole)}>
            {ROLE_OPTIONS.filter((r) => r !== 'owner' || can.grantOwner(role)).map((r) => (
              <option key={r} value={r}>{ROLE_LABEL[r]}</option>
            ))}
          </Select>
        </Field>
        <Field label="Gắn với sinh viên (tuỳ chọn)" hint="Gắn rồi thì người này xem được công nợ của chính mình.">
          <Select value={studentId} onChange={(e) => setStudentId(e.target.value)}>
            <option value="">— Không gắn —</option>
            {(students.data ?? []).filter((s) => s.is_active).map((s) => (
              <option key={s.id} value={s.id}>{s.full_name} — {s.code}</option>
            ))}
          </Select>
        </Field>
        <Note tone="info">
          <span>Sau khi bạn tạo lời mời, hãy nhắn cho người đó vào trang <b>Đăng ký</b> và dùng đúng email này.</span>
        </Note>
      </Modal>

      <ConfirmModal
        open={Boolean(confirmRole)}
        onOpenChange={(v) => !v && setConfirmRole(null)}
        title="Đổi vai trò?"
        okLabel="Đổi vai trò"
        loading={update.isPending}
        message={confirmRole && (
          <>
            <b>{confirmRole.p.full_name || confirmRole.p.email}</b> sẽ chuyển từ{' '}
            <b>{ROLE_LABEL[confirmRole.p.role]}</b> thành <b>{ROLE_LABEL[confirmRole.next]}</b>.
            <br />Người này sẽ được {ROLE_EFFECT[confirmRole.next]}.
            <br /><span className="text-ink3">Thay đổi được ghi vào lịch sử thao tác.</span>
          </>
        )}
        onConfirm={() => {
          if (!confirmRole) return;
          update.mutate({ id: confirmRole.p.id, values: { role: confirmRole.next } }, {
            onSuccess: () => {
              toast.ok('Đã đổi vai trò', `${confirmRole.p.full_name || confirmRole.p.email} → ${ROLE_LABEL[confirmRole.next]}`);
              setConfirmRole(null);
            },
            onError: (e) => {
              toast.err('Không đổi được vai trò', e instanceof Error ? e.message : undefined);
              setConfirmRole(null);
            },
          });
        }}
      />

      <ConfirmModal
        open={Boolean(confirmActive)}
        onOpenChange={(v) => !v && setConfirmActive(null)}
        title={confirmActive?.is_active ? 'Vô hiệu hoá tài khoản?' : 'Kích hoạt lại tài khoản?'}
        danger={confirmActive?.is_active}
        okLabel={confirmActive?.is_active ? 'Vô hiệu hoá' : 'Kích hoạt lại'}
        loading={update.isPending}
        message={confirmActive && (
          confirmActive.is_active ? (
            <>
              <b>{confirmActive.full_name || confirmActive.email}</b> sẽ không đăng nhập và không thao tác được nữa.
              Lịch sử thao tác của người này vẫn được giữ nguyên.
            </>
          ) : (
            <>Mở lại quyền truy cập cho <b>{confirmActive.full_name || confirmActive.email}</b>?</>
          )
        )}
        onConfirm={() => {
          if (!confirmActive) return;
          update.mutate({ id: confirmActive.id, values: { is_active: !confirmActive.is_active } }, {
            onSuccess: () => {
              toast.ok(confirmActive.is_active ? 'Đã vô hiệu hoá tài khoản' : 'Đã kích hoạt lại tài khoản');
              setConfirmActive(null);
            },
            onError: (e) => {
              toast.err('Không cập nhật được', e instanceof Error ? e.message : undefined);
              setConfirmActive(null);
            },
          });
        }}
      />

      {activeOwners <= 1 && (
        <Note tone="warn">
          <span className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4" aria-hidden />
            Hệ thống chỉ còn <b>một chủ sở hữu</b>. Nên mời thêm một người nữa làm chủ sở hữu để không bị khoá
            nếu tài khoản này mất quyền truy cập.
          </span>
        </Note>
      )}
    </motion.div>
  );
}
