import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { useAuth } from '@/app/AuthProvider';
import { useToast } from '@/app/ToastProvider';
import { Badge, Button, Card, CardHead, Field, FundBadge, Input, Money, Note, TableWrap } from '@/components/ui';
import { useDebts, usePeriods, useStudents, useUpdateProfile } from '@/data/api';
import { fmtDateTime, fmtVnd } from '@/lib/format';
import { pageVariants } from '@/lib/motion';
import { ROLE_LABEL } from '@/types/db';

export default function ProfilePage() {
  const { profile, role, updatePassword, refreshProfile } = useAuth();
  const toast = useToast();
  const update = useUpdateProfile();
  const debts = useDebts(role);
  const students = useStudents(role);
  const periods = usePeriods();

  const [name, setName] = useState('');
  const [password, setPassword] = useState('');

  useEffect(() => setName(profile?.full_name ?? ''), [profile?.full_name]);

  if (!profile) {
    return (
      <Card className="p-6">
        <Note tone="info"><span>Bạn chưa đăng nhập.</span></Note>
      </Card>
    );
  }

  const myStudent = (students.data ?? []).find((s) => s.id === profile.student_id);
  const myDebts = (debts.data ?? []).filter((d) => d.student_id === profile.student_id);
  const totalRemaining = myDebts.reduce((a, d) => a + d.remaining, 0);

  return (
    <motion.div variants={pageVariants} initial="hidden" animate="show" className="grid gap-4 xl:grid-cols-2">
      <Card>
        <CardHead title="Tài khoản của tôi" actions={<Badge tone="brand">{ROLE_LABEL[role]}</Badge>} />
        <div className="p-4">
          <Field label="Email">
            <Input value={profile.email} disabled />
          </Field>
          <Field label="Họ và tên">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Button
            size="sm"
            variant="primary"
            loading={update.isPending}
            onClick={() => update.mutate({ id: profile.id, values: { full_name: name.trim() } }, {
              onSuccess: () => { toast.ok('Đã lưu họ tên'); void refreshProfile(); },
              onError: (e) => toast.err('Không lưu được', e instanceof Error ? e.message : undefined),
            })}
          >
            Lưu họ tên
          </Button>
          <p className="mt-3 text-xs text-ink3">
            Đăng nhập gần nhất: {profile.last_sign_in_at ? fmtDateTime(profile.last_sign_in_at) : 'chưa có'}
          </p>
        </div>
      </Card>

      <Card>
        <CardHead title="Đổi mật khẩu" />
        <div className="p-4">
          <Field label="Mật khẩu mới" hint="Ít nhất 8 ký tự.">
            <Input type="password" value={password} autoComplete="new-password"
              onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Button
            size="sm"
            disabled={password.length < 8}
            onClick={async () => {
              try {
                await updatePassword(password);
                setPassword('');
                toast.ok('Đã đổi mật khẩu');
              } catch (e) {
                toast.err('Không đổi được mật khẩu', e instanceof Error ? e.message : undefined);
              }
            }}
          >
            Đổi mật khẩu
          </Button>
        </div>
      </Card>

      <Card className="xl:col-span-2">
        <CardHead
          title="Công nợ của tôi"
          sub={myStudent ? `${myStudent.full_name} — ${myStudent.code}` : undefined}
          actions={totalRemaining > 0 ? <Badge tone="warn">Còn nợ {fmtVnd(totalRemaining)}</Badge> : <Badge tone="ok">Đã nộp đủ</Badge>}
        />
        {!profile.student_id ? (
          <div className="p-4">
            <Note tone="info">
              <span>
                Tài khoản của bạn chưa được gắn với sinh viên nào trong danh sách lớp, nên chưa xem được công nợ
                riêng. Hãy nhờ quản trị lớp gắn giúp trong trang Tài khoản.
              </span>
            </Note>
          </div>
        ) : myDebts.length === 0 ? (
          <div className="p-4"><Note tone="ok"><span>Chưa có đợt thu nào áp dụng cho bạn.</span></Note></div>
        ) : (
          <TableWrap>
            <table>
              <caption className="sr-only">Công nợ của tôi theo từng đợt thu</caption>
              <thead>
                <tr>
                  <th>Đợt thu</th><th>Quỹ</th>
                  <th className="text-right">Phải nộp</th><th className="text-right">Đã nộp</th>
                  <th className="text-right">Còn thiếu</th><th>Hạn nộp</th>
                </tr>
              </thead>
              <tbody>
                {myDebts.map((d) => (
                  <tr key={d.period_id}>
                    <td className="font-medium">{d.period_name}</td>
                    <td><FundBadge fund={d.fund} /></td>
                    <td className="num text-right">{fmtVnd(d.must_pay)}</td>
                    <td className="text-right"><Money value={d.paid} kind={d.paid ? 'in' : undefined} /></td>
                    <td className="text-right">
                      {d.remaining ? <Money value={d.remaining} kind="out" /> : <Badge tone="ok">đủ</Badge>}
                    </td>
                    <td className="text-[13px] text-ink3">
                      {(periods.data ?? []).find((p) => p.id === d.period_id)?.due_date ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
    </motion.div>
  );
}
