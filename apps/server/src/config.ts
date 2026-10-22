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
  claudeModel: process.env.CLAUDE_MODEL ?? "claude-opus-5-5",
  usdBynRate: process.env.USD_BYN_RATE ?? "3.0",
  wsHost: process.env.WS_HOST ?? "127.0.0.1",
  wsPort: Number(process.env.WS_PORT ?? 8765),
  wsToken: required("WS_TOKEN"),
  watchIntervalMin: Number(process.env.WATCH_INTERVAL_MIN ?? 30),
  dbPath: process.env.DB_PATH ?? "realt-agent.db",
};
