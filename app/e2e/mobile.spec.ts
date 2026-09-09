import { devices, expect, test } from '@playwright/test';
import { stubBulkClass, stubSupabase } from './fixtures';

/** Đo bảng và khung cuộn của nó — đo bằng số, không nhìn bằng mắt. */
async function measureTable(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const table = document.querySelector('main table') as HTMLElement;
    const wrap = table.parentElement as HTMLElement;
    const cs = getComputedStyle(wrap);
    const cells = Array.from(table.querySelectorAll('tbody tr:first-child td')) as HTMLElement[];
    wrap.scrollLeft = 9999;
    const scrolledTo = Math.round(wrap.scrollLeft);
    wrap.scrollLeft = 0;
    return {
      viewport: window.innerWidth,
      wrapClient: wrap.clientWidth,
      wrapScroll: wrap.scrollWidth,
      scrolledTo,
      overflowX: cs.overflowX,
      overflowY: cs.overflowY,
      nameColWidth: Math.round(cells[2]?.getBoundingClientRect().width ?? 0),
      rowHeight: Math.round((table.querySelector('tbody tr') as HTMLElement).getBoundingClientRect().height),
      docScrollWidth: document.documentElement.scrollWidth,
    };
  });
}

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

  test('bảng nhiều cột CUỘN NGANG thật, và cột không bị bóp', async ({ page }) => {
    // Cỡ lớp thật: 49 sinh viên × 4 đợt thu ⇒ 12 cột. Với 3 sinh viên mẫu thì lỗi không lộ.
    await stubSupabase(page, { role: 'treasurer' });
    await stubBulkClass(page);
    await page.goto('/students');
    await expect(page.locator('main table tbody tr').nth(10)).toBeVisible();

    const m = await measureTable(page);
    // 1. khung phải cuộn ngang được thật, không phải "vừa khít vì đã bị bóp"
    expect(m.wrapScroll).toBeGreaterThan(m.wrapClient + 200);
    expect(m.scrolledTo).toBeGreaterThan(200);
    // 2. overflow-y phải khai rõ là hidden: để `auto` thì CSS tự bật cuộn dọc và cú kéo dọc
    //    trên điện thoại bị mắc kẹt trong khung này (không cuộn được gì, cũng không nhường trang)
    expect(m.overflowY).toBe('hidden');
    // 3. cột tên không bị bóp: một dòng, không gãy 2–3 dòng như khi bảng là w-full
    expect(m.nameColWidth).toBeGreaterThan(150);
    expect(m.rowHeight).toBeLessThan(60);
    // 4. và cả trang vẫn không cuộn ngang
    expect(m.docScrollWidth).toBeLessThanOrEqual(m.viewport + 1);
  });

  test('cuộn trang rồi mở menu, đi trang khác: không còn lớp phủ nào chặn thao tác', async ({ page }) => {
    /*
     * Đây là lỗi đã gặp thật: drawer nằm trong AnimatePresence, exit không hoàn tất nên lớp
     * phủ z-70 ở lại DOM và phủ lên thanh tiêu đề z-30 — app trông bình thường mà bấm gì
     * cũng không ăn. Test đo bằng elementFromPoint chứ không chỉ nhìn giao diện.
     */
    await stubSupabase(page, { role: 'treasurer' });
    await stubBulkClass(page);
    await page.goto('/students');
    await expect(page.locator('main table tbody tr').nth(10)).toBeVisible();

    await page.mouse.move(200, 600);
    await page.mouse.wheel(0, 2400);
    await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBeGreaterThan(500);

    await page.getByRole('button', { name: 'Mở menu' }).click();
    await expect(page.locator('nav:visible').first()).toBeVisible();
    await page.locator('nav:visible').first().getByRole('link', { name: 'Chi', exact: true }).click();
    await expect(page).toHaveURL(/\/expenses$/);

    await expect.poll(async () => page.evaluate(() => {
      const covering = Array.from(document.querySelectorAll('body *')).filter((el) => {
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return cs.position === 'fixed' && r.width > innerWidth * 0.5 && r.height > innerHeight * 0.5
          && cs.pointerEvents !== 'none' && cs.visibility !== 'hidden' && cs.display !== 'none';
      });
      const btn = document.querySelector('header button[aria-label="Mở menu"]') as HTMLElement | null;
      if (!btn) return 'khong-thay-nut-menu';
      const r = btn.getBoundingClientRect();
      const at = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      if (covering.length > 0) return `bi-phu:${covering.length}`;
      return at && (btn === at || btn.contains(at)) ? 'bam-duoc' : 'bi-che';
    }), { timeout: 6000 }).toBe('bam-duoc');

    // và bấm thật cũng phải ăn
    await page.getByRole('button', { name: 'Mở menu' }).click({ timeout: 4000 });
    await expect(page.locator('nav:visible').first()).toBeVisible();
  });

  test('đóng hộp thoại rồi vẫn tương tác được (không sót pointer-events trên body)', async ({ page }) => {
    /*
     * Radix đặt body{pointer-events:none} khi hộp thoại mở. Nếu phần dọn không chạy — hay
     * khi hai hộp thoại nối nhau như QR → "Nộp tiền mặt…" — thì cả app không bấm được nữa.
     */
    await stubSupabase(page, { role: 'treasurer' });
    await page.goto('/students');
    await page.getByRole('row', { name: /Phạm Minh Ví/ })
      .getByTitle(/Mở QR chuyển khoản cho đợt/).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();

    await page.getByRole('button', { name: /Nộp tiền mặt/ }).click();
    await expect(page.getByRole('dialog')).toContainText('Thêm khoản thu');
    await page.keyboard.press('Escape');

    await expect.poll(() => page.evaluate(() => ({
      dialogs: document.querySelectorAll('[role=dialog]').length,
      pe: document.body.style.pointerEvents || 'auto',
    })), { timeout: 6000 }).toEqual({ dialogs: 0, pe: 'auto' });

    await page.getByLabel('Tìm sinh viên').fill('Ví');
    await expect(page.getByLabel('Tìm sinh viên')).toHaveValue('Ví');
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

  test('thanh tiêu đề đục, nội dung không lộ xuyên qua', async ({ page }) => {
    /*
     * Trên điện thoại kính mờ (backdrop-filter) bị tắt vì quá đắt với GPU, nên nền mờ 80%
     * sẽ để tiêu đề trang chạy xuyên qua thanh tiêu đề — đọc thành hai lớp chữ chồng nhau.
     * Thanh tiêu đề vì thế phải ĐỤC hoàn toàn.
     */
    await stubSupabase(page, { role: 'treasurer' });
    await stubBulkClass(page);
    await page.goto('/students');
    await expect(page.locator('main table tbody tr').nth(10)).toBeVisible();
    await page.mouse.move(200, 500);
    await page.mouse.wheel(0, 800);
    await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBeGreaterThan(200);

    const bar = await page.evaluate(() => {
      const el = document.querySelector('header.app-bar') as HTMLElement;
      const cs = getComputedStyle(el);
      const alpha = cs.backgroundColor.startsWith('rgba')
        ? Number(cs.backgroundColor.split(',')[3]!.replace(')', '').trim())
        : 1;
      return { alpha, backdrop: cs.backdropFilter };
    });
    expect(bar.alpha).toBe(1);
    expect(bar.backdrop).toBe('none');
  });

  test('ô lọc ngày còn rỗng thì hiện chữ gợi ý', async ({ page }) => {
    /*
     * input[type=date] không nhận `placeholder`, mà iOS vẽ ô rỗng thành hộp trắng trống trơn.
     * Chữ gợi ý được vẽ bằng ::after của khung .date-box, và editor ngày của WebKit bị ẩn khi
     * rỗng để hai thứ không chồng nhau.
     */
    await stubSupabase(page, { role: 'treasurer' });
    await page.goto('/incomes');
    const box = page.locator('.date-box').first();
    await expect(box).toHaveAttribute('data-empty', 'true');
    const hint = await box.evaluate((el) => getComputedStyle(el, '::after').content);
    expect(hint).toMatch(/Từ ngày|attr\(data-label\)/);

    // chọn ngày rồi thì trả lại editor thật, không còn chữ gợi ý
    await box.locator('input').fill('2026-09-03');
    await expect(box).toHaveAttribute('data-empty', 'false');
  });
});
