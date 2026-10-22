import type { Api } from "grammy";
import { matchesParams, sortNewestFirst, type Listing, type TaskResult } from "@realt-agent/shared";
import type { Store, Task } from "./db.ts";
import { listingCaption, listingLine } from "./format.ts";

const HTML = { parse_mode: "HTML" as const, link_preview_options: { is_disabled: true } };

/** Выбирает, что показать: подходит под запрос, свежее первым, для подписки — только новое. */
export function selectListings(store: Store, task: Task, items: Listing[]): Listing[] {
  const matched = sortNewestFirst(items.filter((l) => matchesParams(l, task.payload.params)));
  // всё найденное отмечаем как показанное: подписка потом пришлёт только новое
  const alreadySeen = store.markSeen(task.search_id, matched.map((l) => l.id));
  return task.only_new ? matched.filter((l) => !alreadySeen.has(l.id)) : matched;
}

/** Отправляет итог задачи в Telegram. */
export async function deliver(api: Api, store: Store, task: Task, result: TaskResult) {
  const chatId = task.chat_id;

  if (result.status === "captcha") {
    await api.sendMessage(chatId, "⚠️ realt.by показал проверку «я не робот». Пройдите её в открытой вкладке Chrome и повторите запрос.");
    return;
  }
  if (result.status === "failed") {
    if (!task.only_new) await api.sendMessage(chatId, "⚠️ Поиск не удался. Попробуйте ещё раз чуть позже.");
    return;
  }

  const listings = selectListings(store, task, result.items);
  if (!listings.length) {
    if (!task.only_new) await api.sendMessage(chatId, "Ничего не нашлось. Попробуйте расширить условия.");
    return;
  }

  const chat = store.chat(chatId);
  const shown = listings.slice(0, chat.results_limit);
  await api.sendMessage(
    chatId,
    task.only_new ? `🆕 Новые объявления: ${listings.length}` : `Нашёл ${listings.length}, показываю ${shown.length}:`,
  );

  if (chat.result_format === "links") {
    await api.sendMessage(chatId, shown.map(listingLine).join("\n\n"), HTML);
    return;
  }
  for (const l of shown) {
    const caption = listingCaption(l);
    try {
      if (!l.images[0]) throw new Error("no photo");
      await api.sendPhoto(chatId, l.images[0], { caption, parse_mode: "HTML" });
    } catch {
      await api.sendMessage(chatId, caption, HTML);
    }
  }
}
