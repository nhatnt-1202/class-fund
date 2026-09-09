import { expect, test } from '@playwright/test';
import { stubSupabase, type Sent } from './fixtures';

/**
 * Giới hạn trong listbox "Danh sách sinh viên": getByRole('option') nếu để rộng sẽ khớp cả
 * <option> của các thẻ <select> khác trong cùng hộp thoại.
 */
const studentOption = (dialog: ReturnType<import('@playwright/test').Page['getByRole']>, name: RegExp) =>
  dialog.getByRole('listbox', { name: 'Danh sách sinh viên' }).getByRole('option', { name });

/** Chờ app nạp xong dữ liệu đầu tiên. */
async function ready(page: import('@playwright/test').Page) {
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.waitForTimeout(400);
}

test.describe('Ghi khoản thu', () => {
  test('thủ quỹ ghi được khoản thu, gửi lên đúng quỹ và đúng số tiền', async ({ page }) => {
    const sent = await stubSupabase(page, { role: 'treasurer' });
    await page.goto('/thu');
    await ready(page);

    await page.getByRole('button', { name: 'Thêm thu' }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // chọn sinh viên còn thiếu 20.000 ⇒ số tiền phải tự điền đúng phần còn thiếu
    await studentOption(dialog, /Lê Thị Thử/).click();
    await expect(dialog.locator('#in-amount')).toHaveValue('20.000');
    await expect(dialog.getByText(/Sau khoản này/)).toBeVisible();

    await dialog.getByRole('button', { name: 'Ghi nhận thu' }).click();
    await expect(dialog).toBeHidden();

    const post = sent.find((s: Sent) => s.method === 'POST' && s.table === 'incomes');
    expect(post, 'app phải gửi POST /incomes').toBeTruthy();
    expect(post!.body).toMatchObject({
      fund: 'QUY_LOP',
      period_id: 'p1',
      student_id: 's2',
      amount: 20000,
      method: 'CASH',
    });
  });

  test('chọn đợt Quỹ Đoàn thì quỹ đi theo đợt và không sửa được', async ({ page }) => {
    const sent = await stubSupabase(page, { role: 'treasurer' });
    await page.goto('/thu');
    await ready(page);
    await page.getByRole('button', { name: 'Thêm thu' }).first().click();
    const dialog = page.getByRole('dialog');

    await dialog.getByLabel('Đợt thu').selectOption('p2');   // đợt thuộc Quỹ Đoàn
    // nút chọn quỹ bị vô hiệu hoá và Quỹ Đoàn được chọn
    await expect(dialog.getByRole('radio', { name: /Quỹ Đoàn/ })).toHaveAttribute('aria-checked', 'true');
    await expect(dialog.getByRole('radio', { name: /Quỹ Lớp/ })).toBeDisabled();
    await expect(dialog.getByText(/Quỹ đi theo đợt thu đã chọn/)).toBeVisible();

    await studentOption(dialog, /Phạm Minh Ví/).click();
    await expect(dialog.locator('#in-amount')).toHaveValue('20.000');
    await dialog.getByRole('button', { name: 'Ghi nhận thu' }).click();

    const post = sent.find((s) => s.method === 'POST' && s.table === 'incomes');
    expect(post!.body).toMatchObject({ fund: 'QUY_DOAN', period_id: 'p2', amount: 20000 });
  });

  test('cảnh báo khi nộp thừa nhưng vẫn cho lưu', async ({ page }) => {
    const sent = await stubSupabase(page, { role: 'treasurer' });
    await page.goto('/thu');
    await ready(page);
    await page.getByRole('button', { name: 'Thêm thu' }).first().click();
    const dialog = page.getByRole('dialog');

    await studentOption(dialog, /Trần Văn Mẫu/).click();   // đã nộp đủ 50.000
    await dialog.locator('#in-amount').fill('30000');
    await expect(dialog.getByText(/nộp thừa/)).toBeVisible();

    await dialog.getByRole('button', { name: 'Ghi nhận thu' }).click();
    expect(sent.find((s) => s.method === 'POST' && s.table === 'incomes')!.body)
      .toMatchObject({ amount: 30000, student_id: 's1' });
  });

  test('không chọn người nộp thì báo lỗi và không gửi gì lên', async ({ page }) => {
    const sent = await stubSupabase(page, { role: 'treasurer' });
    await page.goto('/thu');
    await ready(page);
    await page.getByRole('button', { name: 'Thêm thu' }).first().click();
    const dialog = page.getByRole('dialog');

    await dialog.getByRole('button', { name: 'Ghi nhận thu' }).click();
    await expect(dialog.getByText('Chọn một sinh viên trong danh sách')).toBeVisible();
    await expect(dialog).toBeVisible();
    expect(sent.filter((s) => s.method === 'POST')).toHaveLength(0);
  });

  test('người thu: chọn từ danh sách hoặc chuyển sang nhập tay', async ({ page }) => {
    const sent = await stubSupabase(page, { role: 'treasurer' });
    await page.goto('/thu');
    await ready(page);
    await page.getByRole('button', { name: 'Thêm thu' }).first().click();
    const dialog = page.getByRole('dialog');

    // mặc định là dropdown, có nhóm "Tôi" và nhóm sinh viên trong lớp
    const select = dialog.locator('#in-collector');
    await expect(select).toBeVisible();
    await select.selectOption({ label: 'Phạm Minh Ví' });

    // chuyển sang nhập tay rồi gõ tên không có trong danh sách
    await dialog.getByRole('button', { name: 'Nhập tay' }).click();
    await dialog.locator('#in-collector').fill('Cô chủ nhiệm');

    await studentOption(dialog, /Lê Thị Thử/).click();
    await dialog.getByRole('button', { name: 'Ghi nhận thu' }).click();

    expect(sent.find((s) => s.method === 'POST' && s.table === 'incomes')!.body)
      .toMatchObject({ collected_by: 'Cô chủ nhiệm' });
  });
});

test.describe('Ghi khoản chi', () => {
  test('chi trong tồn quỹ thì lưu thẳng, không đánh dấu vượt quỹ', async ({ page }) => {
    const sent = await stubSupabase(page, { role: 'treasurer' });
    await page.goto('/chi');
    await ready(page);
    await page.getByRole('button', { name: 'Thêm chi' }).first().click();
    const dialog = page.getByRole('dialog');

    await dialog.locator('#ex-amount').fill('20000');
    await dialog.getByLabel(/Nội dung/).fill('Bút lông viết bảng');
    await dialog.getByRole('button', { name: 'Sự kiện', exact: true }).click();
    await dialog.locator('#ex-buyer').selectOption({ label: 'Phạm Minh Ví' });
    await expect(dialog.getByText(/Sau khoản này còn/)).toBeVisible();

    await dialog.getByRole('button', { name: 'Ghi nhận chi' }).click();
    await expect(dialog).toBeHidden();

    expect(sent.find((s) => s.method === 'POST' && s.table === 'expenses')!.body).toMatchObject({
      fund: 'QUY_LOP', amount: 20000, item: 'Bút lông viết bảng',
      category: 'Sự kiện', buyer: 'Phạm Minh Ví', overdraft: false,
    });
  });

  test('chi vượt tồn quỹ phải xác nhận, và bản ghi bị đánh dấu vượt quỹ', async ({ page }) => {
    const sent = await stubSupabase(page, { role: 'treasurer' });
    await page.goto('/chi');
    await ready(page);
    await page.getByRole('button', { name: 'Thêm chi' }).first().click();
    const dialog = page.getByRole('dialog').first();

    await dialog.locator('#ex-amount').fill('90000');       // tồn Quỹ Lớp chỉ 50.000
    await dialog.getByLabel(/Nội dung/).fill('Thuê loa cho hội diễn');
    await dialog.locator('#ex-buyer').selectOption({ label: 'Phạm Minh Ví' });
    await expect(dialog.getByText(/vượt tồn/)).toBeVisible();

    await dialog.getByRole('button', { name: 'Ghi nhận chi' }).click();
    // chưa gửi gì lên: phải qua bước xác nhận
    expect(sent.filter((s) => s.method === 'POST')).toHaveLength(0);

    const confirm = page.getByRole('dialog').filter({ hasText: 'Chi vượt tồn quỹ' });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Vẫn ghi nhận' }).click();

    await expect.poll(() => sent.filter((s) => s.method === 'POST').length).toBe(1);
    expect(sent.find((s) => s.table === 'expenses')!.body)
      .toMatchObject({ amount: 90000, overdraft: true, fund: 'QUY_LOP' });
  });

  test('thiếu người đi mua thì không lưu được', async ({ page }) => {
    const sent = await stubSupabase(page, { role: 'treasurer' });
    await page.goto('/chi');
    await ready(page);
    await page.getByRole('button', { name: 'Thêm chi' }).first().click();
    const dialog = page.getByRole('dialog');

    await dialog.locator('#ex-amount').fill('10000');
    await dialog.getByLabel(/Nội dung/).fill('Giấy in');
    await dialog.locator('#ex-buyer').selectOption('');
    await dialog.getByRole('button', { name: 'Ghi nhận chi' }).click();

    await expect(dialog.getByText('Chọn hoặc nhập tên người đi mua')).toBeVisible();
    expect(sent.filter((s) => s.method === 'POST')).toHaveLength(0);
  });
});

test.describe('Quỹ âm vì có người ứng tiền mua trước', () => {
  test('tổng quan nói to là quỹ đang âm, kèm số tiền', async ({ page }) => {
    await stubSupabase(page, { role: 'treasurer', negativeFund: true });
    await page.goto('/');
    // con số tồn quỹ mang dấu trừ (− U+2212, không phải dấu gạch nối)
    await expect(page.getByText('−150.000 ₫').first()).toBeVisible();
    // và có cảnh báo nói rõ vì sao âm, không chỉ là một con số đỏ
    await expect(page.getByText(/đang âm/).first()).toBeVisible();
    await expect(page.getByText(/ứng tiền mua trước/).first()).toBeVisible();
  });

  test('khoản chi làm âm quỹ mang dấu vượt quỹ ở trang Chi', async ({ page }) => {
    await stubSupabase(page, { role: 'treasurer', negativeFund: true });
    await page.goto('/chi');
    const row = page.getByRole('row', { name: /Ứng tiền mua nước/ });
    await expect(row).toBeVisible();
    await expect(row.getByText(/vượt quỹ/i)).toBeVisible();
  });

  test('chi tiếp khi quỹ đã âm: cảnh báo tính từ tồn quỹ âm', async ({ page }) => {
    await stubSupabase(page, { role: 'treasurer', negativeFund: true });
    await page.goto('/chi');
    await page.getByRole('button', { name: 'Thêm chi' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(/Số tiền/).fill('10.000');
    await expect(dialog.getByText(/vượt tồn/)).toBeVisible();
    // tồn quỹ hiện tại là số âm, phải hiện đúng dấu trừ chứ không phải 0
    await expect(dialog.getByText(/−150\.000/).first()).toBeVisible();
  });
});
