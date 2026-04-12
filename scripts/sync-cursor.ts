import "dotenv/config";

import { syncCursorData } from "../src/server/cursor-sync";

async function main() {
  const result = await syncCursorData();
  console.log(JSON.stringify(result, null, 2));
  if (result.errors.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
