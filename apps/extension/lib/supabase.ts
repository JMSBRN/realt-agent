import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { browser } from "wxt/browser";

/** Сессия хранится в chrome.storage.local — общая для popup и service worker. */
const storage = {
  getItem: async (key: string) => ((await browser.storage.local.get(key))[key] as string | undefined) ?? null,
  setItem: (key: string, value: string) => browser.storage.local.set({ [key]: value }),
  removeItem: (key: string) => browser.storage.local.remove(key),
};

/**
 * autoRefresh включаем только в service worker: если токен обновляют
 * сразу два клиента, Supabase отзывает сессию (ротация refresh-токена).
 */
export function createSupabase(autoRefreshToken: boolean): SupabaseClient {
  return createClient(import.meta.env.WXT_SUPABASE_URL, import.meta.env.WXT_SUPABASE_ANON_KEY, {
    auth: { storage, persistSession: true, autoRefreshToken, detectSessionInUrl: false },
  });
}

export const API_URL: string = import.meta.env.WXT_API_URL;
