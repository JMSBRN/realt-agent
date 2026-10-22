import { defineConfig } from "wxt";

export default defineConfig({
  manifest: {
    name: "Realt Agent",
    description: "Ищет квартиры на realt.by по вашим запросам из Telegram",
    permissions: ["storage", "tabs", "scripting", "alarms"],
    host_permissions: ["https://realt.by/*"],
  },
});
