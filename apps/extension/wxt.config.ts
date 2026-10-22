import { defineConfig } from "wxt";

export default defineConfig({
  manifest: ({ mode }) => ({
    name: "Realt Agent",
    description: "Ищет квартиры на realt.by по вашим запросам из Telegram",
    permissions: ["storage", "tabs", "scripting", "alarms"],
    host_permissions: [
      "https://realt.by/*",
      "https://*.supabase.co/*",
      // адрес веб-приложения: результаты поиска уходят туда
      mode === "development" ? "http://localhost:3000/*" : `${process.env.WXT_API_URL}/*`,
    ],
  }),
});
