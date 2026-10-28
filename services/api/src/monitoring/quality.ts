import { ReadingEntity, SensorType } from "../database/entities";

export type PollutantScale = { unit: string; good: number; elevated: number; hazardous: number };

export const SCALES: Record<SensorType, PollutantScale> = {
  CH4: { unit: "ppm", good: 1000, elevated: 5000, hazardous: 10000 },
  NO2: { unit: "µg/m³", good: 40, elevated: 100, hazardous: 200 },
  "PM2.5": { unit: "µg/m³", good: 15, elevated: 35, hazardous: 75 },
  SO2: { unit: "µg/m³", good: 40, elevated: 125, hazardous: 350 },
  PM10: { unit: "µg/m³", good: 45, elevated: 100, hazardous: 150 },
  CO: { unit: "mg/m³", good: 4, elevated: 7, hazardous: 10 },
  CO2: { unit: "ppm", good: 800, elevated: 1200, hazardous: 2000 },
  MQ2: { unit: "ppm", good: 300, elevated: 600, hazardous: 1000 },
};

export const UNITS = Object.fromEntries(Object.entries(SCALES).map(([key, value]) => [key, value.unit])) as Record<SensorType, string>;

export function parameterQuality(type: SensorType, rawValue: number): number {
  const scale = SCALES[type];
  const value = Math.max(0, Number(rawValue));
  let score: number;
  if (value <= scale.good) score = 100 - (15 * value) / Math.max(scale.good, 0.001);
  else if (value <= scale.elevated) score = 85 - (35 * (value - scale.good)) / (scale.elevated - scale.good);
  else if (value <= scale.hazardous) score = 50 - (50 * (value - scale.elevated)) / (scale.hazardous - scale.elevated);
  else score = 0;
  return Math.round(Math.max(0, Math.min(100, score)) * 10) / 10;
}

export function combinedQuality(values: [SensorType, number][]): number | null {
  const scores = values.filter(([type]) => Boolean(SCALES[type])).map(([type, value]) => parameterQuality(type, value));
  return scores.length ? Math.round((scores.reduce((sum, value) => sum + value, 0) / scores.length) * 10) / 10 : null;
}

export function qualityLabel(score: number | null): string {
  if (score === null) return "Нет данных";
  if (score >= 85) return "Чистый воздух";
  if (score >= 65) return "Умеренно";
  if (score >= 40) return "Повышено";
  return "Опасно";
}

function regression(points: [number, number][]): [number, number, number] {
  if (points.length < 2) return [0, points[0]?.[1] ?? 0, 0];
  const meanX = points.reduce((sum, item) => sum + item[0], 0) / points.length;
  const meanY = points.reduce((sum, item) => sum + item[1], 0) / points.length;
  const variance = points.reduce((sum, [x]) => sum + (x - meanX) ** 2, 0);
  const slope = variance ? points.reduce((sum, [x, y]) => sum + (x - meanX) * (y - meanY), 0) / variance : 0;
  const intercept = meanY - slope * meanX;
  const total = points.reduce((sum, [, y]) => sum + (y - meanY) ** 2, 0);
  const residual = points.reduce((sum, [x, y]) => sum + (y - (slope * x + intercept)) ** 2, 0);
  return [slope, intercept, total ? Math.max(0, 1 - residual / total) : 0];
}

export function forecastQuality(rows: ReadingEntity[], minutes = 60) {
  const groups = new Map<SensorType, ReadingEntity[]>();
  rows.forEach((row) => groups.set(row.type, [...(groups.get(row.type) ?? []), row]));
  if (!groups.size) return { score: null, confidence: 0, horizonMinutes: minutes, method: "linear-regression-v1", parameters: [] };

  const start = Math.min(...rows.map((row) => row.measuredAt.getTime()));
  const horizon = Math.max(...rows.map((row) => (row.measuredAt.getTime() - start) / 60_000)) + minutes;
  const parameters: { type: SensorType; current: number; predicted: number; trendPerHour: number; r2: number; samples: number }[] = [];
  const scores: [SensorType, number][] = [];
  [...groups.entries()].sort(([left], [right]) => left.localeCompare(right)).forEach(([type, values]) => {
    const points = values
      .sort((left, right) => left.measuredAt.getTime() - right.measuredAt.getTime())
      .map((row) => [(row.measuredAt.getTime() - start) / 60_000, Number(row.value)] as [number, number])
      .slice(-192);
    const [slope, intercept, r2] = regression(points);
    const current = points.at(-1)?.[1] ?? 0;
    const predicted = Math.max(0, Math.min(slope * horizon + intercept, current * 1.5 + 0.001));
    parameters.push({ type, current: round(current, 2), predicted: round(predicted, 2), trendPerHour: round(slope * 60, 3), r2: round(r2, 3), samples: points.length });
    scores.push([type, predicted]);
  });
  const sampleFactor = Math.min(1, parameters.reduce((sum, item) => sum + item.samples, 0) / (24 * parameters.length));
  const fitMean = parameters.reduce((sum, item) => sum + item.r2, 0) / parameters.length;
  return {
    score: combinedQuality(scores),
    confidence: Math.round(100 * (0.55 * sampleFactor + 0.45 * Math.sqrt(fitMean))),
    horizonMinutes: minutes,
    method: "linear-regression-v1",
    parameters,
  };
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
