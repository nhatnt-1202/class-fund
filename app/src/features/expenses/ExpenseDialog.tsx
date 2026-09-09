import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/app/AuthProvider';
import { useToast } from '@/app/ToastProvider';
import { Button, ConfirmModal, Field, Input, Modal, MoneyInput, Note, Select } from '@/components/ui';
import { useBalances, useSaveExpense, useSettings } from '@/data/api';
import { fmtVnd, fmtVndSigned, toInt } from '@/lib/format';
import { FUNDS, FUND_KEYS, type Expense, type Fund } from '@/types/db';

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

  /** Tồn quỹ khả dụng: khi sửa, phải cộng lại số tiền cũ của chính bản ghi này. */
  const available = useMemo(() => {
    const base = balances.data?.find((b) => b.fund === fund)?.balance ?? 0;
    return base + (editing && editing.fund === fund ? toInt(editing.amount) : 0);
  }, [balances.data, fund, editing]);

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
    if (!buyer.trim()) e.buyer = 'Nhập tên người đi mua';
    setErr(e);
    if (Object.keys(e).length > 0) return;
    if (overdraft) setConfirmOverdraft(true);
    else void commit(false);
  };

  return (
    <>
      <Modal
        open={open}
        onOpenChange={onOpenChange}
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
        <Field
          label="Rút từ quỹ nào?"
          required
          hint={<>Tồn quỹ hiện tại của <b>{FUNDS[fund].label}</b>: <b className="num">{fmtVndSigned(available)}</b></>}
        >
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Chọn quỹ">
            {FUND_KEYS.map((f) => {
              const on = fund === f;
              const tone = f === 'QUY_LOP' ? 'border-lop bg-lopSoft text-lopInk' : 'border-doan bg-doanSoft text-doanInk';
              return (
                <button
                  key={f}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setFund(f)}
                  className={`flex min-h-[48px] flex-1 basis-[130px] items-center justify-center gap-2 rounded-[10px]
                    border-2 px-3 font-semibold transition-all duration-200 ease-out hover:-translate-y-px
                    ${on ? tone : 'border-line bg-surface text-ink2'}`}
                >
                  <span className={`h-2 w-2 rounded-full ${f === 'QUY_LOP' ? 'bg-lop' : 'bg-doan'}`} aria-hidden />
                  {FUNDS[f].label}
                </button>
              );
            })}
          </div>
        </Field>

        <div className={`rounded-[10px] border border-line border-l-4 p-3 transition-colors duration-200
          ${fund === 'QUY_LOP' ? 'border-l-lop' : 'border-l-doan'}`}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Ngày chi" required error={err.date}>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="Số tiền (₫)" required error={err.amount}>
              <MoneyInput value={amount} onChange={setAmount} />
            </Field>
          </div>
          <Field label="Nội dung / Mua món gì" required error={err.item}>
            <Input value={item} onChange={(e) => setItem(e.target.value)} autoFocus
              placeholder="VD: Nước + bánh sinh hoạt lớp" />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Danh mục">
              <Select value={category} onChange={(e) => setCategory(e.target.value)}>
                {categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
            </Field>
            <Field label="Người đi mua" required error={err.buyer}>
              <Input list="buyers" value={buyer} onChange={(e) => setBuyer(e.target.value)}
                placeholder="Ai đi mua khoản này?" />
              <datalist id="buyers">
                {buyers.map((b) => <option key={b} value={b} />)}
              </datalist>
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Ghi chú">
              <Input value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
            <Field label="Hoá đơn">
              <label className="flex min-h-[44px] cursor-pointer items-center gap-2">
                <input type="checkbox" className="h-[18px] w-[18px] min-h-0 accent-[rgb(var(--c-brand))]"
                  checked={hasReceipt} onChange={(e) => setHasReceipt(e.target.checked)} />
                <span className="text-sm">Có hoá đơn / ảnh chụp</span>
              </label>
            </Field>
          </div>

          {overdraft && amount > 0 && (
            <Note tone="warn">
              <span>
                Khoản chi <b>{fmtVnd(amount)}</b> vượt tồn quỹ <b>{FUNDS[fund].label}</b>
                {' '}({fmtVndSigned(available)}) — thiếu <b>{fmtVnd(amount - available)}</b>.
                Vẫn lưu được nếu bạn ứng trước, bản ghi sẽ được đánh dấu ⚠ vượt quỹ.
              </span>
            </Note>
          )}
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
            Tồn quỹ <b>{FUNDS[fund].label}</b> chỉ còn <b>{fmtVndSigned(available)}</b> nhưng khoản chi là
            {' '}<b>{fmtVnd(amount)}</b> (thiếu <b>{fmtVnd(amount - available)}</b>).
            <br />Bản ghi sẽ được đánh dấu ⚠ vượt quỹ để cuối kỳ dễ đối chiếu.
          </>
        }
        onConfirm={() => { setConfirmOverdraft(false); void commit(true); }}
      />
    </>
  );
}
