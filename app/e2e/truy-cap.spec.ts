import { expect, test } from '@playwright/test';
import { stubSupabase } from './fixtures';

/**
 * Đếm lượt truy cập (0012_visits.sql).
 *
 * Hai điều phải đúng, và chúng kéo ngược chiều nhau:
 *   • GHI: khách chưa đăng nhập cũng phải được đếm — đó chính là nhóm đông nhất.
 *   • ĐỌC: chỉ quản trị mới xem được, vì bảng chứa IP và trình duyệt của người khác.
 */
test.describe('Đếm lượt truy cập', () => {
  test('khách chưa đăng nhập vẫn được ghi nhận một lượt', async ({ page }) => {
    const sent = await stubSupabase(page);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Tổng quan' })).toBeVisible();

    await expect.poll(() => sent.filter((s) => s.table === 'rpc/track_visit').length).toBeGreaterThan(0);
    const body = sent.find((s) => s.table === 'rpc/track_visit')!.body as Record<string, string>;
    expect(body.p_event).toBe('view');
    expect(body.p_path).toBe('/');
    // Khoá phiên do trình duyệt sinh, không phải thứ server đoán được
    expect(String(body.p_session).length).toBeGreaterThanOrEqual(8);
  });

  test('đổi trang thì đếm thêm lượt xem, không đếm thêm phiên mới', async ({ page }) => {
    const sent = await stubSupabase(page);
    await page.goto('/');
    await page.goto('/students');
    await expect.poll(() => sent.filter((s) => s.table === 'rpc/track_visit').length).toBeGreaterThan(1);

    const calls = sent.filter((s) => s.table === 'rpc/track_visit')
      .map((s) => s.body as Record<string, string>);
    const keys = new Set(calls.map((c) => c.p_session));
    expect(keys.size).toBe(1);                                   // vẫn là một phiên
    expect(calls.map((c) => c.p_path)).toContain('/students');   // nhưng có lượt xem trang mới
  });
});

test.describe('Ai xem được số liệu truy cập', () => {
  test('thủ quỹ không thấy menu và bị chặn khi vào thẳng đường dẫn', async ({ page }) => {
    await stubSupabase(page, { role: 'treasurer' });
    await page.goto('/');
    const nav = page.getByRole('navigation').first();
    await expect(nav.getByRole('link', { name: 'Lượt truy cập' })).toHaveCount(0);
    await page.goto('/visits');
    await expect(page.getByText(/chỉ dành cho quản trị/)).toBeVisible();
  });

  test('quản trị lớp xem được số lượt, số máy và thời gian ở lại', async ({ page }) => {
    await stubSupabase(page, { role: 'admin' });
    await page.goto('/visits');

    await expect(page.getByRole('heading', { name: 'Lượt truy cập' })).toBeVisible();
    await expect(page.getByText('Đang xem lúc này')).toBeVisible();
    await expect(page.getByText('Máy khác nhau')).toBeVisible();
    // 900 giây / 2 lượt = 7 phút 30 giây mỗi lượt
    await expect(page.getByText('7 phút 30 giây')).toBeVisible();
    // Khách chưa đăng nhập phải hiện rõ là khách, kèm thiết bị đọc được
    await expect(page.getByRole('cell', { name: 'Khách' }).first()).toBeVisible();
    await expect(page.getByText(/Điện thoại · iOS · Safari/)).toBeVisible();
  });
});
