import { expect, test } from '@playwright/test';
import { stubSupabase } from './fixtures';

test.describe('Thu tiền bằng QR', () => {
  test('mã QR mang đúng số tiền còn thiếu, số tài khoản và mã SV', async ({ page }) => {
    await stubSupabase(page, { role: 'treasurer' });
    await page.goto('/lop');
    await page.waitForTimeout(400);

    // ô công nợ của Lê Thị Thử ở đợt Quỹ Lớp: còn thiếu 20.000
    await page.getByRole('row').filter({ hasText: 'Lê Thị Thử' })
      .getByRole('button', { name: /QR chuyển khoản của/ }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('1021234567')).toBeVisible();
    await expect(dialog.getByText('Vietcombank')).toBeVisible();
    // nội dung chuyển khoản phải chứa mã SV để đối chiếu sao kê
    await expect(dialog.getByText(/2400000002/)).toBeVisible();
    // vẽ được ảnh QR ngay trên máy
    await expect(dialog.locator('svg').first()).toBeVisible();
  });

  test('xác nhận đã nhận tiền thì ghi khoản thu dạng chuyển khoản', async ({ page }) => {
    const sent = await stubSupabase(page, { role: 'treasurer' });
    await page.goto('/lop');
    await page.waitForTimeout(400);
    await page.getByRole('row').filter({ hasText: 'Phạm Minh Ví' })
      .getByRole('button', { name: /QR chuyển khoản của/ }).click();

    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: /Đã nhận được tiền/ }).click();

    const post = sent.find((s) => s.method === 'POST' && s.table === 'incomes');
    expect(post!.body).toMatchObject({
      student_id: 's3', fund: 'QUY_LOP', amount: 50000, method: 'TRANSFER', note: 'Chuyển khoản QR',
    });
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
    await expect(dialog.getByText('Trần Văn Mẫu')).toHaveCount(0);   // đã nộp đủ
  });
});
