import { NextResponse } from "next/server";

import { syncAzureData } from "@/server/azure-sync";

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const token = request.headers.get("x-cron-secret");
    if (token !== secret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const result = await syncAzureData();
    if (result.errors.length > 0) {
      return NextResponse.json({ ok: false, ...result }, { status: 500 });
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("AZURE_RESOURCES")) {
      return NextResponse.json({ error: "AZURE_RESOURCES is not configured." }, { status: 400 });
    }
    if (message.includes("DATABASE_URL")) {
      return NextResponse.json({ error: "Database is not configured (set DATABASE_URL)." }, { status: 503 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
