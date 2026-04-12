import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";

async function main() {
  const db = getDb();

  const result = await db.execute(sql`
    UPDATE usage_facts
    SET
      billing_group_id = dimensions_json->>'groupId',
      billing_group_name = dimensions_json->>'groupName'
    WHERE metric_kind = 'cost_usd'
      AND source_system = 'cursor'
      AND dimensions_json->>'source' = 'billing_groups'
      AND billing_group_id IS NULL
  `);

  console.log(`Backfilled ${(result as unknown as { rowCount?: number }).rowCount ?? 0} rows with billing group columns`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
