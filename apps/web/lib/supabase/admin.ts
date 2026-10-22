import "server-only";
import { createClient } from "@supabase/supabase-js";

/** Сервисный клиент: обходит RLS. Только для webhook-ов, API и cron. */
export function createAdminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
