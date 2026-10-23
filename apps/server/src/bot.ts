import { Bot, InlineKeyboard, Keyboard, type Context } from "grammy";
import type { TaskPayload } from "@realt-agent/shared";
import type { ExtensionBridge } from "./bridge.ts";
import { config } from "./config.ts";
import type { Search, Store } from "./db.ts";
import {
  advance,
  fromParams,
  greeting,
  onChoice,
  onContact,
  onText,
  question,
  startContact,
  type Draft,
  type Reply,
} from "./dialogue.ts";
import { describeParams, esc } from "./format.ts";
import type { TgUser } from "./leads.ts";

const MAX_PAGES = 3;
const usd = (n: number) => "$" + Math.round(n).toLocaleString("ru-RU").replace(/[\s\u00a0,]/g, " ");

const HELP = `Я подбираю квартиры в Минске на realt.by — как риелтор: спрошу, что вам важно, и пришлю подходящие варианты.

Можно сразу одной фразой: <i>куплю двушку от 60 до 80 тыс $, не первый этаж</i>
Если назвать вилку бюджета — ищу сразу, без лишних вопросов.

/new — новый поиск (быстрый или подробный подбор с риелтором)
/watch — присылать новые объявления по последнему поиску
/stop — отключить подписки
/format — фото с описанием или только ссылки
/limit 5 — сколько вариантов присылать
/status — подключён ли браузер`;

export function enqueue(store: Store, bridge: ExtensionBridge, search: Pick<Search, "id" | "chat_id" | "params">, onlyNew: boolean) {
  const payload: TaskPayload = { site: "realt", params: search.params, maxPages: MAX_PAGES };
  store.addTask(search, payload, onlyNew);
  bridge.flush();
}

export type LeadHandler = (chatId: number, draft: Draft, tg: TgUser) => Promise<void>;

const tgUser = (ctx: Context): TgUser => ({
  id: ctx.from!.id,
  username: ctx.from!.username,
  firstName: ctx.from!.first_name,
});

/** Черновик из базы с именем из Telegram — подсказкой на вопрос «как к вам обращаться». */
const withName = (draft: Draft, ctx: Context): Draft => ({ ...draft, tgName: ctx.from?.first_name });

