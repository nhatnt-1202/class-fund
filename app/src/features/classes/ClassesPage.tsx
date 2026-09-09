/**
 * Quản lý lớp — trang của TÀI KHOẢN GỐC.
 *
 * Mô hình vận hành: tài khoản gốc mở lớp và giao mỗi lớp cho một tài khoản quản trị;
 * từ đó quản trị lớp tự lo lớp của mình (thu, chi, đợt thu, thành viên) và không thấy
 * lớp nào khác. Một người có thể được giao nhiều lớp.
 */
import { motion } from 'framer-motion';
import { Building2, Plus, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { useKlassContext } from '@/app/ClassProvider';
import { useToast } from '@/app/ToastProvider';
import {
  Badge, Button, Card, CardHead, EmptyState, Field, Input, Modal, Note, TableSkeleton, TableWrap,
} from '@/components/ui';
import { useAppConfig, useClassAdmins, useCreateClass, useGrantClassRole, usePublicClasses } from '@/data/api';
import { can } from '@/lib/permissions';
import { pageVariants, rowStagger } from '@/lib/motion';

export default function ClassesPage() {
  const { role, options, setClassId, refetch } = useKlassContext();
  const toast = useToast();
  const allowed = can.manageClasses(role);

  const counts = usePublicClasses();
  const admins = useClassAdmins(allowed);
  const { data: config } = useAppConfig();
  const create = useCreateClass();
  const grant = useGrantClassRole();

  const [newOpen, setNewOpen] = useState(false);
  const [form, setForm] = useState({ code: '', name: '', faculty: '', term: '', school_year: '', admin_email: '' });
  const [assign, setAssign] = useState<{ id: string; code: string } | null>(null);
  const [assignEmail, setAssignEmail] = useState('');

  if (!allowed) {
    return (
      <Card className="p-6">
        <Note tone="warn">
          <span>
            Chỉ tài khoản gốc của hệ thống mở được lớp mới. Bạn đang quản trị lớp của mình — mọi
            việc trong lớp (đợt thu, thu, chi, thành viên) làm ở các trang khác.
          </span>
        </Note>
      </Card>
    );
  }

  const studentCount = (id: string) => counts.data?.find((c) => c.class_id === id)?.student_count ?? 0;
  const adminsOf = (id: string) => (admins.data ?? []).filter((a) => a.class_id === id);

  const submitNew = async () => {
    if (!form.code.trim()) return;
    try {
      const created = await create.mutateAsync(form);
      toast.ok('Đã mở lớp mới', form.admin_email
        ? `${created.code} · đã giao cho ${form.admin_email.trim().toLowerCase()}`
        : `${created.code} · chưa có quản trị, hãy giao cho một tài khoản`);
      setNewOpen(false);
      setForm({ code: '', name: '', faculty: '', term: '', school_year: '', admin_email: '' });
      refetch();
      setClassId(created.id);
    } catch (e) {
      toast.err('Không mở được lớp', e instanceof Error ? e.message : undefined);
    }
  };

  const submitAssign = async () => {
    if (!assign || !assignEmail.trim()) return;
    try {
      const r = await grant.mutateAsync({ classId: assign.id, email: assignEmail, role: 'admin' });
      toast.ok(
        r.status === 'invited' ? 'Đã tạo lời mời quản trị' : 'Đã giao quản trị lớp',
        r.status === 'invited'
          ? `${r.email} thành quản trị lớp ${assign.code} ngay khi đăng ký`
          : `${r.email} · quản trị lớp ${assign.code}`,
      );
      setAssign(null);
      setAssignEmail('');
    } catch (e) {
      toast.err('Không giao được quản trị', e instanceof Error ? e.message : undefined);
    }
  };

  return (
    <motion.div variants={pageVariants} initial="hidden" animate="show" className="space-y-4">
      <Note tone="info">
        <span>
          Bạn là <b>tài khoản gốc</b>: mở lớp và giao mỗi lớp cho một tài khoản quản trị. Quản trị lớp
          chỉ thấy và quản lý lớp được giao. Sinh viên có email <b>&lt;mã SV&gt;@
          {config?.student_email_domain ?? 'student.humg.edu.vn'}</b> tự đăng ký và tự vào đúng lớp có
          mã sinh viên đó trong danh sách đã nhập.
        </span>
      </Note>

      <Card>
        <CardHead
          title="Các lớp trong hệ thống"
          sub="Mỗi lớp có quỹ, đợt thu, danh sách và lịch sử thao tác riêng — không dùng chung gì cả."
          actions={
            <Button size="sm" variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setNewOpen(true)}>
              Mở lớp mới
            </Button>
          }
        />
        {admins.isLoading ? (
          <TableSkeleton rows={3} cols={5} />
        ) : options.length === 0 ? (
          <EmptyState
            title="Chưa có lớp nào"
            hint="Mở lớp đầu tiên, giao cho một tài khoản quản trị, rồi để họ nhập danh sách lớp."
            action={<Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setNewOpen(true)}>Mở lớp mới</Button>}
          />
        ) : (
          <TableWrap>
            <table>
              <caption className="sr-only">Danh sách lớp và quản trị của từng lớp</caption>
              <thead>
                <tr><th>Mã lớp</th><th>Tên lớp</th><th className="text-right">Sinh viên</th><th>Quản trị lớp</th><th /></tr>
              </thead>
              <tbody>
                {options.map((o, i) => {
                  const list = adminsOf(o.id);
                  return (
                    <motion.tr key={o.id} {...rowStagger(i)}>
                      <td className="font-semibold">
                        <span className="flex items-center gap-2">
                          <Building2 className="h-4 w-4 text-ink3" aria-hidden />{o.code}
                        </span>
                      </td>
                      <td className="text-[13px]">{o.name}</td>
                      <td className="text-right tabular-nums">{studentCount(o.id)}</td>
                      <td className="text-[13px]">
                        {list.length === 0 ? (
                          <Badge tone="warn">chưa có quản trị</Badge>
                        ) : (
                          <span className="flex flex-wrap gap-1.5">
                            {list.map((a) => (
                              <Badge key={`${a.class_id}-${a.email}`} tone={a.pending ? 'neutral' : 'ok'}>
                                {a.full_name || a.email}{a.pending ? ' · chờ đăng ký' : ''}
                              </Badge>
                            ))}
                          </span>
                        )}
                      </td>
                      <td className="text-right">
                        <Button size="sm" variant="ghost" icon={<ShieldCheck className="h-4 w-4" />}
                          onClick={() => { setAssign({ id: o.id, code: o.code }); setAssignEmail(''); }}>
                          Giao quản trị
                        </Button>
                        <Button size="sm" variant="ghost" className="ml-1" onClick={() => setClassId(o.id)}>
                          Xem lớp này
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

      <Modal
        open={newOpen}
        onOpenChange={setNewOpen}
        title="Mở lớp mới"
        sub="Mã lớp là thứ sinh viên nhìn thấy khi chọn lớp, nên dùng đúng mã của trường."
        footer={
          <>
            <Button onClick={() => setNewOpen(false)}>Huỷ</Button>
            <Button variant="primary" loading={create.isPending} onClick={() => void submitNew()}>Mở lớp</Button>
          </>
        }
      >
        <Field label="Mã lớp" required hint="Ví dụ: DCXDXD69_03B">
          <Input autoFocus value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
        </Field>
        <Field label="Tên lớp" hint="Để trống thì lấy chính mã lớp.">
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Khoa / ngành">
            <Input value={form.faculty} onChange={(e) => setForm({ ...form, faculty: e.target.value })} />
          </Field>
          <Field label="Học kỳ">
            <Input value={form.term} onChange={(e) => setForm({ ...form, term: e.target.value })} />
          </Field>
        </div>
        <Field label="Năm học" hint="Ví dụ: 2026-2027">
          <Input value={form.school_year} onChange={(e) => setForm({ ...form, school_year: e.target.value })} />
        </Field>
        <Field
          label="Email quản trị lớp"
          hint="Người này toàn quyền trong lớp. Chưa có tài khoản cũng được: hệ thống giữ sẵn quyền, họ đăng ký là có."
        >
          <Input type="email" value={form.admin_email} placeholder="loptruong@student.humg.edu.vn"
            onChange={(e) => setForm({ ...form, admin_email: e.target.value })} />
        </Field>
      </Modal>

      <Modal
        open={Boolean(assign)}
        onOpenChange={(v) => !v && setAssign(null)}
        title={`Giao quản trị lớp ${assign?.code ?? ''}`}
        sub="Giao thêm người khác cũng được — lớp có thể có nhiều quản trị."
        footer={
          <>
            <Button onClick={() => setAssign(null)}>Huỷ</Button>
            <Button variant="primary" loading={grant.isPending} onClick={() => void submitAssign()}>Giao quản trị</Button>
          </>
        }
      >
        <Field label="Email" required
          hint="Có tài khoản rồi thì quyền có hiệu lực ngay; chưa có thì thành lời mời chờ họ đăng ký.">
          <Input type="email" autoFocus value={assignEmail} onChange={(e) => setAssignEmail(e.target.value)} />
        </Field>
      </Modal>
    </motion.div>
  );
}
