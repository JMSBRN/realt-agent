import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  matchesParams,
  sortNewestFirst,
  type Listing,
  type SearchParams,
  type TaskPayload,
} from "@realt-agent/shared";
import { listingCaption, listingLine } from "./format";
import { sendMessage, sendPhoto } from "./telegram";

const ONLINE_WINDOW_MS = 3 * 60 * 1000;
const MAX_PAGES = 3;

export async function isExtensionOnline(db: SupabaseClient, userId: string): Promise<boolean> {
  const { data } = await db.from("extension_sessions").select("last_seen").eq("user_id", userId).maybeSingle();
  return !!data && Date.now() - new Date(data.last_seen).getTime() < ONLINE_WINDOW_MS;
}

/** Сохраняет запрос и ставит задачу расширению. */
export async function enqueueSearch(db: SupabaseClient, userId: string, queryText: string, params: SearchParams) {
  const { data: search, error } = await db
    .from("searches")
    .insert({ user_id: userId, query_text: queryText, params })
    .select("id")
    .single();
  if (error) throw error;
  await enqueueTask(db, userId, search.id, params, false);
  return search.id as string;
}

export async function enqueueTask(
  db: SupabaseClient,
  userId: string,
  searchId: string,
  params: SearchParams,
  onlyNew: boolean,
) {
  const payload: TaskPayload = { site: "realt", params, maxPages: MAX_PAGES };
  const { error } = await db
    .from("tasks")
    .insert({ user_id: userId, search_id: searchId, payload, only_new: onlyNew });
  if (error) throw error;
  await db.from("searches").update({ last_run_at: new Date().toISOString() }).eq("id", searchId);
}

interface TaskRow {
  id: string;
  user_id: string;
  search_id: string | null;
  payload: TaskPayload;
  only_new: boolean;
}

/** Фильтрует результаты задачи, отмечает показанное и отправляет в Telegram. */
export async function deliverResults(db: SupabaseClient, task: TaskRow, items: Listing[]) {
  const { data: profile } = await db
    .from("profiles")
    .select("telegram_chat_id, result_format, results_limit")
    .eq("id", task.user_id)
    .single();
  const chatId = profile?.telegram_chat_id as number | null;

  let matched = sortNewestFirst(items.filter((l) => matchesParams(l, task.payload.params)));

  if (task.search_id) {
    const { data: seen } = await db
      .from("seen_listings")
      .select("listing_id")
      .eq("search_id", task.search_id)
      .in(
        "listing_id",
        matched.map((l) => l.id),
      );
    const seenIds = new Set((seen ?? []).map((r) => r.listing_id as string));
    if (task.only_new) matched = matched.filter((l) => !seenIds.has(l.id));
    // Всё найденное считаем показанным: подписка потом пришлёт только новое
    const fresh = matched.filter((l) => !seenIds.has(l.id));
    if (fresh.length) {
      await db
        .from("seen_listings")
        .upsert(fresh.map((l) => ({ search_id: task.search_id, listing_id: l.id })), { ignoreDuplicates: true });
    }
  }

  if (!chatId) return;
  if (!matched.length) {
    if (!task.only_new) await sendMessage(chatId, "Ничего не нашлось. Попробуйте расширить условия.");
    return;
  }

  const shown = matched.slice(0, profile?.results_limit ?? 5);
  const header = task.only_new
    ? `🆕 Новые объявления: ${matched.length}`
    : `Нашёл ${matched.length}, показываю ${shown.length}:`;
  await sendMessage(chatId, header);

  if (profile?.result_format === "links") {
    await sendMessage(chatId, shown.map(listingLine).join("\n\n"));
    return;
  }
  for (const l of shown) {
    const caption = listingCaption(l);
    try {
      if (!l.images[0]) throw new Error("no photo");
      await sendPhoto(chatId, l.images[0], caption);
    } catch {
      await sendMessage(chatId, caption);
    }
  }
}
