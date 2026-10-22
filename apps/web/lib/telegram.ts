import "server-only";

/** Минимальный клиент Telegram Bot API (без сторонних библиотек). */

export interface TgUpdate {
  update_id: number;
  message?: {
    message_id: number;
    chat: { id: number; type: string };
    from?: { id: number; username?: string };
    text?: string;
  };
}

async function call<T = unknown>(method: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as { ok: boolean; result: T; description?: string };
  if (!json.ok) throw new Error(`Telegram ${method}: ${json.description}`);
  return json.result;
}

export function sendMessage(chatId: number, text: string) {
  return call("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
  });
}

export function sendPhoto(chatId: number, photoUrl: string, caption: string) {
  return call("sendPhoto", { chat_id: chatId, photo: photoUrl, caption, parse_mode: "HTML" });
}

export function sendTyping(chatId: number) {
  return call("sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => {});
}
