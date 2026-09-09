import { zodResolver } from '@hookform/resolvers/zod';
import { motion } from 'framer-motion';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { useAuth } from '@/app/AuthProvider';
import { useToast } from '@/app/ToastProvider';
import { Button, Card, Field, Input, Note } from '@/components/ui';
import { pageVariants } from '@/lib/motion';

function Shell({ title, sub, children, foot }: {
  title: string; sub?: string; children: React.ReactNode; foot?: React.ReactNode;
}) {
  return (
    <div className="grid min-h-screen place-items-center bg-bg p-4">
      <motion.div variants={pageVariants} initial="hidden" animate="show" className="w-full max-w-[420px]">
        <div className="mb-5 flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-[12px] bg-gradient-to-br from-lop to-doan
            font-head text-lg font-bold text-white shadow-s1" aria-hidden>QL</div>
          <div>
            <div className="font-head text-lg font-bold leading-tight">Quỹ Lớp</div>
            <div className="text-xs text-ink3">Quản lý thu chi lớp học</div>
          </div>
        </div>
        <Card className="p-5">
          <h1 className="font-head text-xl font-semibold">{title}</h1>
          {sub && <p className="mb-4 mt-1 text-sm text-ink3">{sub}</p>}
          <div className={sub ? '' : 'mt-4'}>{children}</div>
        </Card>
        {foot && <div className="mt-4 text-center text-sm text-ink3">{foot}</div>}
        <div className="mt-4 text-center">
          <Link to="/" className="text-sm text-ink3 underline hover:text-ink">Xem số liệu mà không đăng nhập</Link>
        </div>
      </motion.div>
    </div>
  );
}

const loginSchema = z.object({
  email: z.string().min(1, 'Nhập email').email('Email không đúng định dạng'),
  password: z.string().min(1, 'Nhập mật khẩu'),
});

export function LoginPage() {
  const { signIn, session } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [err, setErr] = useState('');
  const form = useForm<z.infer<typeof loginSchema>>({ resolver: zodResolver(loginSchema) });

  if (session) return <Navigate to="/" replace />;

  return (
    <Shell
      title="Đăng nhập"
      sub="Dành cho lớp trưởng, thủ quỹ và sinh viên đã được mời."
      foot={<>Chưa có tài khoản? <Link to="/dang-ky" className="underline">Đăng ký bằng email đã được mời</Link></>}
    >
      <form
        onSubmit={form.handleSubmit(async (v) => {
          setErr('');
          try {
            await signIn(v.email, v.password);
            toast.ok('Đăng nhập thành công');
            nav('/', { replace: true });
          } catch (e) {
            setErr(e instanceof Error ? e.message : 'Không đăng nhập được');
          }
        })}
        noValidate
      >
        {err && <div className="mb-3"><Note tone="warn">{err}</Note></div>}
        <Field label="Email" required error={form.formState.errors.email?.message}>
          <Input type="email" autoComplete="email" autoFocus
            aria-invalid={Boolean(form.formState.errors.email)} {...form.register('email')} />
        </Field>
        <Field label="Mật khẩu" required error={form.formState.errors.password?.message}>
          <Input type="password" autoComplete="current-password"
            aria-invalid={Boolean(form.formState.errors.password)} {...form.register('password')} />
        </Field>
        <Button type="submit" variant="primary" className="w-full" loading={form.formState.isSubmitting}>
          Đăng nhập
        </Button>
        <div className="mt-3 text-center">
          <Link to="/quen-mat-khau" className="text-sm text-ink3 underline hover:text-ink">Quên mật khẩu?</Link>
        </div>
      </form>
    </Shell>
  );
}

const signupSchema = z.object({
  fullName: z.string().min(2, 'Nhập họ tên của bạn'),
  email: z.string().min(1, 'Nhập email').email('Email không đúng định dạng'),
  password: z.string().min(8, 'Mật khẩu cần ít nhất 8 ký tự'),
});

