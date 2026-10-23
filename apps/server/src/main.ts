import { createBot, enqueue } from "./bot.ts";
import { ExtensionBridge } from "./bridge.ts";
import { config } from "./config.ts";
import { Store } from "./db.ts";
import { deliver } from "./delivery.ts";
import { LeadService } from "./lead-service.ts";
import { startMapServer } from "./map-page.ts";
import { GoogleSheets } from "./sheets.ts";

const TASK_TIMEOUT_MIN = 30;

const store = new Store(config.dbPath);
store.requeueRunning(); // задачи, прерванные прошлым перезапуском сервера

// bot создаётся после bridge, но обработчик результатов вызывается позже — к этому моменту он уже есть
let bot: ReturnType<typeof createBot>;
let leads: LeadService;
const bridge = new ExtensionBridge(store, (task, result) => deliver(bot.api, store, task, result, config.publicUrl));
bot = createBot(store, bridge, (chatId, draft, tg) => leads.save(chatId, draft, tg));

const sheets =
  config.googleKeyFile && config.googleSheet
    ? GoogleSheets.fromKeyFile(config.googleKeyFile, config.googleSheet, config.googleSheetTab)
    : null;
if (!sheets) console.log("[lead] Google Sheets не настроен — лиды сохраняются только в базе");
leads = new LeadService(store, bot.api, sheets, config.realtorChatIds);
setInterval(() => leads.sync(), 60_000);
leads.sync();

bridge.listen(config.wsHost, config.wsPort, config.wsToken);
if (config.publicUrl) startMapServer(store, config.mapHost, config.mapPort);
else console.log("[map] PUBLIC_URL не задан — кнопки «Показать на карте» не будет");

// Подписки «следить за новыми»
setInterval(() => {
  store.expireOldTasks(TASK_TIMEOUT_MIN);
  store.deleteOldMaps(14);
  if (!bridge.connected) return;
  for (const search of store.watchedSearches()) {
    if (!store.hasPendingTask(search.id)) enqueue(store, bridge, search, true);
  }
}, config.watchIntervalMin * 60_000);

process.once("SIGINT", () => bot.stop());
process.once("SIGTERM", () => bot.stop());

await bot.start({ onStart: (me) => console.log(`[bot] @${me.username} запущен`) });
