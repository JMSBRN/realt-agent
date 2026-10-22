import { after, NextResponse, type NextRequest } from "next/server";
import { realtTownUuid } from "@realt-agent/shared";
import { createAdminClient } from "@/lib/supabase/admin";
import { describeParams, esc } from "@/lib/format";
import { parseQuery } from "@/lib/parse-query";
import { enqueueSearch, isExtensionOnline } from "@/lib/search";
import { sendMessage, sendTyping, type TgUpdate } from "@/lib/telegram";

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "";

const HELP = `Напишите, что ищете, обычным текстом. Например:
<i>однушка в Минске до 40 тысяч долларов, не первый этаж</i>

/watch — присылать новые объявления по последнему запросу
/stop — отключить все подписки
/status — подключён ли браузер`;

export async function POST(req: NextRequest) {
  if (req.headers.get("x-telegram-bot-api-secret-token") !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const update = (await req.json()) as TgUpdate;
  // Отвечаем Telegram сразу, обработка (с вызовом Claude) идёт после ответа
  after(() => handleUpdate(update).catch((e) => console.error("telegram update failed", e)));
  return NextResponse.json({ ok: true });
}

async function handleUpdate(update: TgUpdate) {
  const msg = update.message;
  const text = msg?.text?.trim();
  if (!msg || !text || msg.chat.type !== "private") return;
  const chatId = msg.chat.id;
  const db = createAdminClient();

  if (text.startsWith("/start")) {
    const code = text.split(" ")[1];
    if (code) return linkAccount(chatId, code, msg.from?.username);
    return sendMessage(chatId, `Привет! Я ищу квартиры на realt.by через ваш браузер.\n\n${HELP}`);
  }

  const { data: profile } = await db
    .from("profiles")
    .select("id, pending_query")
    .eq("telegram_chat_id", chatId)
    .maybeSingle();
  if (!profile) {
    return sendMessage(chatId, `Сначала привяжите аккаунт: ${SITE}/dashboard → «Подключить Telegram».`);
  }

  if (text === "/help") return sendMessage(chatId, HELP);

  if (text === "/status") {
    const online = await isExtensionOnline(db, profile.id);
    return sendMessage(chatId, online ? "🟢 Браузер подключён" : "🔴 Браузер не в сети — откройте Chrome");
  }

  if (text === "/watch") {
    const { data: last } = await db
      .from("searches")
      .select("id, params")
      .eq("user_id", profile.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!last) return sendMessage(chatId, "Сначала сделайте поиск.");
    await db.from("searches").update({ watch: true }).eq("id", last.id);
    return sendMessage(chatId, `👁 Слежу за новыми: ${esc(describeParams(last.params))}`);
  }

  if (text === "/stop") {
    await db.from("searches").update({ watch: false }).eq("user_id", profile.id).eq("watch", true);
    return sendMessage(chatId, "Подписки отключены.");
  }

  if (text.startsWith("/")) return sendMessage(chatId, HELP);

  // Свободный текст → параметры поиска (с учётом ответа на уточняющий вопрос)
  await sendTyping(chatId);
  const query = profile.pending_query ? `${profile.pending_query}\n${text}` : text;
  const parsed = await parseQuery(query);

  if (!parsed.params) {
    await db.from("profiles").update({ pending_query: query }).eq("id", profile.id);
    return sendMessage(chatId, esc(parsed.question ?? "Уточните, пожалуйста, запрос."));
  }
  await db.from("profiles").update({ pending_query: null }).eq("id", profile.id);

  if (!realtTownUuid(parsed.params.city)) {
    return sendMessage(chatId, `Пока умею искать только в Минске, а вы спросили про «${esc(parsed.params.city)}».`);
  }

  await enqueueSearch(db, profile.id, query, parsed.params);
  const online = await isExtensionOnline(db, profile.id);
  await sendMessage(
    chatId,
    `🔍 Ищу: ${esc(describeParams(parsed.params))}` +
      (online ? "" : "\n\n🔴 Браузер сейчас не в сети. Откройте Chrome — поиск начнётся автоматически."),
  );
}

async function linkAccount(chatId: number, code: string, username?: string) {
  const db = createAdminClient();
  const { data: link } = await db
    .from("telegram_link_codes")
    .delete()
    .eq("code", code)
    .gt("expires_at", new Date().toISOString())
    .select("user_id")
    .maybeSingle();
  if (!link) return sendMessage(chatId, "Ссылка устарела. Получите новую в личном кабинете.");

  // один чат — один аккаунт
  await db.from("profiles").update({ telegram_chat_id: null }).eq("telegram_chat_id", chatId);
  await db
    .from("profiles")
    .update({ telegram_chat_id: chatId, telegram_username: username ?? null })
    .eq("id", link.user_id);
  return sendMessage(chatId, `✅ Аккаунт подключён!\n\n${HELP}`);
}
