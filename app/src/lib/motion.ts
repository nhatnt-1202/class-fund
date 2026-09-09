/**
 * Token chuyển động — MỌI animation lấy từ đây, không gõ số rời rạc.
 * Nguyên tắc: vào chậm hơn ra · chỉ animate transform/opacity · không gì quá 500ms ·
 * mọi hiệu ứng phải giải thích một thay đổi, không trang trí vô nghĩa.
 */
import type { Transition, Variants } from 'framer-motion';

export const DUR = { instant: 0.09, fast: 0.14, base: 0.2, slow: 0.32, page: 0.42 } as const;

export const EASE = {
  out: [0.22, 1, 0.36, 1],
  inOut: [0.4, 0, 0.2, 1],
  in: [0.4, 0, 1, 1],
} as const;

export const SPRING = {
  soft: { type: 'spring', stiffness: 260, damping: 26, mass: 0.9 } as Transition,
  snappy: { type: 'spring', stiffness: 420, damping: 32 } as Transition,
};

export const pageVariants: Variants = {
  hidden: { opacity: 0, y: 9 },
  show: { opacity: 1, y: 0, transition: { duration: DUR.page, ease: EASE.out } },
  exit: { opacity: 0, y: -6, transition: { duration: DUR.fast, ease: EASE.in } },
};

export const dialogVariants: Variants = {
  hidden: { opacity: 0, y: 14, scale: 0.965 },
  show: { opacity: 1, y: 0, scale: 1, transition: SPRING.snappy },
  exit: { opacity: 0, y: 6, scale: 0.985, transition: { duration: DUR.fast, ease: EASE.in } },
};

/**
 * Hàng bảng hiện lệch nhau 24ms, tối đa 12 hàng để không phải chờ lâu.
 *
 * Từ hàng thứ 20 trở đi thì KHÔNG animate nữa: mỗi hàng đang animate được đặt
 * `will-change: transform, opacity`, và một lớp 49 hàng như vậy đủ làm GPU điện thoại tầm
 * trung nghẽn — cả trang khựng lại đúng lúc người dùng vừa mở danh sách lớp.
 */
export const rowStagger = (i: number) => (i >= 20 ? {} : {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: DUR.base, ease: EASE.out, delay: Math.min(i, 12) * 0.024 },
});

export const prefersReducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
