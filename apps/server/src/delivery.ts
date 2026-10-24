import { InlineKeyboard, type Api } from "grammy";
import { matchesParams, sortNewestFirst, type Listing, type SearchParams, type TaskResult } from "@realt-agent/shared";
import type { Store, Task } from "./db.ts";
import { describeParams, listingCaption, listingLine } from "./format.ts";
import { toPoints } from "./map-page.ts";

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
export function raisedBudget(cheapestUsd: number, deal: "sale" | "rent" | "rent_day"): number {
  const step = deal === "sale" ? 1000 : deal === "rent" ? 50 : 10;
  return Math.ceil((cheapestUsd * 1.05) / step) * step;
}

/** Кнопка карты: по https — Mini App внутри Telegram, по http — обычная ссылка в браузер. */
function withMap(kb: InlineKeyboard, mapUrl: string | null): InlineKeyboard {
  if (!mapUrl) return kb;
  return mapUrl.startsWith("https://")
    ? kb.webApp("🗺 Показать на карте", mapUrl).row()
    : kb.url("🗺 Показать на карте", mapUrl).row();
}

const nextSteps = (mapUrl: string | null = null) =>
  withMap(new InlineKeyboard(), mapUrl)
    .text("✏️ Изменить бюджет", "f:budget")
    .text("🏠 Другие комнаты", "f:rooms")
    .row()
    .text("👁 Следить за новыми", "f:watch")
    .text("🔄 Новый поиск", "f:new")
    .row()
    .text("📞 Связаться с риелтором", "f:contact");

/** Отправляет итог задачи в Telegram. */
export interface DeliverOptions {
  publicUrl?: string | null;
  /** Запустить новый поиск — когда условие района/улицы ничего не дало и мы его снимаем. */
  research?: (chatId: number, params: SearchParams) => void;
}

export async function deliver(api: Api, store: Store, task: Task, result: TaskResult, opts: DeliverOptions = {}) {
  const publicUrl = opts.publicUrl ?? null;
  const chatId = task.chat_id;
  const params = task.payload.params;

  if (result.status === "captcha") {
    await api.sendMessage(chatId, "⚠️ realt.by показал проверку «я не робот». Пройдите её в открытой вкладке Chrome, и я повторю поиск.");
    return;
  }
  if (result.status === "failed") {
    console.error(`[task] ${task.id} не удалась: ${result.error}`);
    if (!task.only_new) {
      const reason = result.error.replace(/^Error:\s*/, "").slice(0, 300);
      await api.sendMessage(chatId, `⚠️ Поиск не удался: ${reason}`, {
        reply_markup: new InlineKeyboard().text("🔁 Повторить поиск", "f:retry").text("🔄 Новый поиск", "f:new"),
      });
    }
    return;
  }

  const listings = selectListings(store, task, result.items);
  console.log(`[task] ${task.id}: просмотрено ${result.scanned ?? "?"}, подходит ${listings.length}`);

  if (!listings.length) {
    if (task.only_new) return;
    const scanned = result.scanned != null ? ` среди ${result.scanned} объявлений` : "";
    // Район или улица часто слишком узкие: не оставляем клиента в тупике — снимаем условие и ищем снова
    if (params.keywords.length && opts.research) {
      const relaxed = { ...params, keywords: [] };
      await api.sendMessage(
        chatId,
        `С условием «${params.keywords.join(", ")}» подходящих нет${scanned}. ` +
          `Смотрю другие варианты: ${describeParams(relaxed)} ⏳`,
      );
      opts.research(chatId, relaxed);
      return;
    }
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

  // На карте — все найденные варианты, а не только показанные карточками
  const points = toPoints(listings.slice(0, 200));
  const mapUrl =
    publicUrl && points.length
      ? `${publicUrl}/map/${store.addMap(`${listings.length} вариантов · ${describeParams(params)}`, points)}`
      : null;
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

  if (!task.only_new) {
    await api.sendMessage(chatId, "Что-то приглянулось? Могу уточнить поиск:", { reply_markup: nextSteps(mapUrl) });
  } else if (mapUrl) {
    await api.sendMessage(chatId, "Новые варианты на карте:", { reply_markup: withMap(new InlineKeyboard(), mapUrl) });
  }
}
