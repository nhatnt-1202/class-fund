import { expect, test } from '@playwright/test';
import { CLASS_CODE, OTHER_CLASS_CODE, OTHER_CLASS_ID, stubSupabase, type Sent } from './fixtures';

/**
 * Mô hình nhiều lớp: tài khoản gốc mở lớp và giao quản trị, quản trị lớp chỉ thấy lớp mình.
 * Cách ly THẬT do RLS thực thi (đã có bộ kiểm thử riêng chạy trên Postgres thật ở tests/db).
 * Ở đây kiểm tra app: hỏi đúng lớp đang chọn, và không mời người ta làm việc ngoài quyền.
 */

/** Thu lại mọi request đọc dữ liệu, để xem app hỏi lớp nào. */
function watchReads(page: import('@playwright/test').Page): string[] {
  const urls: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'GET' && r.url().includes('/rest/v1/')) urls.push(r.url());
  });
  return urls;
}

test.describe('Quản trị lớp', () => {
  test('chỉ thấy lớp của mình và không có menu Quản lý lớp', async ({ page }) => {
    await stubSupabase(page, { role: 'admin' });
    await page.goto('/');
    await expect(page.getByRole('navigation').first().getByRole('link', { name: 'Quản lý lớp' })).toHaveCount(0);
    // một lớp thì không có bộ chọn, chỉ hiện mã lớp
    const menu = page.getByRole('button', { name: 'Mở menu' });
    if (await menu.isVisible()) await menu.click();
    await expect(page.locator('#class-switch:visible')).toHaveText(CLASS_CODE);
    await expect(page.locator('select#class-switch')).toHaveCount(0);
  });

  test('vào thẳng trang Quản lý lớp cũng chỉ nhận được lời từ chối', async ({ page }) => {
    await stubSupabase(page, { role: 'admin' });
    await page.goto('/lop-hoc');
    await expect(page.getByText(/Chỉ tài khoản gốc/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Mở lớp mới' })).toHaveCount(0);
  });

  test('mọi truy vấn số liệu đều kèm đúng lớp đang xem', async ({ page }) => {
    const reads = watchReads(page);
    await stubSupabase(page, { role: 'treasurer' });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Tổng quan' })).toBeVisible();

    // Tiêu đề hiện trước khi dữ liệu về, nên phải chờ tới khi thực sự có truy vấn số liệu
    const scopedReads = () => reads.filter((u) => /v_fund_balance|v_period_progress|students|incomes/.test(u));
    await expect.poll(() => scopedReads().length, { timeout: 7000 }).toBeGreaterThan(0);
    // Không có truy vấn nào lấy dữ liệu mà không nói rõ lớp nào
    for (const u of scopedReads()) expect(u).toContain('class_id=eq.c1');
  });
});

test.describe('Tài khoản gốc', () => {
  test('thấy mọi lớp, đổi lớp thì số liệu hỏi theo lớp mới', async ({ page }) => {
    const reads = watchReads(page);
    await stubSupabase(page, { systemOwner: true });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Tổng quan' })).toBeVisible();

    // Trên điện thoại sidebar là drawer: phải mở menu mới thấy bộ chọn lớp
    const menu = page.getByRole('button', { name: 'Mở menu' });
    if (await menu.isVisible()) await menu.click();

    const picker = page.locator('select#class-switch:visible');
    await expect(picker).toBeVisible();
    await expect(picker.locator('option')).toHaveCount(2);

    reads.length = 0;
    await picker.selectOption(OTHER_CLASS_ID);
    await expect.poll(() => reads.filter((u) => u.includes(`class_id=eq.${OTHER_CLASS_ID}`)).length,
      { timeout: 7000 }).toBeGreaterThan(0);
  });

  test('mở lớp mới và giao ngay cho một tài khoản quản trị', async ({ page }) => {
    const sent: Sent[] = await stubSupabase(page, { systemOwner: true });
    await page.goto('/lop-hoc');
    await expect(page.getByRole('heading', { name: 'Các lớp trong hệ thống' })).toBeVisible();
    // bảng liệt kê cả hai lớp
    await expect(page.getByRole('cell', { name: CLASS_CODE })).toBeVisible();
    await expect(page.getByRole('cell', { name: OTHER_CLASS_CODE })).toBeVisible();

    await page.getByRole('button', { name: 'Mở lớp mới' }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('textbox', { name: /^Mã lớp/ }).fill('DCXDXD69_07A');
    await dialog.getByRole('textbox', { name: /^Email quản trị lớp/ }).fill('LopTruong07A@student.humg.edu.vn');
    await dialog.getByRole('button', { name: 'Mở lớp' }).click();

    await expect.poll(() => sent.filter((s) => s.table === 'rpc/create_class').length,
      { timeout: 7000 }).toBe(1);
    const body = sent.find((s) => s.table === 'rpc/create_class')!.body as Record<string, string>;
    expect(body.p_code).toBe('DCXDXD69_07A');
    // email được hạ về chữ thường trước khi gửi, vì DB so khớp theo lower(email)
    expect(body.p_admin_email).toBe('loptruong07a@student.humg.edu.vn');
  });

  test('giao quản trị cho một lớp đã có', async ({ page }) => {
    const sent: Sent[] = await stubSupabase(page, { systemOwner: true });
    await page.goto('/lop-hoc');
    await page.getByRole('row', { name: new RegExp(CLASS_CODE) })
      .getByRole('button', { name: 'Giao quản trị' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Email').fill('thuquy@lop.vn');
    await dialog.getByRole('button', { name: 'Giao quản trị' }).click();

    await expect.poll(() => sent.filter((s) => s.table === 'rpc/grant_class_role').length,
      { timeout: 7000 }).toBe(1);
    const body = sent.find((s) => s.table === 'rpc/grant_class_role')!.body as Record<string, string>;
    expect(body.p_role).toBe('admin');
    expect(body.p_email).toBe('thuquy@lop.vn');
    expect(body.p_class).toBe('c1');
  });

  test('hệ thống chưa có lớp nào thì được dẫn đi mở lớp', async ({ page }) => {
    await stubSupabase(page, { systemOwner: true, noClasses: true });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Chưa có lớp nào' })).toBeVisible();
    await page.getByRole('button', { name: 'Mở lớp mới' }).click();
    await expect(page).toHaveURL(/\/lop-hoc$/);
  });
});

test.describe('Sinh viên chưa được gán lớp', () => {
  test('được nói rõ vì sao chưa thấy gì', async ({ page }) => {
    await stubSupabase(page, { role: 'member', noClasses: true });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /chưa thuộc lớp nào/ })).toBeVisible();
    await expect(page.getByText(/chưa nhập danh sách sinh viên/)).toBeVisible();
  });
});

test.describe('Đánh dấu ban quản lý trong danh sách lớp', () => {
  test('quản trị lớp gắn được tài khoản với một sinh viên trong danh sách', async ({ page }) => {
    const sent: Sent[] = await stubSupabase(page, { role: 'admin' });
    await page.goto('/tai-khoan');
    await expect(page.getByRole('heading', { name: /Thành viên lớp/ })).toBeVisible();

    // Quản trị lớp được mời bằng email nên chưa gắn với sinh viên nào
    const picker = page.getByRole('combobox', { name: /Gắn Phạm Lớp Trưởng với sinh viên/ });
    await expect(picker).toHaveValue('');
    await picker.selectOption('s3');

    await expect.poll(() => sent.filter((s) => s.method === 'PATCH' && s.table === 'memberships').length,
      { timeout: 7000 }).toBe(1);
    const body = sent.find((s) => s.method === 'PATCH' && s.table === 'memberships')!.body as Record<string, unknown>;
    expect(body.student_id).toBe('s3');
  });

  test('bỏ gắn thì gửi lên null, không phải chuỗi rỗng', async ({ page }) => {
    const sent: Sent[] = await stubSupabase(page, { role: 'admin' });
    await page.goto('/tai-khoan');
    await page.getByRole('combobox', { name: /Gắn Lê Thủ Quỹ với sinh viên/ }).selectOption('');

    await expect.poll(() => sent.filter((s) => s.method === 'PATCH' && s.table === 'memberships').length,
      { timeout: 7000 }).toBe(1);
    const body = sent.find((s) => s.method === 'PATCH' && s.table === 'memberships')!.body as Record<string, unknown>;
    // Postgres cần null; chuỗi rỗng sẽ lỗi kiểu uuid
    expect(body.student_id).toBeNull();
  });
});
