import { motion } from 'framer-motion';
import { Mail, ShieldAlert, UserMinus, UserPlus, X } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '@/app/AuthProvider';
import { useKlassContext } from '@/app/ClassProvider';
import { useToast } from '@/app/ToastProvider';
import {
  Badge, Button, Card, CardHead, ConfirmModal, EmptyState, Field, Input, Modal, Note, Select,
  TableSkeleton, TableWrap,
} from '@/components/ui';
import {
  useAppConfig, useGrantClassRole, useInvites, useMembers, useRevokeClassRole, useRevokeInvite,
  useStudents, useUpdateMembership, type MemberRow,
} from '@/data/api';
import { fmtDateTime, fmtRelative } from '@/lib/format';
import { can } from '@/lib/permissions';
import { pageVariants, rowStagger } from '@/lib/motion';
import { CLASS_ROLES, ROLE_LABEL, type ClassRole } from '@/types/db';

const ROLE_EFFECT: Record<ClassRole, string> = {
  member: 'chỉ xem số liệu của lớp và xem công nợ của chính mình',
  treasurer: 'thêm và sửa mọi khoản thu, chi, sinh viên, nhập danh sách của lớp này',
  admin: 'toàn quyền trong lớp này: đợt thu, cấu hình lớp, quản lý thành viên',
};

