// Cấu hình riêng cho vitest: các phép kiểm tra đều là logic thuần (tiền, ngày, parser
// Excel, VietQR, ma trận quyền) nên chạy trong môi trường node, không cần plugin react.
import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    globals: true,
  },
});
