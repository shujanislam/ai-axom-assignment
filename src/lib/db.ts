import "server-only";
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

let client: NeonQueryFunction<false, false> | null = null;

// Connects on the first query, not on import: `next build` imports every route to collect page
// data, and the build environment doesn't need (or have) DATABASE_URL.
function db() {
  if (!client) {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set. Add it to .env.local.");
    client = neon(process.env.DATABASE_URL);
  }
  return client;
}

/** Tagged-template SQL client over Neon's HTTP driver. Values are always sent as parameters. */
export const sql = ((strings: TemplateStringsArray, ...values: unknown[]) =>
  db()(strings, ...values)) as NeonQueryFunction<false, false>;