/** Quản lý thành viên CỦA MỘT LỚP. Người của lớp khác không xuất hiện ở đây. */
export default function UsersPage() {
  const { profile: me } = useAuth();
  const { role, classId, klass } = useKlassContext();
  const toast = useToast();
  const allowed = can.manageUsers(role);
  const members = useMembers(classId, allowed);
  const invites = useInvites(classId, allowed);
  const students = useStudents(classId, role);
  const { data: config } = useAppConfig();
  const grant = useGrantClassRole();
  const revokeInvite = useRevokeInvite();
  const removeMember = useRevokeClassRole();
  const update = useUpdateMembership();

  const [inviteOpen, setInviteOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<ClassRole>('member');
  const [studentId, setStudentId] = useState('');
  const [confirmRole, setConfirmRole] = useState<{ m: MemberRow; next: ClassRole } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<MemberRow | null>(null);

  if (!allowed) {
    return (
      <Card className="p-6">
        <Note tone="warn">
          <span>
            Trang này chỉ dành cho quản trị lớp. Nếu bạn cần quyền, hãy nhờ quản trị của lớp
            {klass ? ` ${klass.code}` : ''} cấp cho tài khoản của bạn.
          </span>
        </Note>
      </Card>
    );
  }

  const pending = (invites.data ?? []).filter((i) => !i.accepted_at && !i.revoked_at);
  const admins = (members.data ?? []).filter((m) => m.role === 'admin').length;
  const domain = config?.student_email_domain ?? 'student.humg.edu.vn';

  const sendInvite = async () => {
    if (!classId || !email.trim()) return;
    try {
      const r = await grant.mutateAsync({
        classId,
        email: email.trim().toLowerCase(),
        role: inviteRole,
        studentId: studentId || null,
      });
      // Email đã có tài khoản ⇒ quyền có hiệu lực ngay; chưa có ⇒ chờ họ đăng ký
      toast.ok(
        r.status === 'invited' ? 'Đã tạo lời mời' : 'Đã cấp quyền',
        r.status === 'invited'
          ? `${r.email} sẽ thành ${ROLE_LABEL[inviteRole]} của lớp ngay khi đăng ký`
          : `${r.email} · ${ROLE_LABEL[inviteRole]}`,
      );
      setInviteOpen(false);
      setEmail('');
      setStudentId('');
      setInviteRole('member');
    } catch (e) {
      toast.err('Không cấp được quyền', e instanceof Error ? e.message : undefined);
    }
  };

  return (
    <motion.div variants={pageVariants} initial="hidden" animate="show" className="space-y-4">
      <Note tone="info">
        <span>
          Sinh viên có email dạng <b>&lt;mã SV&gt;@{domain}</b> <b>tự đăng ký được</b>, hệ thống tự gắn
          vào đúng lớp có mã sinh viên đó trong danh sách. Trang này chỉ cần dùng để <b>nâng quyền</b>
          {' '}(thủ quỹ, quản trị) hoặc <b>mời người ngoài</b> danh sách lớp (giáo viên, phụ huynh…).
          {' '}Cột <b>Gắn với sinh viên</b> quyết định hai việc: người đó xem được công nợ và QR của
          chính mình, và vai trò của họ được <b>đánh dấu ngay trên dòng của họ</b> ở trang Danh sách lớp.
        </span>
      </Note>

      <Card>
        <CardHead
          title={`Thành viên lớp ${klass?.code ?? ''}`}
          sub="Vai trò ở đây chỉ áp dụng trong lớp này — cùng một người có thể là thủ quỹ lớp khác."
          actions={
            <Button size="sm" variant="primary" icon={<UserPlus className="h-4 w-4" />} onClick={() => setInviteOpen(true)}>
              Thêm người vào lớp
            </Button>
          }
        />
        {members.isLoading ? (
          <TableSkeleton rows={4} cols={5} />
        ) : (members.data ?? []).length === 0 ? (
          <EmptyState title="Lớp này chưa có thành viên nào" hint="Nhập danh sách lớp rồi sinh viên tự đăng ký bằng email trường." />
        ) : (
          <TableWrap>
            <table>
              <caption className="sr-only">Thành viên của lớp và vai trò trong lớp</caption>
              <thead>
                <tr>
                  <th>Họ tên</th><th>Email</th><th>Vai trò trong lớp</th><th>Gắn với sinh viên</th>
                  <th>Đăng nhập gần nhất</th><th />
                </tr>
              </thead>
              <tbody>
                {(members.data ?? []).map((m, i) => {
                  const isMe = m.user_id === me?.id;
                  return (
                    <motion.tr key={m.id} {...rowStagger(i)}>
                      <td className="font-semibold">
                        {m.profile?.full_name || '(chưa đặt tên)'}
                        {isMe && <Badge className="ml-2">bạn</Badge>}
                        {m.profile?.role === 'owner' && <Badge tone="brand" className="ml-2">chủ sở hữu hệ thống</Badge>}
                      </td>
                      <td className="text-[13px]">{m.profile?.email}</td>
                      <td>
                        <Select
                          className="w-[180px]"
                          aria-label={`Vai trò của ${m.profile?.full_name || m.profile?.email} trong lớp`}
                          value={m.role}
                          disabled={isMe}
                          onChange={(e) => setConfirmRole({ m, next: e.target.value as ClassRole })}
                        >
                          {CLASS_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                        </Select>
                      </td>
                      {/*
                        * Gắn tài khoản với một sinh viên trong danh sách để (1) người đó xem được
                        * công nợ và QR của chính mình, (2) vai trò của họ được đánh dấu ngay trên
                        * dòng của họ ở trang Danh sách lớp. Quản trị lớp mời bằng email thì lúc
                        * đầu chưa gắn với ai, nên phải sửa được ở đây.
                        */}
                      <td>
                        <Select
                          className="w-[180px]"
                          aria-label={`Gắn ${m.profile?.full_name || m.profile?.email} với sinh viên trong danh sách`}
                          value={m.student_id ?? ''}
                          onChange={(e) => update.mutate(
                            { id: m.id, values: { student_id: e.target.value || null } },
                            {
                              onSuccess: () => toast.ok(
                                e.target.value ? 'Đã gắn với sinh viên' : 'Đã bỏ gắn sinh viên',
                                m.profile?.email ?? undefined,
                              ),
                              onError: (err) => toast.err('Không gắn được',
                                err instanceof Error ? err.message : undefined),
                            },
                          )}
                        >
                          <option value="">— Chưa gắn —</option>
                          {(students.data ?? []).filter((s) => s.is_active).map((s) => (
                            <option key={s.id} value={s.id}>{s.full_name} — {s.code}</option>
                          ))}
                        </Select>
                      </td>
                      <td className="text-[13px] text-ink3" title={fmtDateTime(m.profile?.last_sign_in_at)}>
                        {m.profile?.last_sign_in_at ? fmtRelative(m.profile.last_sign_in_at) : 'chưa đăng nhập'}
                      </td>
                      <td className="text-right">
                        {!m.profile?.is_active && <Badge tone="bad">Tài khoản đã bị vô hiệu</Badge>}
                        {!isMe && (
                          <Button size="sm" variant="ghost" className="ml-1"
                            icon={<UserMinus className="h-4 w-4" />}
                            onClick={() => setConfirmRemove(m)}>
                            Rút khỏi lớp
                          </Button>
                        )}
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
        <CardHead
          title="Lời mời đang chờ"
          sub={`Chỉ cần cho email KHÔNG phải dạng @${domain} — email trường thì tự đăng ký được.`}
        />
        {pending.length === 0 ? (
          <EmptyState title="Không có lời mời nào đang chờ" />
        ) : (
          <TableWrap>
            <table>
              <caption className="sr-only">Các lời mời đang chờ của lớp này</caption>
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
                        loading={revokeInvite.isPending}
                        onClick={() => revokeInvite.mutate(iv.id, {
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
        title={`Thêm người vào lớp ${klass?.code ?? ''}`}
        sub={`Email đã có tài khoản thì quyền có hiệu lực ngay; chưa có thì thành lời mời. Sinh viên dạng <mã SV>@${domain} tự đăng ký được, không cần thêm tay.`}
        footer={
          <>
            <Button onClick={() => setInviteOpen(false)}>Huỷ</Button>
            <Button variant="primary" loading={grant.isPending} onClick={() => void sendInvite()}>Cấp quyền</Button>
          </>
        }
      >
        <Field label="Email" required>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus
            placeholder="thaycoc@humg.edu.vn" />
        </Field>
        <Field label="Vai trò trong lớp" hint={`Người này sẽ được ${ROLE_EFFECT[inviteRole]}.`}>
          <Select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as ClassRole)}>
            {CLASS_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
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
      </Modal>

      <ConfirmModal
        open={Boolean(confirmRole)}
        onOpenChange={(v) => !v && setConfirmRole(null)}
        title="Đổi vai trò trong lớp?"
        okLabel="Đổi vai trò"
        loading={update.isPending}
        message={confirmRole && (
          <>
            <b>{confirmRole.m.profile?.full_name || confirmRole.m.profile?.email}</b> sẽ chuyển từ{' '}
            <b>{ROLE_LABEL[confirmRole.m.role]}</b> thành <b>{ROLE_LABEL[confirmRole.next]}</b>
            {klass ? <> trong lớp <b>{klass.code}</b></> : null}.
            <br />Người này sẽ được {ROLE_EFFECT[confirmRole.next]}.
            <br /><span className="text-ink3">Thay đổi được ghi vào lịch sử thao tác của lớp.</span>
          </>
        )}
        onConfirm={() => {
          if (!confirmRole) return;
          update.mutate({ id: confirmRole.m.id, values: { role: confirmRole.next } }, {
            onSuccess: () => {
              toast.ok('Đã đổi vai trò',
                `${confirmRole.m.profile?.full_name || confirmRole.m.profile?.email} → ${ROLE_LABEL[confirmRole.next]}`);
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
        open={Boolean(confirmRemove)}
        onOpenChange={(v) => !v && setConfirmRemove(null)}
        title="Rút người này khỏi lớp?"
        okLabel="Rút khỏi lớp"
        danger
        loading={removeMember.isPending}
        message={confirmRemove && (
          <>
            <b>{confirmRemove.profile?.full_name || confirmRemove.profile?.email}</b> sẽ không còn xem
            hay sửa được gì trong lớp <b>{klass?.code}</b>.
            <br />Tài khoản của họ <b>không bị xoá</b>, và các khoản thu/chi họ đã ghi vẫn giữ nguyên.
          </>
        )}
        onConfirm={() => {
          if (!confirmRemove || !classId) return;
          removeMember.mutate({ classId, userId: confirmRemove.user_id }, {
            onSuccess: () => {
              toast.ok('Đã rút khỏi lớp', confirmRemove.profile?.email ?? undefined);
              setConfirmRemove(null);
            },
            onError: (e) => {
              toast.err('Không rút được', e instanceof Error ? e.message : undefined);
              setConfirmRemove(null);
            },
          });
        }}
      />

      {admins <= 1 && (
        <Note tone="warn">
          <span className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4" aria-hidden />
            Lớp này chỉ còn <b>một quản trị</b>. Nên nâng thêm một người nữa để không bị khoá nếu
            tài khoản đó mất quyền truy cập.
          </span>
        </Note>
      )}
    </motion.div>
  );
}
