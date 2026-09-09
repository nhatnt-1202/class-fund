// @vitest-environment jsdom
/**
 * Smoke test: dựng toàn bộ cây provider thật (Theme + QueryClient + Toast + Auth) và
 * mount App. Mục đích là bắt lỗi runtime khi khởi tạo — thứ mà tsc không thấy được.
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

// React cần cờ này để không cảnh báo khi dùng act() ngoài môi trường test của nó
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Chưa cấu hình Supabase ⇒ App phải hiện hướng dẫn thay vì trắng trang hoặc nổ lỗi
vi.mock('@/lib/supabase', () => ({
  isConfigured: false,
  supabase: {
    auth: {
      getSession: () => Promise.resolve({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) }),
    rpc: () => Promise.resolve({ data: null, error: null }),
  },
  assertChanged: (rows: unknown[]) => rows,
  friendlyError: (e: unknown) => String(e),
}));

describe('App', () => {
  it('mount được và hướng dẫn cấu hình khi chưa có biến môi trường Supabase', async () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const root = createRoot(el);
    await act(async () => {
      const { default: App } = await import('./App');
      root.render(<App />);
    });
    expect(el.textContent).toContain('Chưa kết nối Supabase');
    expect(el.textContent).toContain('VITE_SUPABASE_URL');
    // Provider hiển thị đã chạy: thẻ html được đánh dấu theme, body có font token
    expect(document.documentElement.dataset.theme).toBeTruthy();
    await act(async () => { root.unmount(); });
  });
});
