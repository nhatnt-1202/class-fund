/**
 * Lượt truy cập theo ngày — một dãy cột, MỘT series duy nhất.
 *
 * Cố ý không tách "khách" và "đã đăng nhập" thành hai màu chồng nhau: hai màu biểu đồ của
 * app đã mang nghĩa Quỹ Lớp / Quỹ Đoàn ở mọi trang khác, mượn lại ở đây sẽ khiến người đọc
 * hiểu nhầm. Tỉ lệ khách nằm ở thẻ số phía trên và trong chú giải khi rê chuột — chỗ nào
 * cần con số chính xác thì đọc số, không phải đo chiều cao cột.
 *
 * Một series thì không cần chú giải màu (tiêu đề đã nói cột là gì).
 */
import { useState } from 'react';
import { fmtNum } from '@/lib/format';

export interface DayPoint {
  day: string;            // 'YYYY-MM-DD'
  sessions: number;
  guests: number;
  pageviews: number;
}

const H = 132;

/** '2026-09-10' → '10/9' — nhãn trục ngắn, không lặp lại năm ở mọi cột. */
const dayLabel = (d: string) => `${Number(d.slice(8, 10))}/${Number(d.slice(5, 7))}`;

export default function VisitBars({ points }: { points: DayPoint[] }) {
  const [hover, setHover] = useState<DayPoint | null>(null);
  const max = Math.max(...points.map((p) => p.sessions), 1);
  const colW = 100 / Math.max(points.length, 1);
  // Trục x chỉ ghi ~6 mốc: 30 nhãn ngày cạnh nhau thì chồng lên nhau và không ai đọc.
  const tickEvery = Math.max(1, Math.ceil(points.length / 6));

  return (
    <figure className="m-0">
      <div className="relative">
        <div className="pointer-events-none absolute inset-0 flex flex-col justify-between" aria-hidden>
          {[0, 1, 2].map((i) => <div key={i} className="border-t border-line" />)}
        </div>
        <svg
          viewBox={`0 0 100 ${H}`}
          preserveAspectRatio="none"
          className="relative h-[132px] w-full"
          role="img"
          aria-label={`Lượt truy cập mỗi ngày trong ${points.length} ngày gần nhất, cao nhất ${max} lượt`}
        >
          {points.map((p, i) => {
            const h = (p.sessions / max) * (H - 4);
            // Khoảng hở 2px giữa hai cột là hở của NỀN, không phải viền cột
            const bw = colW * 0.62;
            return (
              <g key={p.day}>
                {/* vùng bắt chuột rộng hết ô, để không phải trỏ trúng cột mảnh */}
                <rect
                  x={i * colW} y={0} width={colW} height={H} fill="transparent"
                  onMouseEnter={() => setHover(p)}
                  onMouseLeave={() => setHover(null)}
                />
                {p.sessions > 0 && (
                  <rect
                    x={i * colW + (colW - bw) / 2}
                    y={H - h}
                    width={bw}
                    height={h}
                    rx={1.2}
                    className="fill-chartLop transition-opacity"
                    opacity={hover && hover.day !== p.day ? 0.45 : 1}
                    pointerEvents="none"
                  />
                )}
              </g>
            );
          })}
        </svg>
        {hover && (
          <div className="pointer-events-none absolute -top-1 left-1/2 -translate-x-1/2 rounded-md
            border border-line bg-surface px-2 py-1 text-xs shadow-s2">
            <b>{dayLabel(hover.day)}</b>
            {' · '}{fmtNum(hover.sessions)} lượt
            {' · '}{fmtNum(hover.guests)} khách
            {' · '}{fmtNum(hover.pageviews)} trang
          </div>
        )}
      </div>
      <div className="mt-1 flex text-[11px] text-ink3">
        {points.map((p, i) => (
          <span key={p.day} className="shrink-0 text-center" style={{ width: `${colW}%` }}>
            {i % tickEvery === 0 ? dayLabel(p.day) : ''}
          </span>
        ))}
      </div>

      {/* Bản số liệu cho trình đọc màn hình và cho ai muốn đọc số thay vì nhìn cột */}
      <table className="sr-only">
        <caption>Lượt truy cập theo ngày</caption>
        <thead><tr><th>Ngày</th><th>Lượt truy cập</th><th>Khách</th><th>Lượt xem trang</th></tr></thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.day}>
              <td>{p.day}</td><td>{p.sessions}</td><td>{p.guests}</td><td>{p.pageviews}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