export function SignupPage() {
  const { signUp } = useAuth();
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);
  const form = useForm<z.infer<typeof signupSchema>>({ resolver: zodResolver(signupSchema) });

  if (done) {
    return (
      <Shell title="Kiểm tra hộp thư" sub="Tài khoản đã được tạo.">
        <Note tone="ok">
          Nếu hệ thống yêu cầu xác nhận email, hãy mở link trong hộp thư rồi đăng nhập.
        </Note>
        <Button variant="primary" className="mt-4 w-full" onClick={() => { window.location.href = '/dang-nhap'; }}>
          Tới trang đăng nhập
        </Button>
      </Shell>
    );
  }

  return (
    <Shell
      title="Đăng ký"
      sub="Chỉ email đã được quản trị lớp mời mới đăng ký được. Người đăng ký đầu tiên của hệ thống trở thành chủ sở hữu."
      foot={<>Đã có tài khoản? <Link to="/dang-nhap" className="underline">Đăng nhập</Link></>}
    >
      <form
        onSubmit={form.handleSubmit(async (v) => {
          setErr('');
          try {
            await signUp(v.email, v.password, v.fullName);
            setDone(true);
          } catch (e) {
            setErr(e instanceof Error ? e.message : 'Không đăng ký được');
          }
        })}
        noValidate
      >
        {err && <div className="mb-3"><Note tone="warn">{err}</Note></div>}
        <Field label="Họ và tên" required error={form.formState.errors.fullName?.message}>
          <Input autoFocus autoComplete="name" {...form.register('fullName')} />
        </Field>
        <Field label="Email đã được mời" required error={form.formState.errors.email?.message}>
          <Input type="email" autoComplete="email" {...form.register('email')} />
        </Field>
        <Field label="Mật khẩu" required hint="Ít nhất 8 ký tự."
          error={form.formState.errors.password?.message}>
          <Input type="password" autoComplete="new-password" {...form.register('password')} />
        </Field>
        <Button type="submit" variant="primary" className="w-full" loading={form.formState.isSubmitting}>
          Tạo tài khoản
        </Button>
      </form>
    </Shell>
  );
}

export function ForgotPasswordPage() {
  const { sendReset } = useAuth();
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState('');
  const form = useForm<{ email: string }>();

  return (
    <Shell title="Quên mật khẩu" sub="Nhập email, hệ thống sẽ gửi link đặt lại mật khẩu.">
      {sent ? (
        <Note tone="ok">Đã gửi email. Hãy mở link trong hộp thư để đặt mật khẩu mới.</Note>
      ) : (
        <form
          onSubmit={form.handleSubmit(async (v) => {
            setErr('');
            try {
              await sendReset(v.email);
              setSent(true);
            } catch (e) {
              setErr(e instanceof Error ? e.message : 'Không gửi được email');
            }
          })}
          noValidate
        >
          {err && <div className="mb-3"><Note tone="warn">{err}</Note></div>}
          <Field label="Email" required>
            <Input type="email" autoFocus {...form.register('email', { required: true })} />
          </Field>
          <Button type="submit" variant="primary" className="w-full" loading={form.formState.isSubmitting}>
            Gửi link đặt lại
          </Button>
        </form>
      )}
      <div className="mt-3 text-center">
        <Link to="/dang-nhap" className="text-sm text-ink3 underline hover:text-ink">Về trang đăng nhập</Link>
      </div>
    </Shell>
  );
}

export function ResetPasswordPage() {
  const { updatePassword } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [err, setErr] = useState('');
  const form = useForm<{ password: string }>();

  return (
    <Shell title="Đặt mật khẩu mới">
      <form
        onSubmit={form.handleSubmit(async (v) => {
          setErr('');
          try {
            await updatePassword(v.password);
            toast.ok('Đã đổi mật khẩu');
            nav('/', { replace: true });
          } catch (e) {
            setErr(e instanceof Error ? e.message : 'Không đổi được mật khẩu');
          }
        })}
        noValidate
      >
        {err && <div className="mb-3"><Note tone="warn">{err}</Note></div>}
        <Field label="Mật khẩu mới" required hint="Ít nhất 8 ký tự.">
          <Input type="password" autoFocus autoComplete="new-password"
            {...form.register('password', { required: true, minLength: 8 })} />
        </Field>
        <Button type="submit" variant="primary" className="w-full" loading={form.formState.isSubmitting}>
          Lưu mật khẩu
        </Button>
      </form>
    </Shell>
  );
}
