import "dotenv/config";

import { syncAzureData } from "../src/server/azure-sync";

async function main() {
  const result = await syncAzureData();
  console.log(JSON.stringify(result, null, 2));
  if (result.errors.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
