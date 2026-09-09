import { expect, test } from '@playwright/test';
import { stubSupabase } from './fixtures';

test.describe('Thu tiền bằng QR', () => {
  test('mã QR mang đúng số tiền còn thiếu, số tài khoản và mã SV', async ({ page }) => {
    await stubSupabase(page, { role: 'treasurer' });
    await page.goto('/lop');
    await expect(page.locator('main table')).toBeVisible();

    // bấm vào Ô CÔNG NỢ của đợt Quỹ Lớp ⇒ hộp thoại chọn đúng đợt đó (còn thiếu 20.000)
    await page.getByRole('row').filter({ hasText: 'Lê Thị Thử' })
      .getByTitle(/Mở QR chuyển khoản cho đợt/).first().click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('1021234567')).toBeVisible();
    await expect(dialog.getByText('Vietcombank')).toBeVisible();
    // nội dung chuyển khoản phải chứa mã SV để đối chiếu sao kê
    await expect(dialog.getByText(/2400000002/).first()).toBeVisible();
    // vẽ được ảnh QR ngay trên máy
    await expect(dialog.locator('svg').first()).toBeVisible();
  });

  test('xác nhận đã nhận tiền thì ghi khoản thu dạng chuyển khoản', async ({ page }) => {
    const sent = await stubSupabase(page, { role: 'treasurer' });
    await page.goto('/lop');
    await expect(page.locator('main table')).toBeVisible();
    // mở từ Ô CÔNG NỢ của một đợt ⇒ chỉ ghi cho đúng đợt đó
    await page.getByRole('row').filter({ hasText: 'Phạm Minh Ví' })
      .getByTitle(/Mở QR chuyển khoản cho đợt/).first().click();

    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: /Đã nhận được tiền/ }).click();

    const post = sent.find((s) => s.method === 'POST' && s.table === 'incomes');
    const rows = post!.body as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      student_id: 's3', fund: 'QUY_LOP', amount: 50000, method: 'TRANSFER', note: 'Chuyển khoản QR',
    });
  });

  test('có nhiều đợt thì chọn được đợt, và gộp tất cả đợt còn nợ', async ({ page }) => {
    await stubSupabase(page, { role: 'treasurer' });
    await page.goto('/lop');
    await expect(page.locator('main table')).toBeVisible();
    // Lê Thị Thử còn nợ 20.000 (Quỹ Lớp) + 20.000 (Quỹ Đoàn)
    await page.getByRole('row').filter({ hasText: 'Lê Thị Thử' })
      .getByRole('button', { name: /QR chuyển khoản của/ }).click();

    const dialog = page.getByRole('dialog');
    const picker = dialog.locator('#qr-period');
    await expect(picker).toBeVisible();
    // mặc định gộp cả hai đợt vì đang nợ nhiều hơn một đợt
    await expect(picker).toHaveValue('__all');
    await expect(dialog.locator('ul > li')).toHaveCount(2);          // mỗi đợt một dòng
    await expect(dialog.getByText('40.000 ₫', { exact: false }).first()).toBeVisible();
    await expect(dialog.getByText(/chia cho 2 quỹ/)).toBeVisible();

    // chọn riêng một đợt thì phần "sẽ ghi vào" chỉ còn một dòng
    await picker.selectOption('p2');
    const allocation = dialog.locator('ul > li');
    await expect(allocation).toHaveCount(1);
    await expect(allocation.first()).toContainText('Quỹ Đoàn học kỳ I');
    await expect(allocation.first()).toContainText('20.000 ₫');
    await expect(dialog.getByText(/chia cho 2 quỹ/)).toHaveCount(0);
  });

  test('gộp nhiều đợt thì tách thành nhiều khoản thu theo từng đợt', async ({ page }) => {
    const sent = await stubSupabase(page, { role: 'treasurer' });
    await page.goto('/lop');
    await expect(page.locator('main table')).toBeVisible();
    await page.getByRole('row').filter({ hasText: 'Lê Thị Thử' })
      .getByRole('button', { name: /QR chuyển khoản của/ }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.locator('#qr-period')).toHaveValue('__all');
    await dialog.getByRole('button', { name: /Đã nhận được tiền/ }).click();

    const post = sent.find((s) => s.method === 'POST' && s.table === 'incomes');
    expect(Array.isArray(post!.body), 'phải gửi nhiều dòng, mỗi đợt một dòng').toBe(true);
    const rows = post!.body as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    // mỗi dòng thuộc đúng quỹ của đợt tương ứng — gộp làm một dòng sẽ làm sai số liệu hai quỹ
    expect(rows.map((r) => [r.period_id, r.fund, r.amount])).toEqual(
      expect.arrayContaining([['p1', 'QUY_LOP', 20000], ['p2', 'QUY_DOAN', 20000]]),
    );
    expect(rows.every((r) => r.method === 'TRANSFER')).toBe(true);
  });

  test('QR cả lớp: mỗi sinh viên còn nợ một mã riêng', async ({ page }) => {
    await stubSupabase(page, { role: 'treasurer' });
    await page.goto('/dot-thu');
    await page.waitForTimeout(400);
    await page.getByRole('button', { name: 'QR cả lớp' }).first().click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(/2\/3 sinh viên còn phải nộp/)).toBeVisible();
    await expect(dialog.locator('figure')).toHaveCount(2);
    await expect(dialog.locator('figure svg')).toHaveCount(2);
    await expect(dialog.getByText('Lê Thị Thử')).toBeVisible();
    await expect(dialog.getByText('Trần Văn Mẫu')).toHaveCount(0);   // đã nộp đủ đợt này

    // chuyển sang "tất cả đợt còn nợ": mã gộp cả hai đợt nên số tiền lớn hơn
    await dialog.getByRole('button', { name: 'Tất cả đợt còn nợ' }).click();
    await expect(dialog.getByText('40.000 ₫', { exact: false }).first()).toBeVisible();
    await expect(dialog.getByText('2 đợt').first()).toBeVisible();
  });
});
