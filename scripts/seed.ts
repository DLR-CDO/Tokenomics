import "dotenv/config";

import { addDays, formatISO } from "date-fns";

import { getDb } from "../src/db";
import { billingCycles, dimMember, usageFacts } from "../src/db/schema";

function day(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00.000Z`);
}

async function main() {
  const db = getDb();

  await db.delete(usageFacts);
  await db.delete(billingCycles);
  await db.delete(dimMember);

  const members = [
    { externalKey: "u1", email: "alice@example.com", displayName: "Alice" },
    { externalKey: "u2", email: "bob@example.com", displayName: "Bob" },
    { externalKey: "u3", email: "carol@example.com", displayName: "Carol" },
  ] as const;

  const memberIds: string[] = [];
  for (const m of members) {
    const [row] = await db
      .insert(dimMember)
      .values({
        sourceSystem: "cursor",
        externalKey: m.externalKey,
        email: m.email,
        displayName: m.displayName,
      })
      .returning({ id: dimMember.id });
    memberIds.push(row!.id);
  }

  const cycleStart = day("2026-03-01");
  const cycleEnd = day("2026-03-31");
  await db.insert(billingCycles).values({
    sourceSystem: "cursor",
    label: "Demo cycle",
    cycleStart,
    cycleEnd,
    timezone: "UTC",
  });

  for (let mIdx = 0; mIdx < members.length; mIdx += 1) {
    const memberId = memberIds[mIdx]!;
    await db.insert(usageFacts).values({
      occurredAt: cycleStart,
      sourceSystem: "cursor",
      metricKind: "cost_usd",
      amount: 120 + mIdx * 15,
      memberId,
      externalId: `cursor:spend:cycle:202603:${members[mIdx]!.externalKey}`,
    });
  }

  const start = addDays(new Date(), -45);
  for (let i = 0; i < 45; i += 1) {
    const d = addDays(start, i);
    const iso = formatISO(d, { representation: "date" });
    const mIdx = i % 3;
    const memberId = memberIds[mIdx]!;

    const tokensIn = 20_000 + (i % 7) * 1500;
    const tokensOut = 8_000 + (i % 5) * 900;
    const requests = 40 + (i % 6) * 3;
    const spend = 3 + (i % 4) * 0.35;

    await db.insert(usageFacts).values([
      {
        occurredAt: d,
        sourceSystem: "cursor",
        metricKind: "tokens_in",
        amount: tokensIn,
        memberId,
        modelName: "gpt-4.1",
        externalId: `seed:${iso}:${memberId}:in`,
      },
      {
        occurredAt: d,
        sourceSystem: "cursor",
        metricKind: "tokens_out",
        amount: tokensOut,
        memberId,
        modelName: "gpt-4.1",
        externalId: `seed:${iso}:${memberId}:out`,
      },
      {
        occurredAt: d,
        sourceSystem: "cursor",
        metricKind: "requests",
        amount: requests,
        memberId,
        modelName: "gpt-4.1",
        dimensionsJson: { subtype: "chat" },
        externalId: `seed:${iso}:${memberId}:req`,
      },
      {
        occurredAt: d,
        sourceSystem: "cursor",
        metricKind: "cost_usd",
        amount: spend,
        memberId,
        dimensionsJson: { source: "billing_groups", demo: true },
        externalId: `cursor:daily_spend:${iso}:${members[mIdx]!.externalKey}`,
      },
      {
        occurredAt: d,
        sourceSystem: "cursor",
        metricKind: "dau",
        amount: 18 + (i % 4),
        memberId: null,
        externalId: `cursor:dau:${iso}`,
      },
      {
        occurredAt: d,
        sourceSystem: "cursor",
        metricKind: "requests",
        amount: 120 + (i % 3) * 20,
        memberId: null,
        modelName: "gpt-4.1",
        dimensionsJson: { subtype: "model_messages", users: 10 },
        externalId: `cursor:modelusage:${iso}:gpt-4.1`,
      },
    ]);
  }

  console.log("Seed complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
