import { Bot, type Context } from "grammy";
import { realtTownUuid, type TaskPayload } from "@realt-agent/shared";
import type { ExtensionBridge } from "./bridge.ts";
import { config } from "./config.ts";
import type { Search, Store } from "./db.ts";
import { describeParams, esc } from "./format.ts";
import { parseQuery } from "./parse-query.ts";

const MAX_PAGES = 3;

const HELP = `Напишите, что ищете, обычным текстом. Например:
<i>однушка в Минске до 40 тысяч долларов, не первый этаж</i>

/watch — присылать новые объявления по последнему запросу
/stop — отключить подписки
/format — фото с описанием или только ссылки
/limit 5 — сколько вариантов присылать
/status — подключён ли браузер`;

export function enqueue(store: Store, bridge: ExtensionBridge, search: Pick<Search, "id" | "chat_id" | "params">, onlyNew: boolean) {
  const payload: TaskPayload = { site: "realt", params: search.params, maxPages: MAX_PAGES };
  store.addTask(search, payload, onlyNew);
  bridge.flush();
}

export function createBot(store: Store, bridge: ExtensionBridge): Bot {
  const bot = new Bot(config.botToken);

  // Только личные чаты и, если задан список, только разрешённые пользователи
  bot.use(async (ctx, next) => {
    if (ctx.chat?.type !== "private") return;
    if (config.allowedIds.size && !config.allowedIds.has(ctx.from?.id ?? 0)) {
      await ctx.reply(`Бот приватный. Ваш id: ${ctx.from?.id}`);
      return;
    }
    await next();
  });

  const reply = (ctx: Context, text: string) =>
    ctx.reply(text, { parse_mode: "HTML", link_preview_options: { is_disabled: true } });

  bot.command(["start", "help"], (ctx) => reply(ctx, `Я ищу квартиры на realt.by через ваш браузер.\n\n${HELP}`));

  bot.command("status", (ctx) =>
    ctx.reply(bridge.connected ? "🟢 Браузер подключён" : "🔴 Браузер не в сети — откройте Chrome"),
  );

  bot.command("watch", async (ctx) => {
    const last = store.lastSearch(ctx.chat.id);
    if (!last) return ctx.reply("Сначала сделайте поиск.");
    store.setWatch(last.id, true);
    await reply(ctx, `👁 Слежу за новыми: ${esc(describeParams(last.params))}`);
  });

  bot.command("stop", (ctx) => {
    const n = store.stopAllWatches(ctx.chat.id);
    return ctx.reply(n ? "Подписки отключены." : "Активных подписок нет.");
  });

  bot.command("format", (ctx) => {
    const next = store.chat(ctx.chat.id).result_format === "cards" ? "links" : "cards";
    store.setFormat(ctx.chat.id, next);
    return ctx.reply(next === "cards" ? "Буду присылать фото с описанием." : "Буду присылать списком ссылок.");
  });

  bot.command("limit", (ctx) => {
    const n = Number(ctx.match);
    if (!Number.isInteger(n) || n < 1 || n > 20) return ctx.reply("Укажите число от 1 до 20, например: /limit 5");
    store.setLimit(ctx.chat.id, n);
    return ctx.reply(`Буду присылать до ${n} вариантов.`);
  });

  // Свободный текст → параметры поиска (с учётом ответа на уточняющий вопрос)
  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text.trim();
    if (text.startsWith("/")) return reply(ctx, HELP);

    const chatId = ctx.chat.id;
    await ctx.replyWithChatAction("typing");
    const pending = store.chat(chatId).pending_query;
    const query = pending ? `${pending}\n${text}` : text;
    const parsed = await parseQuery(query);

    if (!parsed.params) {
      store.setPendingQuery(chatId, query);
      return reply(ctx, esc(parsed.question ?? "Уточните, пожалуйста, запрос."));
    }
    store.setPendingQuery(chatId, null);

    if (!realtTownUuid(parsed.params.city)) {
      return reply(ctx, `Пока умею искать только в Минске, а вы спросили про «${esc(parsed.params.city)}».`);
    }

    const searchId = store.addSearch(chatId, query, parsed.params);
    enqueue(store, bridge, { id: searchId, chat_id: chatId, params: parsed.params }, false);
    await reply(
      ctx,
      `🔍 Ищу: ${esc(describeParams(parsed.params))}` +
        (bridge.connected ? "" : "\n\n🔴 Браузер сейчас не в сети. Откройте Chrome — поиск начнётся автоматически."),
    );
  });

  // Пользователь не должен остаться без ответа, если что-то упало
  bot.catch(async (err) => {
    console.error("[bot]", err.error);
    await err.ctx.reply("⚠️ Что-то пошло не так. Попробуйте ещё раз.").catch(() => {});
  });
  return bot;
}