export function createBot(store: Store, bridge: ExtensionBridge, onLead: LeadHandler): Bot {
  const bot = new Bot(config.botToken);
  const rate = Number(config.usdBynRate);

  // Только личные чаты и, если задан список, только разрешённые пользователи
  bot.use(async (ctx, next) => {
    if (ctx.chat?.type !== "private") return;
    if (config.allowedIds.size && !config.allowedIds.has(ctx.from?.id ?? 0)) {
      await ctx.reply(`Бот приватный. Ваш id: ${ctx.from?.id}`);
      return;
    }
    await next();
  });

  /** Отправляет реплику диалога, запоминает состояние и, если пора, запускает поиск. */
  async function respond(ctx: Context, draft: Draft, reply: Reply) {
    const chatId = ctx.chat!.id;
    store.setDialog(chatId, draft, reply.step);

    let text = esc(reply.text);
    if (reply.search && !bridge.connected) {
      text += "\n\n🔴 Браузер сейчас не в сети. Откройте Chrome — поиск начнётся автоматически.";
    }

    // Клавиатуру «Поделиться номером» убираем отдельным сообщением: в одном нельзя и убрать её, и показать кнопки
    if (reply.removeKeyboard) {
      const [head, ...rest] = text.split("\n\n");
      const hasHead = rest.length > 0 && head!.length < 120;
      await ctx.reply(hasHead ? head! : "👍", { parse_mode: "HTML", reply_markup: { remove_keyboard: true } });
      if (hasHead) text = rest.join("\n\n");
    }

    const reply_markup = reply.contactRequest
      ? new Keyboard().requestContact("📱 Поделиться номером").row().text("Без телефона").resized().oneTime()
      : reply.buttons && InlineKeyboard.from(reply.buttons.map((r) => r.map((b) => InlineKeyboard.text(b.text, b.data))));
    await ctx.reply(text, { parse_mode: "HTML", reply_markup });

    if (reply.lead) await onLead(chatId, draft, tgUser(ctx));

    if (reply.search) {
      const searchId = store.addSearch(chatId, describeParams(reply.search), reply.search);
      enqueue(store, bridge, { id: searchId, chat_id: chatId, params: reply.search }, false);
    }
  }

  /** Убирает кнопки с сообщения, на котором нажали, чтобы не нажать старый вопрос второй раз. */
  async function closeButtons(ctx: Context) {
    await ctx.answerCallbackQuery().catch(() => {});
    await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } }).catch(() => {});
  }

  bot.command(["start", "new"], (ctx) => respond(ctx, withName({}, ctx), greeting()));
  bot.command("help", (ctx) => ctx.reply(HELP, { parse_mode: "HTML" }));

  bot.command("status", (ctx) =>
    ctx.reply(bridge.connected ? "🟢 Браузер подключён" : "🔴 Браузер не в сети — откройте Chrome"),
  );

  async function watchLast(ctx: Context) {
    const last = store.lastSearch(ctx.chat!.id);
    if (!last) return ctx.reply("Сначала сделаем поиск — напишите, что ищете.");
    store.setWatch(last.id, true);
    await ctx.reply(`👁 Буду присылать новые объявления: ${describeParams(last.params)}.\nОтключить — /stop`);
  }
  bot.command("watch", watchLast);

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

  // Ответ на вопрос кнопкой
  bot.callbackQuery(/^d:/, async (ctx) => {
    await closeButtons(ctx);
    const chat = store.chat(ctx.chat!.id);
    const result = onChoice(withName(chat.draft, ctx), ctx.callbackQuery.data);
    if (result) await respond(ctx, result.draft, result.reply);
  });

  // Кнопки после выдачи: изменить бюджет, комнаты, следить, новый поиск, поднять бюджет
  bot.callbackQuery(/^f:/, async (ctx) => {
    await closeButtons(ctx);
    const [, action, value] = ctx.callbackQuery.data.split(":");
    if (action === "new") return respond(ctx, withName({}, ctx), greeting());
    if (action === "watch") return watchLast(ctx);

    const last = store.lastSearch(ctx.chat!.id);
    if (action === "contact") {
      const { draft, reply } = startContact(last?.params ?? null, ctx.from?.first_name);
      return respond(ctx, draft, reply);
    }
    if (!last) return respond(ctx, withName({}, ctx), greeting());
    const draft = fromParams(last.params);

    if (action === "max") {
      draft.budget = { min: draft.budget?.min ?? null, max: Number(value) };
      return respond(ctx, draft, advance(draft, [`Хорошо, смотрю до ${usd(Number(value))}.`]));
    }
    if (action === "budget" || action === "rooms") {
      delete draft[action];
      return respond(ctx, draft, { ...question(action, draft), step: action });
    }
  });

  // Свободный текст — ответ на текущий вопрос или новая/уточнённая фраза
  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text.trim();
    if (text.startsWith("/")) return ctx.reply(HELP, { parse_mode: "HTML" });
    const chat = store.chat(ctx.chat.id);
    const last = store.lastSearch(ctx.chat.id);
    const { draft, reply } = onText(withName(chat.draft, ctx), chat.step, text, rate, last?.params ?? null);
    await respond(ctx, draft, reply);
  });

  // Номер, отправленный кнопкой «Поделиться номером»
  bot.on("message:contact", async (ctx) => {
    const chat = store.chat(ctx.chat.id);
    if (chat.step !== "c_phone") return ctx.reply("Спасибо! Номер пригодится, когда дойдём до контактов 🙂");
    const { draft, reply } = onContact(withName(chat.draft, ctx), ctx.message.contact.phone_number);
    await respond(ctx, draft, reply);
  });

  // Пользователь не должен остаться без ответа, если что-то упало
  bot.catch(async (err) => {
    console.error("[bot]", err.error);
    await err.ctx.reply("⚠️ Что-то пошло не так. Попробуйте ещё раз.").catch(() => {});
  });
  return bot;
}
