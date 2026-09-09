import { devices, expect, test } from '@playwright/test';
import { stubSupabase } from './fixtures';

/**
 * Những thứ chỉ vỡ trên điện thoại: sidebar thành drawer nên đường vào các trang khác hẳn,
 * bảng nhiều cột dễ làm cả trang cuộn ngang, và hộp thoại dễ cao hơn màn hình.
 */
test.use({ ...devices['Pixel 7'] });

test.describe('Trên điện thoại', () => {
  test('khách thấy nút đăng nhập ngay trên thanh tiêu đề', async ({ page }) => {
    await stubSupabase(page);
    await page.goto('/');
    // sidebar bị ẩn trên điện thoại, nên nút này phải nằm ở thanh tiêu đề
    const header = page.getByRole('banner');
    await expect(header.getByRole('link', { name: /Đăng nhập/ })).toBeVisible();
  });

  test('mở được menu bằng nút hamburger và đi tới trang khác', async ({ page }) => {
    await stubSupabase(page, { role: 'treasurer' });
    await page.goto('/');
    const burger = page.getByRole('button', { name: 'Mở menu' });
    await expect(burger).toBeVisible();
    await burger.click();
    const nav = page.getByRole('navigation').filter({ hasText: 'Danh sách lớp' }).last();
    await nav.getByRole('link', { name: 'Danh sách lớp' }).click();
    await expect(page.getByRole('heading', { name: 'Danh sách lớp' })).toBeVisible();
    // menu tự đóng sau khi điều hướng
    await expect(page.getByRole('button', { name: 'Mở menu' })).toBeVisible();
  });

  test('không trang nào làm cả trang cuộn ngang', async ({ page }) => {
    await stubSupabase(page, { role: 'treasurer' });
    for (const path of ['/', '/students', '/incomes', '/expenses', '/periods', '/import-export', '/settings', '/audit-log']) {
      await page.goto(path);
      await page.waitForTimeout(350);
      const over = await page.evaluate(() =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(over, `trang ${path} bị cuộn ngang ${over}px`).toBeLessThanOrEqual(1);
    }
  });

  test('bảng nhiều cột cuộn ngang trong khung riêng của nó', async ({ page }) => {
    await stubSupabase(page, { role: 'treasurer' });
    await page.goto('/students');
    await expect(page.locator('main table')).toBeVisible();

    // Đo trong expect.poll: React có thể vẽ lại bảng ngay giữa lúc đo, làm querySelector
    // trả null một nhịp và test hoá flaky.
    await expect.poll(async () => page.evaluate(() => {
      const table = document.querySelector('main table');
      if (!table) return 'chua-co-bang';
      let el: HTMLElement | null = table.parentElement;
      while (el && el.tagName !== 'MAIN') {
        if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== 'visible') return 'cuon-trong-khung';
        el = el.parentElement;
      }
      const parentWidth = table.parentElement?.clientWidth ?? 0;
      return table.scrollWidth <= parentWidth + 1 ? 'vua-khit' : 'day-ca-trang';
    }), { timeout: 8000 }).not.toBe('day-ca-trang');
  });

  test('hộp thoại thu vừa màn hình và cuộn được bên trong', async ({ page }) => {
    await stubSupabase(page, { role: 'treasurer' });
    await page.goto('/incomes');
    await page.waitForTimeout(400);
    await page.getByRole('button', { name: 'Thêm thu' }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    const box = await page.evaluate(() => {
      const el = document.querySelector('[role="dialog"]') as HTMLElement;
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, h: r.height, vh: innerHeight, canScroll: el.scrollHeight > el.clientHeight };
    });
    expect(box.top, 'hộp thoại tràn lên trên').toBeGreaterThanOrEqual(-1);
    expect(box.bottom, 'hộp thoại tràn xuống dưới').toBeLessThanOrEqual(box.vh + 1);

    // nút lưu vẫn bấm được (footer dính đáy hộp thoại)
    await expect(dialog.getByRole('button', { name: 'Ghi nhận thu' })).toBeVisible();
  });

  test('form thu xếp một cột, các nhóm không chồng lên nhau', async ({ page }) => {
    await stubSupabase(page, { role: 'treasurer' });
    await page.goto('/incomes');
    await page.waitForTimeout(400);
    await page.getByRole('button', { name: 'Thêm thu' }).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();

    const oneColumn = await page.evaluate(() => {
      const sections = [...document.querySelectorAll('[role="dialog"] section')];
      const lefts = new Set(sections.map((s) => Math.round(s.getBoundingClientRect().left)));
      return lefts.size === 1;      // xếp dọc ⇒ mọi nhóm cùng một mép trái
    });
    expect(oneColumn, 'trên điện thoại các nhóm phải xếp dọc một cột').toBe(true);
  });

  test('vùng bấm của nút chính đủ lớn', async ({ page }) => {
    await stubSupabase(page, { role: 'treasurer' });
    await page.goto('/expenses');
    await page.waitForTimeout(400);
    const small = await page.evaluate(() => {
      const bad: string[] = [];
      for (const el of document.querySelectorAll('main button, header button')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (r.height < 32) bad.push(`${(el.textContent ?? '').trim().slice(0, 20)} = ${Math.round(r.height)}px`);
      }
      return bad;
    });
    expect(small, `nút quá thấp: ${small.join(', ')}`).toEqual([]);
  });

  test('QR mở được và mã đủ lớn để quét', async ({ page }) => {
    await stubSupabase(page, { role: 'treasurer' });
    await page.goto('/students');
    await expect(page.locator('main table')).toBeVisible();
    await page.getByRole('row').filter({ hasText: 'Lê Thị Thử' })
      .getByRole('button', { name: /QR chuyển khoản của/ }).click();
    const dialog = page.getByRole('dialog');
    // .qr-svg là khung bọc mã QR; svg đầu tiên trong hộp thoại chỉ là icon
    const size = await dialog.locator('.qr-svg svg').first().boundingBox();
    expect(size!.width, 'mã QR quá nhỏ để quét trên điện thoại').toBeGreaterThanOrEqual(140);
  });
});
