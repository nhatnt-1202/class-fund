import { motion } from 'framer-motion';
import { QrCode } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useAuth } from '@/app/AuthProvider';
import { usePrefs } from '@/app/ThemeProvider';
import { useToast } from '@/app/ToastProvider';
import { Badge, Button, Card, CardHead, Chip, Field, Input, Note, Select } from '@/components/ui';
import { useSaveSettings, useSettings } from '@/data/api';
import { can } from '@/lib/permissions';
import { pageVariants } from '@/lib/motion';
import { BANKS, bankName, buildVietQr, qrSvg, transferNote } from '@/lib/vietqr';
import { FUNDS } from '@/types/db';

export default function SettingsPage() {
  const { role } = useAuth();
  const prefs = usePrefs();
  const toast = useToast();
  const { data: settings, isLoading } = useSettings(role);
  const save = useSaveSettings();
  const editable = can.editSettings(role);

  const [form, setForm] = useState({
    class_name: '', faculty: '', term: '', school_year: '',
    bank_bin: '', account_no: '', account_name: '', note_template: '{ma} {dot}',
    hide_student_names_from_guest: false,
  });
  const [otherBin, setOtherBin] = useState(false);
  const [err, setErr] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!settings) return;
    setForm({
      class_name: settings.class_name, faculty: settings.faculty, term: settings.term,
      school_year: settings.school_year, bank_bin: settings.bank_bin, account_no: settings.account_no,
      account_name: settings.account_name, note_template: settings.note_template,
      hide_student_names_from_guest: settings.hide_student_names_from_guest,
    });
    setOtherBin(Boolean(settings.bank_bin) && !BANKS.some((b) => b.bin === settings.bank_bin));
  }, [settings]);

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  const previewNote = transferNote(form.note_template, {
    code: '2400000001', name: 'Trần Văn Mẫu', period: 'Quỹ lớp HK1',
    fund: FUNDS.QUY_LOP.label, className: form.class_name,
  });
  const previewQr = qrSvg(buildVietQr({
    bin: form.bank_bin, accountNo: form.account_no, amount: 50000, description: previewNote,
  }), 4);

  const saveClass = () => {
    save.mutate(
      {
        class_name: form.class_name.trim(), faculty: form.faculty.trim(),
        term: form.term.trim(), school_year: form.school_year.trim(),
        hide_student_names_from_guest: form.hide_student_names_from_guest,
      },
      {
        onSuccess: () => toast.ok('Đã lưu thông tin lớp'),
        onError: (e) => toast.err('Không lưu được', e instanceof Error ? e.message : undefined),
      },
    );
  };

  const saveBank = () => {
    const e: Record<string, string> = {};
    if (!/^\d{6}$/.test(form.bank_bin)) e.bin = 'Chọn ngân hàng, hoặc nhập mã BIN gồm 6 chữ số';
    if (!/^\d{6,20}$/.test(form.account_no)) e.acc = 'Số tài khoản chỉ gồm chữ số, dài 6–20 ký tự';
    setErr(e);
    if (Object.keys(e).length > 0) return;
    save.mutate(
      {
        bank_bin: form.bank_bin,
        bank_name: bankName(form.bank_bin),
        account_no: form.account_no.trim(),
        account_name: form.account_name.trim(),
        note_template: form.note_template.trim() || '{ma} {dot}',
      },
      {
        onSuccess: () => toast.ok('Đã lưu tài khoản nhận tiền', `${bankName(form.bank_bin)} · ${form.account_no}`),
        onError: (ex) => toast.err('Không lưu được', ex instanceof Error ? ex.message : undefined),
      },
    );
  };

  const bankReady = /^\d{6}$/.test(form.bank_bin) && Boolean(form.account_no);

  return (
    <motion.div variants={pageVariants} initial="hidden" animate="show"
      className="grid gap-4 xl:grid-cols-2">
      <Card>
        <CardHead title="Thông tin lớp" />
        <div className="p-4">
          {isLoading ? (
            <div className="skel h-24" />
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Mã lớp">
                  <Input value={form.class_name} onChange={(e) => set('class_name', e.target.value)}
                    disabled={!editable} placeholder="DCXDXD69_03B" />
                </Field>
                <Field label="Khoa">
                  <Input value={form.faculty} onChange={(e) => set('faculty', e.target.value)}
                    disabled={!editable} placeholder="Xây dựng" />
                </Field>
                <Field label="Học kỳ">
                  <Input value={form.term} onChange={(e) => set('term', e.target.value)}
                    disabled={!editable} placeholder="Học kỳ I" />
                </Field>
                <Field label="Năm học">
                  <Input value={form.school_year} onChange={(e) => set('school_year', e.target.value)}
                    disabled={!editable} placeholder="2026-2027" />
                </Field>
              </div>
              <label className="mb-3 flex min-h-[44px] cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  className="h-[18px] w-[18px] min-h-0 accent-[rgb(var(--c-brand))]"
                  checked={form.hide_student_names_from_guest}
                  disabled={!editable}
                  onChange={(e) => set('hide_student_names_from_guest', e.target.checked)}
                />
                <span className="text-sm">
                  Ẩn tên sinh viên với khách chưa đăng nhập
                  <span className="block text-xs text-ink3">
                    Bật thì khách chỉ thấy “Trần V. M.” và mã SV bị che một phần. Ngày sinh luôn được ẩn với khách.
                  </span>
                </span>
              </label>
              {editable && <Button variant="primary" size="sm" loading={save.isPending} onClick={saveClass}>Lưu thông tin lớp</Button>}
              {!editable && <Note tone="info"><span>Chỉ quản trị lớp sửa được các thông tin này.</span></Note>}
            </>
          )}
        </div>
      </Card>

      <Card>
        <CardHead
          title="Tài khoản nhận chuyển khoản (VietQR)"
          actions={bankReady ? <Badge tone="ok">Đã cấu hình</Badge> : <Badge tone="warn">Chưa cấu hình</Badge>}
        />
        <div className="p-4">
          <p className="mb-3 text-sm text-ink3">
            Nhập tài khoản của thủ quỹ. App tự sinh mã QR riêng cho từng sinh viên — quét là chuyển đúng
            số tiền, đúng nội dung. Mã được vẽ ngay trên máy, số tài khoản <b>không</b> gửi ra dịch vụ nào.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Ngân hàng" error={err.bin}>
              <Select
                value={otherBin ? '__other' : form.bank_bin}
                disabled={!editable}
                onChange={(e) => {
                  if (e.target.value === '__other') { setOtherBin(true); set('bank_bin', ''); }
                  else { setOtherBin(false); set('bank_bin', e.target.value); }
                }}
              >
                <option value="">— Chọn ngân hàng —</option>
                {BANKS.map((b) => <option key={b.bin} value={b.bin}>{b.name} ({b.bin})</option>)}
                <option value="__other">Khác — tự nhập mã BIN</option>
              </Select>
            </Field>
            <Field label="Số tài khoản" error={err.acc}>
              <Input value={form.account_no} onChange={(e) => set('account_no', e.target.value)}
                disabled={!editable} inputMode="numeric" placeholder="1021234567" />
            </Field>
          </div>
          {otherBin && (
            <Field label="Mã BIN ngân hàng (6 số)">
              <Input value={form.bank_bin} onChange={(e) => set('bank_bin', e.target.value)}
                disabled={!editable} inputMode="numeric" maxLength={6} />
            </Field>
          )}
          <Field label="Tên chủ tài khoản">
            <Input value={form.account_name} onChange={(e) => set('account_name', e.target.value)}
              disabled={!editable} placeholder="NGUYEN VAN A" />
          </Field>
          <Field
            label="Mẫu nội dung chuyển khoản"
            hint={<>
              Dùng được <code>{'{ma}'}</code> mã SV · <code>{'{ten}'}</code> họ tên · <code>{'{dot}'}</code> tên đợt ·
              {' '}<code>{'{quy}'}</code> tên quỹ · <code>{'{lop}'}</code> mã lớp. Tự bỏ dấu, in hoa, tối đa 25 ký tự.
              <br />Xem trước: <b>{previewNote || '(trống)'}</b>
            </>}
          >
            <Input value={form.note_template} onChange={(e) => set('note_template', e.target.value)}
              disabled={!editable} placeholder="{ma} {dot}" />
          </Field>

          {bankReady && (
            <div className="mb-3 flex items-start gap-3 rounded-[10px] border border-line bg-surface2 p-3">
              <div className="qr-svg w-[110px] shrink-0 rounded bg-white p-1"
                // eslint-disable-next-line react/no-danger -- SVG do app tự sinh từ payload
                dangerouslySetInnerHTML={{ __html: previewQr }}
              />
              <div className="text-[13px] text-ink3">
                <div className="flex items-center gap-1 font-semibold text-ink">
                  <QrCode className="h-4 w-4" aria-hidden /> Xem thử mã QR
                </div>
                <p className="mt-1">
                  Mã mẫu ở đây là cho một khoản 50.000 ₫. <b>Hãy quét thử bằng app ngân hàng của bạn</b> để
                  chắc chắn nhận đúng số tiền và nội dung trước khi gửi cho cả lớp.
                </p>
              </div>
            </div>
          )}
          {editable && <Button variant="primary" size="sm" loading={save.isPending} onClick={saveBank}>Lưu tài khoản</Button>}
        </div>
      </Card>

      <Card>
        <CardHead title="Hiển thị & khả năng tiếp cận" sub="Tuỳ chọn này chỉ áp dụng cho máy của bạn." />
        <div className="p-4">
          <Field label="Giao diện">
            <div className="flex flex-wrap gap-2">
              {([['light', 'Sáng'], ['dark', 'Tối'], ['auto', 'Theo hệ thống']] as const).map(([v, l]) => (
                <Chip key={v} on={prefs.theme === v} onClick={() => prefs.set({ theme: v })}>{l}</Chip>
              ))}
            </div>
          </Field>
          <Field label="Cỡ chữ">
            <div className="flex flex-wrap gap-2">
              {([[1, 'Vừa'], [1.12, 'Lớn'], [1.25, 'Rất lớn']] as const).map(([v, l]) => (
                <Chip key={l} on={prefs.fontScale === v} onClick={() => prefs.set({ fontScale: v })}>{l}</Chip>
              ))}
            </div>
          </Field>
          <label className="flex min-h-[44px] cursor-pointer items-center gap-2">
            <input type="checkbox" className="h-[18px] w-[18px] min-h-0 accent-[rgb(var(--c-brand))]"
              checked={prefs.reading} onChange={(e) => prefs.set({ reading: e.target.checked })} />
            <span className="text-sm">Chế độ dễ đọc <span className="text-ink3">(giãn dòng, giãn chữ, chữ to hơn)</span></span>
          </label>
          <label className="flex min-h-[44px] cursor-pointer items-center gap-2">
            <input type="checkbox" className="h-[18px] w-[18px] min-h-0 accent-[rgb(var(--c-brand))]"
              checked={prefs.noMotion} onChange={(e) => prefs.set({ noMotion: e.target.checked })} />
            <span className="text-sm">Giảm chuyển động <span className="text-ink3">(tắt hiệu ứng trượt, count-up)</span></span>
          </label>
        </div>
      </Card>

      <Card>
        <CardHead title="Về ứng dụng" />
        <div className="space-y-2 p-4 text-sm text-ink3">
          <p>
            Tồn quỹ luôn được database tính lại từ bản ghi thu/chi: <b className="text-ink2">Tồn(quỹ) = Σ Thu − Σ Chi</b>.
            Không có ô nhập tồn quỹ tay, nên số liệu không thể bị sửa ngầm.
          </p>
          <p>
            Phân quyền do <b className="text-ink2">Row Level Security</b> trong Postgres thực thi. Giao diện ẩn nút
            chỉ để cho gọn — kể cả gọi API trực tiếp cũng không vượt được quyền.
          </p>
          <p>
            Mọi thao tác ghi đều để lại vết trong <b className="text-ink2">Lịch sử thao tác</b>, do trigger của
            database ghi và không ai sửa được.
          </p>
          <p>
            Đối soát chuyển khoản tự động với ngân hàng <b className="text-ink2">chưa</b> có: thủ quỹ xem sao kê
            rồi bấm xác nhận trên từng khoản.
          </p>
        </div>
      </Card>
    </motion.div>
  );
}
