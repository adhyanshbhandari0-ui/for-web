import { createDataClient, type DataClient } from "@dib/data-client";

let cached: DataClient | null | undefined;

export function getBrowserDataClient(): DataClient | null {
  if (cached !== undefined) return cached;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  cached = null;
  if (supabaseUrl && supabaseAnonKey && !supabaseAnonKey.startsWith("paste-")) {
    try {
      cached = createDataClient({ supabaseUrl, supabaseAnonKey });
    } catch {
      // The simulator can still run a synthetic example without Supabase.
    }
  }
  return cached;
}
