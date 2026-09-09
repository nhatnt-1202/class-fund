import { useEffect, useState } from 'react';
import { useToast } from '@/app/ToastProvider';
import { Button, Field, Input, Modal } from '@/components/ui';
import { useSaveStudent } from '@/data/api';
import { normCode } from '@/lib/format';
import type { Student } from '@/types/db';

export default function StudentDialog({
  open, onOpenChange, editing, defaultClassCode, existingCodes,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing?: Student | null;
  defaultClassCode: string;
  existingCodes: Map<string, string>;   // code → id, để chặn trùng ngay trên form
}) {
  const toast = useToast();
  const save = useSaveStudent();
  const [stt, setStt] = useState('');
  const [code, setCode] = useState('');
  const [lastName, setLastName] = useState('');
  const [firstName, setFirstName] = useState('');
  const [dob, setDob] = useState('');
  const [classCode, setClassCode] = useState('');
  const [note, setNote] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [err, setErr] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setErr({});
    setStt(editing?.stt ? String(editing.stt) : '');
    setCode(editing?.code ?? '');
    setLastName(editing?.last_name ?? '');
    setFirstName(editing?.first_name ?? '');
    setDob(editing?.dob ?? '');
    setClassCode(editing?.class_code || defaultClassCode);
    setNote(editing?.note ?? '');
    setIsActive(editing ? editing.is_active : true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing?.id]);

  const submit = async () => {
    const e: Record<string, string> = {};
    const cleanCode = normCode(code);
    if (!cleanCode) e.code = 'Nhập mã sinh viên';
    else {
      const owner = existingCodes.get(cleanCode);
      if (owner && owner !== editing?.id) e.code = 'Mã này đã có sinh viên khác dùng';
    }
    if (!lastName.trim() && !firstName.trim()) e.name = 'Nhập tên sinh viên';
    setErr(e);
    if (Object.keys(e).length > 0) return;

    try {
      await save.mutateAsync({
        id: editing?.id,
        values: {
          stt: stt ? Number(stt) : undefined,
          code: cleanCode,
          last_name: lastName.trim(),
          first_name: firstName.trim(),
          dob: dob || null,
          class_code: classCode.trim(),
          note: note.trim(),
          is_active: isActive,
        },
      });
      toast.ok(editing ? 'Đã lưu sinh viên' : 'Đã thêm sinh viên', `${lastName} ${firstName}`.trim());
      onOpenChange(false);
    } catch (ex) {
      toast.err('Không lưu được', ex instanceof Error ? ex.message : undefined);
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? 'Sửa sinh viên' : 'Thêm sinh viên'}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Huỷ</Button>
          <Button variant="primary" loading={save.isPending} onClick={() => void submit()}>
            {editing ? 'Lưu' : 'Thêm sinh viên'}
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="STT">
          <Input value={stt} onChange={(e) => setStt(e.target.value)} inputMode="numeric" />
        </Field>
        <Field label="Mã SV" required error={err.code}>
          <Input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoFocus
            aria-invalid={Boolean(err.code)} />
        </Field>
        <Field label="Lớp">
          <Input value={classCode} onChange={(e) => setClassCode(e.target.value)} />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Họ và tên đệm" required error={err.name}>
          <Input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Trần Văn" />
        </Field>
        <Field label="Tên" required>
          <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="An" />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Ngày sinh">
          <Input type="date" value={dob} onChange={(e) => setDob(e.target.value)} />
        </Field>
        <Field label="Ghi chú">
          <Input value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
      {editing && (
        <label className="flex min-h-[44px] cursor-pointer items-center gap-2">
          <input type="checkbox" className="h-[18px] w-[18px] min-h-0 accent-[rgb(var(--c-brand))]"
            checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          <span className="text-sm">
            Còn học trong lớp <span className="text-ink3">(bỏ tick = ẩn khỏi danh sách thu, vẫn giữ lịch sử nộp tiền)</span>
          </span>
        </label>
      )}
    </Modal>
  );
}
