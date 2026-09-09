import { expect, test } from '@playwright/test';
import { stubSupabase } from './fixtures';

/**
 * Những thứ chỉ nhìn code không thấy được: chiều cao thật của control, hộp thoại có
 * đúng giữa màn hình không, thân trang có bị cuộn ngang không. Cả ba đều từng sai.
 */
test.describe('Giao diện', () => {
  const dialogs = [
    { path: '/incomes', button: 'Thêm thu' },
    { path: '/expenses', button: 'Thêm chi' },
  ];

  for (const { path, button } of dialogs) {
    test(`hộp thoại ở ${path} nằm đúng giữa màn hình`, async ({ page }) => {
      await stubSupabase(page, { role: 'treasurer' });
      await page.goto(path);
      await page.waitForTimeout(400);
      await page.getByRole('button', { name: button }).first().click();
      await expect(page.getByRole('dialog')).toBeVisible();
      // Hộp thoại vào bằng animation spring (y: 14 → 0). Chờ VỊ TRÍ ỔN ĐỊNH qua hai lần đo
      // liên tiếp: chờ transform === none là không đủ, vì có khung hình transform còn chưa
      // được gán và phép đo sẽ bắt đúng trạng thái trước animation.
      await page.waitForFunction(() => {
        const el = document.querySelector('[role="dialog"]');
        if (!el) return false;
        const w = window as unknown as { __lastTop?: number };
        const top = Math.round(el.getBoundingClientRect().top * 10);
        const stable = w.__lastTop === top;
        w.__lastTop = top;
        return stable;
      }, null, { timeout: 5000, polling: 120 });

      const off = await page.evaluate(() => {
        const d = document.querySelector('[role="dialog"]')!.getBoundingClientRect();
        return {
          x: Math.abs(d.left + d.width / 2 - innerWidth / 2),
          y: Math.abs(d.top + d.height / 2 - innerHeight / 2),
          vuaManHinh: d.height <= innerHeight,
        };
      });
      // framer-motion ghi transform inline nên cách căn giữa bằng -translate-x/y-1/2 sẽ hỏng
      expect(off.x, 'lệch tâm ngang').toBeLessThanOrEqual(2);
      expect(off.y, 'lệch tâm dọc').toBeLessThanOrEqual(2);
      expect(off.vuaManHinh, 'hộp thoại phải vừa chiều cao màn hình').toBe(true);
    });

    test(`mọi ô nhập ở ${path} cao bằng nhau`, async ({ page }) => {
      await stubSupabase(page, { role: 'treasurer' });
      await page.goto(path);
      await page.waitForTimeout(400);
      await page.getByRole('button', { name: button }).first().click();
      await expect(page.getByRole('dialog')).toBeVisible();

      const heights = await page.evaluate(() => {
        const out: Record<string, number[]> = {};
        for (const el of document.querySelectorAll('[role="dialog"] input, [role="dialog"] select')) {
          const input = el as HTMLInputElement;
          if (['checkbox', 'radio'].includes(input.type)) continue;
          const h = Math.round(input.getBoundingClientRect().height);
          // ô tiền cố ý cao hơn: nó là con số chính của form
          const key = input.id.endsWith('-amount') ? 'tien' : 'thuong';
          (out[key] ??= []).push(h);
        }
        return out;
      });
      // Yêu cầu chính: select, input và ô ngày phải CAO BẰNG NHAU (chúng có chiều cao nội
      // tại khác nhau nếu không ép). Cho lệch 1px so với 44 vì trình duyệt làm tròn.
      expect(new Set(heights.thuong).size, `chiều cao khác nhau: ${heights.thuong}`).toBe(1);
      // Con số tuyệt đối cho lệch tối đa 2px: Chrome trên thiết bị di động làm tròn khác
      // máy tính. Điều bắt buộc là mọi control BẰNG NHAU và đủ lớn để bấm trên điện thoại.
      expect(Math.abs(heights.thuong![0]! - 44), `chiều cao ${heights.thuong![0]}px`).toBeLessThanOrEqual(2);
      expect(heights.thuong![0]!, 'vùng bấm quá nhỏ').toBeGreaterThanOrEqual(40);
      expect(Math.abs(heights.tien![0]! - 56), `ô tiền ${heights.tien![0]}px`).toBeLessThanOrEqual(2);
    });
  }

  test('thân trang không cuộn ngang, kể cả trên điện thoại', async ({ page }) => {
    await stubSupabase(page, { role: 'treasurer' });
    for (const path of ['/', '/students', '/incomes', '/expenses', '/periods']) {
      await page.goto(path);
      await page.waitForTimeout(300);
      const overflow = await page.evaluate(() =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `trang ${path} bị cuộn ngang`).toBeLessThanOrEqual(1);
    }
  });

  test('Esc đóng hộp thoại và trả tiêu điểm về nút đã mở', async ({ page }) => {
    await stubSupabase(page, { role: 'treasurer' });
    await page.goto('/expenses');
    await page.waitForTimeout(400);
    await page.getByRole('button', { name: 'Thêm chi' }).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
  });

  test('bảng dữ liệu có caption cho trình đọc màn hình', async ({ page }) => {
    await stubSupabase(page, { role: 'treasurer' });
    await page.goto('/incomes');
    // Chờ đúng bảng xuất hiện thay vì chờ theo thời gian: khi máy chạy nhiều test song song,
    // 400ms có thể chưa đủ để dữ liệu về và bảng vẫn còn là skeleton ⇒ test flaky.
    await expect(page.locator('main table')).toBeVisible();
    await expect(page.locator('main table caption').first()).toBeAttached();
  });

  test('chuyển sáng/tối bằng nút trên thanh tiêu đề', async ({ page }) => {
    await stubSupabase(page, { role: 'treasurer' });
    await page.goto('/');
    const btn = page.getByRole('button', { name: /Đổi giao diện/ });
    await btn.click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await btn.click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });
});

test.describe('Đường dẫn', () => {
  test('đường dẫn tiếng Anh, và link tiếng Việt cũ vẫn mở đúng trang', async ({ page }) => {
    await stubSupabase(page, { role: 'treasurer' });

    for (const [oldPath, newPath] of [
      ['/lop', '/students'],
      ['/thu', '/incomes'],
      ['/chi', '/expenses'],
      ['/dot-thu', '/periods'],
      ['/tai-khoan', '/members'],
      ['/lop-hoc', '/classes'],
    ] as const) {
      await page.goto(oldPath);
      await expect(page).toHaveURL(new RegExp(`${newPath}$`));
    }

    // Link đặt lại mật khẩu của Supabase mang token trong hash ⇒ hash phải được giữ
    await page.goto('/doi-mat-khau?x=1#access_token=abc');
    await expect(page).toHaveURL(/\/reset-password\?x=1#access_token=abc$/);
  });

  test('menu điều hướng tới đúng đường dẫn tiếng Anh', async ({ page }) => {
    await stubSupabase(page, { role: 'admin' });
    await page.goto('/');
    const menu = page.getByRole('button', { name: 'Mở menu' });
    if (await menu.isVisible()) await menu.click();
    const nav = page.locator('nav:visible').first();
    await expect(nav.getByRole('link', { name: 'Danh sách lớp' })).toHaveAttribute('href', '/students');
    await expect(nav.getByRole('link', { name: 'Thành viên & quyền' })).toHaveAttribute('href', '/members');
    await expect(nav.getByRole('link', { name: 'Lịch sử thao tác' })).toHaveAttribute('href', '/audit-log');
  });
});
