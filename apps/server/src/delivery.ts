import { InlineKeyboard, type Api } from "grammy";
import { matchesParams, sortNewestFirst, type Listing, type TaskResult } from "@realt-agent/shared";
import type { Store, Task } from "./db.ts";
import { listingCaption, listingLine } from "./format.ts";

const HTML = { parse_mode: "HTML" as const, link_preview_options: { is_disabled: true } };

const usd = (n: number) => "$" + Math.round(n).toLocaleString("ru-RU").replace(/[\s ,]/g, " ");

/** Выбирает, что показать: подходит под запрос, свежее первым, для подписки — только новое. */
export function selectListings(store: Store, task: Task, items: Listing[]): Listing[] {
  const matched = sortNewestFirst(items.filter((l) => matchesParams(l, task.payload.params)));
  // всё найденное отмечаем как показанное: подписка потом пришлёт только новое
  const alreadySeen = store.markSeen(task.search_id, matched.map((l) => l.id));
  return task.only_new ? matched.filter((l) => !alreadySeen.has(l.id)) : matched;
}

/** Бюджет, до которого стоит поднять потолок, чтобы самый доступный вариант попал в выдачу. */
export function raisedBudget(cheapestUsd: number, deal: "sale" | "rent"): number {
  const step = deal === "sale" ? 1000 : 50;
  return Math.ceil((cheapestUsd * 1.05) / step) * step;
}

const nextSteps = () =>
  new InlineKeyboard()
    .text("✏️ Изменить бюджет", "f:budget")
    .text("🏠 Другие комнаты", "f:rooms")
    .row()
    .text("👁 Следить за новыми", "f:watch")
    .text("🔄 Новый поиск", "f:new");

/** Отправляет итог задачи в Telegram. */
export async function deliver(api: Api, store: Store, task: Task, result: TaskResult) {
  const chatId = task.chat_id;
  const params = task.payload.params;

  if (result.status === "captcha") {
    await api.sendMessage(chatId, "⚠️ realt.by показал проверку «я не робот». Пройдите её в открытой вкладке Chrome, и я повторю поиск.");
    return;
  }
  if (result.status === "failed") {
    console.error(`[task] ${task.id} не удалась: ${result.error}`);
    if (!task.only_new) await api.sendMessage(chatId, `⚠️ Поиск не удался: ${result.error.slice(0, 300)}`);
    return;
  }

  const listings = selectListings(store, task, result.items);
  console.log(`[task] ${task.id}: просмотрено ${result.scanned ?? "?"}, подходит ${listings.length}`);

  if (!listings.length) {
    if (task.only_new) return;
    const scanned = result.scanned != null ? ` среди ${result.scanned} объявлений` : "";
    // Есть варианты дороже бюджета — предлагаем поднять потолок, как сделал бы риелтор
    if (result.cheapestUsd != null && params.priceMaxUsd != null && result.cheapestUsd > params.priceMaxUsd) {
      const raised = raisedBudget(result.cheapestUsd, params.deal);
      await api.sendMessage(
        chatId,
        `В бюджете до ${usd(params.priceMaxUsd)} подходящих вариантов нет${scanned}.\n` +
          `Самый доступный из подходящих — ${usd(result.cheapestUsd)}. Поднимем бюджет до ${usd(raised)}?`,
        {
          reply_markup: new InlineKeyboard()
            .text(`Да, до ${usd(raised)}`, `f:max:${raised}`)
            .row()
            .text("✏️ Изменить бюджет", "f:budget")
            .text("🔄 Новый поиск", "f:new"),
        },
      );
      return;
    }
    await api.sendMessage(chatId, `Подходящих вариантов не нашёл${scanned}. Давайте смягчим условия?`, {
      reply_markup: nextSteps(),
    });
    return;
  }

  const chat = store.chat(chatId);
  const shown = listings.slice(0, chat.results_limit);
  await api.sendMessage(
    chatId,
    task.only_new
      ? `🆕 Появились новые объявления: ${listings.length}`
      : `Нашёл ${listings.length} подходящих. Вот самые свежие ${shown.length}:`,
  );

  if (chat.result_format === "links") {
    await api.sendMessage(chatId, shown.map(listingLine).join("\n\n"), HTML);
  } else {
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

  if (!task.only_new) await api.sendMessage(chatId, "Что-то приглянулось? Могу уточнить поиск:", { reply_markup: nextSteps() });
}
