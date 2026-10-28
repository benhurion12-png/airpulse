import { combinedQuality, forecastQuality, parameterQuality, qualityLabel } from "./quality";
import { ReadingEntity } from "../database/entities";

describe("air quality", () => {
  it("maps values and combines only available sensors", () => {
    expect(parameterQuality("PM2.5", 0)).toBe(100);
    expect(parameterQuality("PM2.5", 75)).toBe(0);
    expect(combinedQuality([["PM2.5", 15]])).toBe(85);
    expect(qualityLabel(85)).toBe("Чистый воздух");
  });

  it("forecasts readings with the existing response contract", () => {
    const now = Date.now();
    const rows = [0, 1, 2, 3].map((step) => Object.assign(new ReadingEntity(), {
      type: "PM2.5",
      value: 10 + step,
      measuredAt: new Date(now + step * 30 * 60_000),
    }));
    const result = forecastQuality(rows, 60);
    expect(result.method).toBe("linear-regression-v1");
    expect(result.horizonMinutes).toBe(60);
    expect(result.parameters).toHaveLength(1);
  });
});
