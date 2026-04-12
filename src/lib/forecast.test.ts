import { describe, expect, it } from "vitest";

import { forecastFromDaily, movingAverage, weekdayFactors } from "./forecast";

describe("movingAverage", () => {
  it("computes trailing averages", () => {
    expect(movingAverage([1, 2, 3, 4], 2)).toEqual([1, 1.5, 2.5, 3.5]);
  });
});

describe("weekdayFactors", () => {
  it("returns 7 factors", () => {
    const pts = Array.from({ length: 14 }, (_, i) => ({
      date: `2026-01-${String(i + 1).padStart(2, "0")}`,
      value: 10 + i,
    }));
    expect(weekdayFactors(pts)).toHaveLength(7);
  });
});

describe("forecastFromDaily", () => {
  it("returns empty forecast for short history", () => {
    const res = forecastFromDaily(
      [
        { date: "2026-01-01", value: 1 },
        { date: "2026-01-02", value: 2 },
      ],
      new Date("2026-01-10T00:00:00.000Z"),
    );
    expect(res.forecast.length).toBe(0);
  });

  it("extends forecast to horizon", () => {
    const pts = Array.from({ length: 20 }, (_, i) => ({
      date: `2026-01-${String(i + 1).padStart(2, "0")}`,
      value: 100 + Math.sin(i) * 5,
    }));
    const res = forecastFromDaily(pts, new Date("2026-01-25T00:00:00.000Z"));
    expect(res.forecast.length).toBeGreaterThan(0);
    expect(res.intervalLow.length).toBe(res.forecast.length);
    expect(res.intervalHigh.length).toBe(res.forecast.length);
  });
});
