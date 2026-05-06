import { NextResponse } from "next/server";

import {
  forecastSettingsSchema,
  readForecastSettings,
  writeForecastSettings,
} from "@/lib/forecast-settings";

export async function GET() {
  try {
    const settings = await readForecastSettings();
    return NextResponse.json(settings);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("DATABASE_URL")) {
      return NextResponse.json({ error: "Database is not configured (set DATABASE_URL)." }, { status: 503 });
    }
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as unknown;
    const parsed = forecastSettingsSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid body", issues: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const settings = await writeForecastSettings(parsed.data);
    return NextResponse.json(settings);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("DATABASE_URL")) {
      return NextResponse.json({ error: "Database is not configured (set DATABASE_URL)." }, { status: 503 });
    }
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
