import { AlertTriangle, Receipt } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/app/AuthProvider';
import { useToast } from '@/app/ToastProvider';
import { Badge, Button, ConfirmModal, Field, Input, Modal, Note, Progress } from '@/components/ui';
import { AmountField, FundPicker, PersonField, Section, SummaryBar, Switch } from '@/components/form';
import { useBalances, useSaveExpense, useSettings, useStudents } from '@/data/api';
import { fmtVnd, fmtVndSigned, toInt } from '@/lib/format';
import { can } from '@/lib/permissions';
import { FUNDS, type Expense, type Fund } from '@/types/db';

const DEFAULT_CATEGORIES = ['Sinh hoạt', 'Sự kiện', 'Văn phòng phẩm', 'Quà tặng', 'In ấn', 'Khác'];

export default function ExpenseDialog({
  open, onOpenChange, editing, buyers,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing?: Expense | null;
  buyers: string[];
}) {
  const { role, profile } = useAuth();
  const toast = useToast();
  const save = useSaveExpense();
  const balances = useBalances();
  const students = useStudents(role);
  const { data: settings } = useSettings(role);
  const categories = settings?.categories?.length ? settings.categories : DEFAULT_CATEGORIES;

  const [fund, setFund] = useState<Fund>('QUY_LOP');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState(0);
  const [item, setItem] = useState('');
  const [category, setCategory] = useState(categories[0] ?? 'Khác');
  const [buyer, setBuyer] = useState('');
  const [hasReceipt, setHasReceipt] = useState(false);
  const [note, setNote] = useState('');
  const [err, setErr] = useState<Record<string, string>>({});
  const [confirmOverdraft, setConfirmOverdraft] = useState(false);

  useEffect(() => {
    if (!open) return;
    setErr({});
    setConfirmOverdraft(false);
    if (editing) {
      setFund(editing.fund);
      setDate(editing.date);
      setAmount(toInt(editing.amount));
      setItem(editing.item);
      setCategory(editing.category);
      setBuyer(editing.buyer);
      setHasReceipt(editing.has_receipt);
      setNote(editing.note ?? '');
    } else {
      setFund('QUY_LOP');
      setDate(new Date().toISOString().slice(0, 10));
      setAmount(0);
      setItem('');
      setCategory(categories[0] ?? 'Khác');
      setBuyer(profile?.full_name ?? '');
      setHasReceipt(false);
      setNote('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing?.id]);

  /** Tồn quỹ khả dụng: khi sửa phải cộng lại số tiền cũ của chính bản ghi này. */
  const available = useMemo(() => {
    const base = balances.data?.find((b) => b.fund === fund)?.balance ?? 0;
    return base + (editing && editing.fund === fund ? toInt(editing.amount) : 0);
  }, [balances.data, fund, editing]);

  const remainAfter = available - amount;
  const overdraft = amount > available;

  const commit = async (markOverdraft: boolean) => {
    try {
      await save.mutateAsync({
        id: editing?.id,
        values: {
          date, fund, item: item.trim(), category, buyer: buyer.trim(),
          amount, has_receipt: hasReceipt, note: note.trim(), overdraft: markOverdraft,
        },
      });
      toast.toast(markOverdraft ? 'warn' : 'ok',
        editing ? 'Đã lưu thay đổi' : `Đã ghi nhận chi ${fmtVnd(amount)}`,
        `${FUNDS[fund].label} · ${item.trim()}${markOverdraft ? ' · vượt quỹ' : ''}`);
      onOpenChange(false);
    } catch (ex) {
      toast.err('Không lưu được khoản chi', ex instanceof Error ? ex.message : undefined);
    }
  };

  const submit = () => {
    const e: Record<string, string> = {};
    if (!date) e.date = 'Chọn ngày chi';
    if (amount <= 0) e.amount = 'Số tiền phải lớn hơn 0';
    if (!item.trim()) e.item = 'Nhập nội dung đã mua';
    if (!buyer.trim()) e.buyer = 'Chọn hoặc nhập tên người đi mua';
    setErr(e);
    if (Object.keys(e).length > 0) return;
    if (overdraft) setConfirmOverdraft(true);
    else void commit(false);
  };

  const buyerGroups = [
    ...(profile?.full_name ? [{ label: 'Tôi', names: [profile.full_name] }] : []),
    { label: 'Đã từng đi mua', names: buyers },
    { label: 'Sinh viên trong lớp', names: (students.data ?? []).filter((s) => s.is_active).map((s) => s.full_name) },
  ];

  return (
    <>
      <Modal
        open={open}
        onOpenChange={onOpenChange}
        wide
        title={editing ? 'Sửa khoản chi' : 'Thêm khoản chi'}
        sub="Ghi rõ mua gì, ai đi mua, và rút từ quỹ nào."
        footer={
          <>
            <Button onClick={() => onOpenChange(false)}>Huỷ</Button>
            <Button variant="expense" loading={save.isPending} onClick={submit}>
              {editing ? 'Lưu thay đổi' : 'Ghi nhận chi'}
            </Button>
          </>
        }
      >
        <div className="grid gap-3 lg:grid-cols-2">
          {/* ----- cột trái: tiền và quỹ ----- */}
          <div>
            <Section title="Số tiền" accent={fund}>
              <Field label="Số tiền đã chi" required error={err.amount}>
                <AmountField id="ex-amount" value={amount} onChange={setAmount} />
              </Field>
              <SummaryBar items={[
                { label: `Tồn ${FUNDS[fund].label}`, value: fmtVndSigned(available) },
                { label: 'Sau khoản này còn', value: fmtVndSigned(remainAfter),
                  tone: remainAfter < 0 ? 'bad' : remainAfter < available * 0.2 ? 'warn' : 'ok' },
              ]} />
              {available > 0 && amount > 0 && (
                <div className="mt-2">
                  <Progress value={Math.min(Math.max(amount / available, 0), 1)} fund={fund} />
                  <p className="mt-1 text-xs text-ink3">
                    Khoản này chiếm {Math.round(Math.min(amount / available, 1) * 100)}% tồn quỹ hiện có
                  </p>
                </div>
              )}
            </Section>

            <Section title="Rút từ quỹ nào">
              <Field label="Quỹ" required group>
                <FundPicker value={fund} onChange={setFund} />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Ngày chi" required error={err.date}>
                  <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                </Field>
                <Field label="Hoá đơn" group>
                  <Switch
                    id="ex-receipt"
                    checked={hasReceipt}
                    onChange={setHasReceipt}
                    label={hasReceipt ? 'Có hoá đơn' : 'Không có hoá đơn'}
                  />
                </Field>
              </div>
            </Section>
          </div>

          {/* ----- cột phải: mua gì, ai mua ----- */}
          <div>
            <Section title="Mua gì">
              <Field label="Nội dung" required error={err.item}>
                <Input value={item} onChange={(e) => setItem(e.target.value)} autoFocus
                  placeholder="VD: Nước + bánh sinh hoạt lớp" />
              </Field>
              <Field label="Danh mục" group>
                <div className="flex flex-wrap gap-1.5">
                  {categories.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setCategory(c)}
                      className={`rounded-full border px-3 py-1 text-[13px] transition-colors
                        ${category === c
                          ? 'border-transparent bg-brand font-semibold text-white'
                          : 'border-lineStrong bg-surface hover:bg-surface2'}`}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </Field>
            </Section>

            <Section title="Ai đi mua">
              <Field
                label="Người đi mua"
                required
                group
                error={err.buyer}
                hint="Chọn từ danh sách hoặc bấm “Nhập tay” để gõ tên khác."
              >
                <PersonField
                  id="ex-buyer"
                  value={buyer}
                  onChange={setBuyer}
                  groups={buyerGroups}
                  placeholder="Tên người đi mua"
                />
              </Field>
              <Field label="Ghi chú">
                <Input value={note} onChange={(e) => setNote(e.target.value)}
                  placeholder="VD: mua ở căng tin, đã chia đôi với lớp bên" />
              </Field>
            </Section>

            {overdraft && amount > 0 && (
              <Note tone="warn">
                <span className="flex gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  <span>
                    Khoản chi <b>{fmtVnd(amount)}</b> vượt tồn <b>{FUNDS[fund].label}</b>
                    {' '}({fmtVndSigned(available)}) — thiếu <b>{fmtVnd(amount - available)}</b>.
                    Vẫn lưu được nếu bạn ứng trước; bản ghi sẽ được đánh dấu ⚠ vượt quỹ.
                  </span>
                </span>
              </Note>
            )}
            {!hasReceipt && amount >= 200_000 && (
              <Note tone="info">
                <span className="flex gap-2">
                  <Receipt className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  <span>Khoản này khá lớn mà chưa có hoá đơn — nên giữ lại biên lai để cuối kỳ dễ đối chiếu.</span>
                </span>
              </Note>
            )}
            {!can.writeExpense(role) && (
              <Note tone="warn"><span>Bạn không có quyền ghi khoản chi — hãy nhờ thủ quỹ hoặc quản trị.</span></Note>
            )}
            {editing && (
              <p className="mt-2 text-xs text-ink3">
                Mọi thay đổi đều được ghi vào <Badge>Lịch sử thao tác</Badge> kèm giá trị trước và sau.
              </p>
            )}
          </div>
        </div>
      </Modal>

      <ConfirmModal
        open={confirmOverdraft}
        onOpenChange={setConfirmOverdraft}
        title="Chi vượt tồn quỹ"
        danger
        okLabel="Vẫn ghi nhận"
        loading={save.isPending}
        message={
          <>
            Tồn <b>{FUNDS[fund].label}</b> chỉ còn <b>{fmtVndSigned(available)}</b> nhưng khoản chi là
            {' '}<b>{fmtVnd(amount)}</b> (thiếu <b>{fmtVnd(amount - available)}</b>).
            <br />Bản ghi sẽ được đánh dấu ⚠ vượt quỹ để cuối kỳ dễ đối chiếu.
          </>
        }
        onConfirm={() => { setConfirmOverdraft(false); void commit(true); }}
      />
    </>
  );
}
