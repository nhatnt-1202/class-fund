import { zodResolver } from '@hookform/resolvers/zod';
import { motion } from 'framer-motion';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { useAuth } from '@/app/AuthProvider';
import { useAppConfig } from '@/data/api';
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
            font-head text-lg font-bold text-white shadow-s1" aria-hidden>F</div>
          <div>
            <div className="font-head text-lg font-bold leading-tight">Finance</div>
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
      sub="Dành cho quản trị lớp, thủ quỹ và sinh viên của lớp."
      foot={<>Chưa có tài khoản? <Link to="/signup" className="underline">Đăng ký bằng email trường</Link></>}
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
          <Link to="/forgot-password" className="text-sm text-ink3 underline hover:text-ink">Quên mật khẩu?</Link>
        </div>
      </form>
    </Shell>
  );
}

/**
 * Đăng ký tự do bằng email trường, KHÔNG cần xác nhận email — nhưng phải đúng định dạng
 * <mã sinh viên>@<tên miền của trường>, vì chính mã sinh viên trong email là thứ hệ thống
 * dùng để gắn tài khoản vào đúng lớp (xem handle_new_user trong 0004_multiclass.sql).
 * Email khác định dạng này chỉ vào được khi quản trị lớp đã thêm sẵn.
 */
const signupSchema = z.object({
  fullName: z.string().min(2, 'Nhập họ tên của bạn'),
  email: z.string().min(1, 'Nhập email').email('Email không đúng định dạng'),
  password: z.string().min(8, 'Mật khẩu cần ít nhất 8 ký tự'),
});

/** Tách mã sinh viên trong email nếu đúng tên miền của trường. */
export function studentCodeFromEmail(email: string, domain: string, pattern: string): string | null {
  const [local, host] = email.trim().toLowerCase().split('@');
  if (!local || host !== domain.toLowerCase()) return null;
  try {
    return new RegExp(pattern).test(local) ? local : null;
  } catch {
    return /^[0-9]{8,12}$/.test(local) ? local : null;
  }
}

export function SignupPage() {
  const { signUp } = useAuth();
  const { data: config } = useAppConfig();
  const nav = useNavigate();
  const toast = useToast();
  const [err, setErr] = useState('');
  const [done, setDone] = useState<{ email: string; code: string | null } | null>(null);
  const form = useForm<z.infer<typeof signupSchema>>({ resolver: zodResolver(signupSchema) });

  const domain = config?.student_email_domain ?? 'student.humg.edu.vn';
  const pattern = config?.student_code_pattern ?? '^[0-9]{8,12}$';
  const typed = form.watch('email') ?? '';
  const code = studentCodeFromEmail(typed, domain, pattern);

  if (done) {
    return (
      <Shell title="Đăng ký xong" sub="Không cần xác nhận email — đăng nhập được ngay.">
        <Note tone="ok">
          {done.code
            ? `Tài khoản ${done.email} đã tạo. Hệ thống tự đưa bạn vào lớp có mã sinh viên ${done.code} trong danh sách. Nếu lớp chưa nhập danh sách thì bạn sẽ vào lớp ngay sau khi lớp nhập.`
            : `Tài khoản ${done.email} đã tạo. Bạn sẽ thấy lớp mà quản trị lớp đã thêm bạn vào.`}
        </Note>
        {/*
          * Điều hướng trong app (useNavigate), KHÔNG dùng window.location: gán location là một
          * request thật tới máy chủ, và khi người dùng bấm Back thì /signup cũng bị hỏi lại từ
          * máy chủ — nơi nào không có SPA fallback là ra 404 ngay.
          */}
        <Button variant="primary" className="mt-4 w-full" onClick={() => nav('/login', { replace: true })}>
          Tới trang đăng nhập
        </Button>
      </Shell>
    );
  }

  return (
    <Shell
      title="Đăng ký"
      sub={`Sinh viên tự đăng ký bằng email trường dạng <mã SV>@${domain} — không cần ai mời, không cần xác nhận email.`}
      foot={<>Đã có tài khoản? <Link to="/login" className="underline">Đăng nhập</Link></>}
    >
      <form
        onSubmit={form.handleSubmit(async (v) => {
          setErr('');
          try {
            const { signedIn } = await signUp(v.email, v.password, v.fullName);
            // Không cần xác nhận email ⇒ đã có phiên thì vào thẳng app, khỏi bắt đăng nhập lại
            if (signedIn) {
              toast.ok('Tạo tài khoản xong', code ? `Đã vào lớp có mã sinh viên ${code}` : undefined);
              nav('/', { replace: true });
              return;
            }
            setDone({ email: v.email.trim().toLowerCase(), code });
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
        <Field
          label="Email"
          required
          hint={`Ví dụ: 2421070527@${domain}`}
          error={form.formState.errors.email?.message}
        >
          <Input type="email" autoComplete="email" placeholder={`2421070527@${domain}`}
            {...form.register('email')} />
        </Field>
        {/* Nói ngay khi đang gõ email có được nhận diện là email trường hay không: nếu không,
            tài khoản chỉ vào được lớp khi quản trị lớp đã thêm sẵn email đó. */}
        {typed.includes('@') && (
          <div className="-mt-1 mb-3">
            {code ? (
              <p className="text-[12px] text-income">
                Nhận diện mã sinh viên <b>{code}</b> — bạn sẽ tự vào lớp có mã này trong danh sách.
              </p>
            ) : (
              <p className="text-[12px] text-warn">
                Email này không đúng dạng <b>&lt;mã SV&gt;@{domain}</b>. Vẫn đăng ký được nếu quản trị
                lớp đã thêm email của bạn vào lớp, còn không thì hệ thống sẽ từ chối.
              </p>
            )}
          </div>
        )}
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
        <Link to="/login" className="text-sm text-ink3 underline hover:text-ink">Về trang đăng nhập</Link>
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
