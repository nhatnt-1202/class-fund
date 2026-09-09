import { expect, test } from '@playwright/test';
import { stubSupabase } from './fixtures';

/**
 * Kiểm tra giao diện ứng xử đúng theo vai trò. Phân quyền THẬT do RLS trong Postgres thực thi
 * (đã có 89 phép kiểm tra riêng ở tests/db) — ở đây chỉ kiểm tra app không mời gọi người dùng
 * làm việc họ không có quyền.
 */
test.describe('Khách chưa đăng nhập', () => {
  test('xem được số liệu nhưng không có nút ghi chép', async ({ page }) => {
    await stubSupabase(page);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Tổng quan' })).toBeVisible();

    // thấy tồn quỹ của cả hai quỹ
    await expect(page.getByText('Quỹ Lớp', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Quỹ Đoàn', { exact: true }).first()).toBeVisible();
    // trên điện thoại sidebar bị ẩn nên nút này phải nằm ở thanh tiêu đề
    await expect(page.getByRole('banner').getByRole('link', { name: /Đăng nhập/ })).toBeVisible();

    await page.goto('/thu');
    await expect(page.getByRole('button', { name: 'Thêm thu' })).toHaveCount(0);
    await page.goto('/chi');
    await expect(page.getByRole('button', { name: 'Thêm chi' })).toHaveCount(0);
  });

  test('không thấy menu Tài khoản, Lịch sử thao tác và Nhập/Xuất', async ({ page }) => {
    await stubSupabase(page);
    await page.goto('/');
    const nav = page.getByRole('navigation').first();
    await expect(nav.getByRole('link', { name: 'Tài khoản' })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'Lịch sử thao tác' })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'Nhập / Xuất' })).toHaveCount(0);
  });

  test('danh sách lớp không có cột ngày sinh', async ({ page }) => {
    await stubSupabase(page);
    await page.goto('/lop');
    await expect(page.getByRole('columnheader', { name: /Họ và tên/ })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Ngày sinh' })).toHaveCount(0);
  });

  test('bật che tên thì chỉ thấy tên viết tắt', async ({ page }) => {
    await stubSupabase(page, { hideNamesFromGuest: true });
    await page.goto('/lop');
    await expect(page.getByText('Trần V. M.')).toBeVisible();
    await expect(page.getByText('Trần Văn Mẫu')).toHaveCount(0);
  });
});

test.describe('Thành viên', () => {
  test('đọc được số liệu nhưng không ghi được', async ({ page }) => {
    await stubSupabase(page, { role: 'member' });
    await page.goto('/thu');
    await expect(page.getByRole('heading', { name: 'Thu' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Thêm thu' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Thu theo lô' })).toHaveCount(0);
  });

  test('chỉ xem được QR của chính mình', async ({ page }) => {
    await stubSupabase(page, { role: 'member' });   // profile gắn với s2 = Lê Thị Thử
    await page.goto('/lop');
    await page.waitForTimeout(400);
    const rowMine = page.getByRole('row').filter({ hasText: 'Lê Thị Thử' });
    const rowOther = page.getByRole('row').filter({ hasText: 'Phạm Minh Ví' });
    await expect(rowMine.getByRole('button', { name: /QR chuyển khoản/ })).toHaveCount(1);
    await expect(rowOther.getByRole('button', { name: /QR chuyển khoản/ })).toHaveCount(0);
  });

  test('không vào được trang Tài khoản', async ({ page }) => {
    await stubSupabase(page, { role: 'member' });
    await page.goto('/tai-khoan');
    await expect(page.getByText(/chỉ dành cho quản trị lớp/)).toBeVisible();
  });
});

test.describe('Thủ quỹ và quản trị', () => {
  test('thủ quỹ không tạo được đợt thu', async ({ page }) => {
    await stubSupabase(page, { role: 'treasurer' });
    await page.goto('/dot-thu');
    await page.waitForTimeout(400);
    await expect(page.getByRole('button', { name: 'Tạo đợt thu' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'QR cả lớp' }).first()).toBeVisible();
  });

  test('quản trị tạo được đợt thu và gửi lên đúng dữ liệu', async ({ page }) => {
    const sent = await stubSupabase(page, { role: 'admin' });
    await page.goto('/dot-thu');
    await page.getByRole('button', { name: 'Tạo đợt thu' }).first().click();
    const dialog = page.getByRole('dialog');

    await dialog.getByLabel(/Tên đợt thu/).fill('Quỹ lớp học kỳ II');
    await dialog.locator('#p-amount').fill('75000');
    await dialog.getByRole('radio', { name: /Quỹ Đoàn/ }).click();
    await expect(dialog.getByText(/Dự kiến thu cả đợt/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Tạo đợt thu' }).click();

    expect(sent.find((s) => s.method === 'POST' && s.table === 'periods')!.body).toMatchObject({
      name: 'Quỹ lớp học kỳ II', fund: 'QUY_DOAN', amount_per_student: 75000, status: 'OPEN',
    });
  });

  test('thủ quỹ xem được lịch sử thao tác', async ({ page }) => {
    await stubSupabase(page, { role: 'treasurer' });
    await page.goto('/lich-su');
    await expect(page.getByText(/đã ghi nhận thu 50.000 ₫ từ Trần Văn Mẫu vào Quỹ Lớp/)).toBeVisible();
  });
});
