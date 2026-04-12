import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set");
  }
  return url;
}

const globalForDb = globalThis as unknown as {
  queryClient?: ReturnType<typeof postgres>;
  db?: ReturnType<typeof drizzle<typeof schema>>;
};

export function getDb() {
  if (!globalForDb.queryClient) {
    globalForDb.queryClient = postgres(getDatabaseUrl(), { max: 10, idle_timeout: 20, connect_timeout: 10 });
    globalForDb.db = drizzle(globalForDb.queryClient, { schema });
  }
  return globalForDb.db!;
}

export { schema };
