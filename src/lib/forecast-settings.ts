/**
 * Global forecast settings (currently just a single safety margin used by both
 * the Global Forecast hero and per-app forecast recommendations). Persisted in
 * `dashboard_settings` under the key `forecast_settings`.
 *
 * Stored as a percentage (e.g. 15 = +15%) for clean UX; helpers return the
 * multiplier (e.g. 1.15) for math.
 */

import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "@/db";
import { dashboardSettings } from "@/db/schema";

export const forecastSettingsSchema = z.object({
  safetyMarginPct: z.number().finite().min(0).max(200).default(15),
});

export type ForecastSettings = z.infer<typeof forecastSettingsSchema>;

const SETTINGS_KEY = "forecast_settings";

export const DEFAULT_FORECAST_SETTINGS: ForecastSettings = { safetyMarginPct: 15 };

export async function readForecastSettings(): Promise<ForecastSettings> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(dashboardSettings)
    .where(eq(dashboardSettings.key, SETTINGS_KEY))
    .limit(1);
  if (!row) return DEFAULT_FORECAST_SETTINGS;
  const parsed = forecastSettingsSchema.safeParse(row.value);
  return parsed.success ? parsed.data : DEFAULT_FORECAST_SETTINGS;
}

export async function writeForecastSettings(
  settings: ForecastSettings,
): Promise<ForecastSettings> {
  const db = getDb();
  const value = forecastSettingsSchema.parse(settings);
  await db
    .insert(dashboardSettings)
    .values({ key: SETTINGS_KEY, value, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [dashboardSettings.key],
      set: { value, updatedAt: new Date() },
    });
  return value;
}

/** Convert percentage (15) to multiplier (1.15). */
export function toMultiplier(pct: number): number {
  return 1 + pct / 100;
}
