import { defineConfig, devices } from '@playwright/test';

/**
 * E2E chạy trên bản build thật, với Supabase được giả lập hoàn toàn ở tầng network
 * (xem e2e/fixtures.ts). Không cần project Supabase và không chạm dữ liệu thật.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: 'http://localhost:4179',
    locale: 'vi-VN',
    timezoneId: 'Asia/Ho_Chi_Minh',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium-dark', use: { ...devices['Desktop Chrome'], colorScheme: 'dark' } },
    { name: 'chromium-light', use: { ...devices['Desktop Chrome'], colorScheme: 'light' } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  /*
   * Build riêng cho E2E với URL Supabase cố định, KHÔNG dùng .env của máy đang chạy:
   * supabase-js lưu phiên vào localStorage theo khoá sb-<project-ref>-auth-token, nên phiên
   * giả trong e2e/fixtures.ts chỉ khớp khi project-ref là biết trước. Mọi request đều bị
   * chặn nên URL này không cần tồn tại thật.
   * Cổng 4179 riêng cho E2E để không nhặt phải server preview đang chạy của bản build khác.
   */
  webServer: {
    command: 'VITE_SUPABASE_URL=https://e2edemo.supabase.co VITE_SUPABASE_ANON_KEY=e2e-anon-key'
      + ' npx vite build --logLevel warn && npx vite preview --port 4179 --strictPort',
    port: 4179,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
