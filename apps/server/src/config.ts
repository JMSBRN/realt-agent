function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Не задана переменная окружения ${name} (см. .env.example)`);
  return value;
}

export const config = {
  botToken: required("TELEGRAM_BOT_TOKEN"),
  allowedIds: new Set(
    (process.env.ALLOWED_TELEGRAM_IDS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map(Number),
  ),
  usdBynRate: process.env.USD_BYN_RATE ?? "3.0",
  wsHost: process.env.WS_HOST ?? "127.0.0.1",
  wsPort: Number(process.env.WS_PORT ?? 8765),
  wsToken: required("WS_TOKEN"),
  // Карта результатов: публичный адрес, по которому её откроет Telegram. Пусто — кнопки карты не будет.
  publicUrl: process.env.PUBLIC_URL?.replace(/\/+$/, "") || null,
  mapHost: process.env.MAP_HOST ?? "0.0.0.0",
  mapPort: Number(process.env.MAP_PORT ?? 8080),
  // Лиды: таблица Google Sheets (сервисный аккаунт) и чаты риелторов для уведомлений. Всё необязательно.
  googleKeyFile: process.env.GOOGLE_SERVICE_ACCOUNT_FILE || null,
  googleSheet: process.env.GOOGLE_SHEET || null,
  googleSheetTab: process.env.GOOGLE_SHEET_TAB || null,
  realtorChatIds: (process.env.REALTOR_CHAT_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number),
  // Собеседник: любая модель с OpenAI-совместимым API (Groq, OpenRouter, Ollama…). Без ключа — только кнопки и правила.
  llmApiKey: process.env.LLM_API_KEY || null,
  llmBaseUrl: (process.env.LLM_BASE_URL || "https://api.groq.com/openai/v1").replace(/\/+$/, ""),
  llmModel: process.env.LLM_MODEL || "openai/gpt-oss-120b",
  watchIntervalMin: Number(process.env.WATCH_INTERVAL_MIN ?? 30),
  dbPath: process.env.DB_PATH ?? "realt-agent.db",
};
