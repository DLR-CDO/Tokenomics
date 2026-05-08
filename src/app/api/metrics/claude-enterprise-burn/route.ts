import { NextResponse } from "next/server";

import { getClaudeBurnForecast } from "@/server/claude-enterprise-burn";

export async function GET() {
  try {
    const data = await getClaudeBurnForecast();
    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("DATABASE_URL")) {
      return NextResponse.json({ error: "Database is not configured (set DATABASE_URL)." }, { status: 503 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
