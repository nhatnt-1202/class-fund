import { expect, test } from '@playwright/test';
import { stubSupabase } from './fixtures';

/**
 * Đăng ký. Điều quan trọng nhất ở đây không phải form mà là ĐIỀU HƯỚNG: app phải đi lại
 * trong chính nó, không được gán window.location. Gán location là một request thật tới máy
 * chủ, và khi người dùng bấm Back thì đường dẫn cũ cũng bị hỏi lại từ máy chủ — nơi nào
 * không có SPA fallback là ra 404 (đúng lỗi đã gặp).
 */
test.describe('Đăng ký', () => {
  test('đăng ký xong rồi bấm Back: vẫn ở trong app, không có request nào ra máy chủ', async ({ page }) => {
    await stubSupabase(page);
    await page.goto('/login');
    await page.getByRole('link', { name: /Đăng ký bằng email trường/ }).click();
    await expect(page).toHaveURL(/\/signup$/);

    await page.getByLabel('Họ và tên').fill('Trần Thử Nghiệm');
    await page.getByRole('textbox', { name: /^Email/ }).fill('2421070527@student.humg.edu.vn');
    await page.getByLabel('Mật khẩu').fill('MatKhau123');
    await page.getByRole('button', { name: 'Tạo tài khoản' }).click();
    await expect(page.getByRole('heading', { name: 'Đăng ký xong' })).toBeVisible();

    /*
     * Dấu mốc chỉ tồn tại trong bộ nhớ của trang: nếu có bất kỳ lần tải lại trang nào thì
     * nó biến mất. Đây là cách phát hiện "điều hướng bằng window.location" mà chỉ nhìn URL
     * sẽ không thấy.
     */
    await page.evaluate(() => { (window as unknown as { __spa?: boolean }).__spa = true; });

    await page.getByRole('button', { name: 'Tới trang đăng nhập' }).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('heading', { name: 'Đăng nhập' })).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __spa?: boolean }).__spa)).toBe(true);

    await page.goBack();
    // Không rơi vào trang lỗi của máy chủ: vẫn là app, và vẫn chưa tải lại lần nào
    await expect(page.locator('#main, form').first()).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __spa?: boolean }).__spa)).toBe(true);
  });

  test('mọi liên kết ở khu đăng nhập/đăng ký đều là điều hướng trong app', async ({ page }) => {
    await stubSupabase(page);
    await page.goto('/signup');
    await page.evaluate(() => { (window as unknown as { __spa?: boolean }).__spa = true; });

    await page.getByRole('link', { name: 'Đăng nhập', exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.getByRole('link', { name: /Quên mật khẩu/ }).click();
    await expect(page).toHaveURL(/\/forgot-password$/);
    await page.getByRole('link', { name: /Về trang đăng nhập/ }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.getByRole('link', { name: /Xem số liệu mà không đăng nhập/ }).click();
    await expect(page).toHaveURL(/:\d+\/$/);

    expect(await page.evaluate(() => (window as unknown as { __spa?: boolean }).__spa)).toBe(true);
  });
});
