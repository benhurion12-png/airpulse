import { HistoryPoint } from "@/lib/types";

export function QualityChart({ points }: { points: HistoryPoint[] }) {
  const values = points.filter((point) => point.score !== null).slice(-30);
  if (values.length < 2) return <div className="chart-empty">Недостаточно данных для графика</div>;
  const width = 680;
  const height = 190;
  const coords = values.map((point, index) => ({
    x: (index / (values.length - 1)) * width,
    y: height - ((point.score || 0) / 100) * (height - 18) - 9,
  }));
  const path = coords.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
  const area = `${path} L${width},${height} L0,${height} Z`;
  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="График качества воздуха за 24 часа">
        <defs>
          <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#1689ff" stopOpacity=".3"/><stop offset="1" stopColor="#1689ff" stopOpacity="0"/></linearGradient>
        </defs>
        {[0, .25, .5, .75, 1].map((part) => <line key={part} x1="0" x2={width} y1={height * part} y2={height * part} className="grid-line" />)}
        <path d={area} fill="url(#chartFill)" />
        <path d={path} className="chart-line" />
        <circle cx={coords.at(-1)?.x} cy={coords.at(-1)?.y} r="5" className="chart-point" />
      </svg>
      <div className="chart-axis"><span>24 ч назад</span><span>12 ч</span><span>Сейчас</span></div>
    </div>
  );
}

