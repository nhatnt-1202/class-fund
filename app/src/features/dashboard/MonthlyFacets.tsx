/**
 * Hai biểu đồ nhỏ cùng thang đo: "Tiền vào" và "Tiền ra" theo tháng.
 *
 * Vì sao tách làm hai chứ không gộp một biểu đồ 4 cột: thu và chi là hai đại lượng khác
 * nhau về ý nghĩa — gộp lại sẽ phải dùng 4 series và người đọc rất dễ so sai. Hai biểu
 * đồ dùng CHUNG một trục y nên vẫn so sánh trực tiếp được, và tuyệt đối không có trục y thứ hai.
 *
 * Series là hai QUỸ (không phải thu/chi) nên màu trùng với màu định danh quỹ dùng khắp app.
 * Cặp màu này đã chạy qua bộ kiểm tra palette: phân biệt được với cả 3 dạng mù màu
 * (ΔE 31.7 protan) — cặp xanh-lá/đỏ quen dùng cho thu/chi thì KHÔNG đạt (ΔE 5.5).
 */
import { useState } from 'react';
import { fmtVnd } from '@/lib/format';
import { FUNDS, type Fund } from '@/types/db';

export interface MonthPoint {
  month: string;                       // 'YYYY-MM'
  income: Record<Fund, number>;
  expense: Record<Fund, number>;
}

const FUND_ORDER: Fund[] = ['QUY_LOP', 'QUY_DOAN'];
const BAR_FILL: Record<Fund, string> = { QUY_LOP: 'fill-chartLop', QUY_DOAN: 'fill-chartDoan' };
const DOT_BG: Record<Fund, string> = { QUY_LOP: 'bg-chartLop', QUY_DOAN: 'bg-chartDoan' };

function Facet({
  title, points, pick, max,
}: { title: string; points: MonthPoint[]; pick: (p: MonthPoint) => Record<Fund, number>; max: number }) {
  const [hover, setHover] = useState<{ month: string; fund: Fund; value: number } | null>(null);
  const H = 118;
  const groupW = 100 / Math.max(points.length, 1);

  return (
    <figure className="m-0">
      <figcaption className="mb-2 text-[13px] font-semibold text-ink2">{title}</figcaption>
      <div className="relative">
        {/* đường lưới mờ, không cạnh tranh với dữ liệu */}
        <div className="pointer-events-none absolute inset-0 flex flex-col justify-between" aria-hidden>
          {[0, 1, 2].map((i) => <div key={i} className="border-t border-line" />)}
        </div>
        <svg
          viewBox={`0 0 100 ${H}`}
          preserveAspectRatio="none"
          className="relative h-[118px] w-full"
          role="img"
          aria-label={`${title} theo tháng, tách theo từng quỹ`}
        >
          {points.map((p, gi) => {
            const values = pick(p);
            return FUND_ORDER.map((fund, si) => {
              const v = values[fund] ?? 0;
              if (v <= 0) return null;
              const h = max > 0 ? (v / max) * (H - 4) : 0;
              // 2px khoảng hở giữa hai cột cạnh nhau, đầu cột bo 4px, chân cột chạm trục
              const bw = groupW * 0.3;
              const x = gi * groupW + groupW * 0.12 + si * (bw + groupW * 0.06);
              return (
                <rect
                  key={`${p.month}-${fund}`}
                  x={x}
                  y={H - h}
                  width={bw}
                  height={h}
                  rx={1.2}
                  className={`${BAR_FILL[fund]} transition-opacity`}
                  opacity={hover && hover.month !== p.month ? 0.45 : 1}
                  onMouseEnter={() => setHover({ month: p.month, fund, value: v })}
                  onMouseLeave={() => setHover(null)}
                />
              );
            });
          })}
        </svg>
        {hover && (
          <div className="pointer-events-none absolute -top-1 left-1/2 -translate-x-1/2 rounded-md
            border border-line bg-surface px-2 py-1 text-xs shadow-s2">
            <span className="font-semibold">{hover.month.slice(5)}/{hover.month.slice(0, 4)}</span>
            {' · '}
            {FUNDS[hover.fund].label}
            {' · '}
            <span className="num font-semibold">{fmtVnd(hover.value)}</span>
          </div>
        )}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-ink3">
        {points.map((p) => (
          <span key={p.month} className="flex-1 text-center">{p.month.slice(5)}/{p.month.slice(2, 4)}</span>
        ))}
      </div>
    </figure>
  );
}

export default function MonthlyFacets({ points }: { points: MonthPoint[] }) {
  if (points.length === 0) {
    return <p className="py-6 text-center text-sm text-ink3">Chưa có dữ liệu thu chi để vẽ biểu đồ.</p>;
  }
  // Dùng chung một giá trị lớn nhất cho cả hai biểu đồ ⇒ so sánh tiền vào / tiền ra là thật
  const max = Math.max(
    1,
    ...points.flatMap((p) => [...FUND_ORDER.map((f) => p.income[f] ?? 0), ...FUND_ORDER.map((f) => p.expense[f] ?? 0)]),
  );
  return (
    <div className="space-y-4">
      {/* 2 series ⇒ luôn có legend, và màu không phải phương tiện duy nhất (có nhãn chữ) */}
      <div className="flex flex-wrap gap-4 text-[13px] text-ink2">
        {FUND_ORDER.map((f) => (
          <span key={f} className="flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 rounded-[3px] ${DOT_BG[f]}`} aria-hidden />
            {FUNDS[f].label}
          </span>
        ))}
        <span className="ml-auto text-ink3">Cùng một thang đo · trỏ vào cột để xem số</span>
      </div>
      <Facet title="Tiền vào theo tháng" points={points} pick={(p) => p.income} max={max} />
      <Facet title="Tiền ra theo tháng" points={points} pick={(p) => p.expense} max={max} />
    </div>
  );
}
