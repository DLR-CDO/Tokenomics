// Standalone smoke test for parsePricingMdx.
// Reads the MDX from a file path passed as first arg, prints a category/tier breakdown.
// Run with:  npx tsx scripts/smoke-pricing.ts /tmp/openai-pricing.mdx

import { readFileSync } from "node:fs";

import { parsePricingMdx, type PricingRow } from "../src/server/openai-pricing";

function fmt(n: number | undefined): string {
  return n === undefined ? "" : String(n);
}

function main(): void {
  const path = process.argv[2];
  if (!path) {
    console.error("usage: tsx scripts/smoke-pricing.ts <path-to-mdx>");
    process.exit(1);
  }
  const raw = readFileSync(path, "utf8");
  const rows = parsePricingMdx(raw);

  const byCat = new Map<string, PricingRow[]>();
  for (const r of rows) {
    const arr = byCat.get(r.category) ?? [];
    arr.push(r);
    byCat.set(r.category, arr);
  }

  console.log(`Parsed ${rows.length} total rows`);
  for (const [cat, arr] of [...byCat.entries()].sort()) {
    const tiers = new Map<string, number>();
    for (const r of arr) tiers.set(r.tier, (tiers.get(r.tier) ?? 0) + 1);
    const tierStr = [...tiers.entries()].map(([t, n]) => `${t}=${n}`).join(" ");
    console.log(`  ${cat.padEnd(14)} ${arr.length.toString().padStart(3)} rows  (${tierStr})`);
  }

  // Spot-check a few of the salvaged entries.
  const interesting = rows.filter((r) =>
    /containers|file search|agent kit|deep research|computer-use|embedding|moderation/i.test(r.model),
  );
  if (interesting.length > 0) {
    console.log(`\nSalvaged sample (${interesting.length} rows):`);
    for (const r of interesting.slice(0, 20)) {
      console.log(
        `  [${r.category}/${r.tier}] ${r.model.padEnd(40)} in=${fmt(r.inputUsdPerMtok).padEnd(6)} cached=${fmt(r.cachedInputUsdPerMtok).padEnd(6)} out=${fmt(r.outputUsdPerMtok).padEnd(6)} unit=${r.unit ?? ""}  notes=${r.notes ?? ""}`,
      );
    }
  }
}

main();
