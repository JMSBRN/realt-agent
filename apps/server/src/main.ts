import { createBot, enqueue } from "./bot.ts";
import { ExtensionBridge } from "./bridge.ts";
import { config } from "./config.ts";
import { Store } from "./db.ts";
import { deliver } from "./delivery.ts";

const TASK_TIMEOUT_MIN = 30;

const store = new Store(config.dbPath);
store.requeueRunning(); // задачи, прерванные прошлым перезапуском сервера

// bot создаётся после bridge, но обработчик результатов вызывается позже — к этому моменту он уже есть
let bot: ReturnType<typeof createBot>;
const bridge = new ExtensionBridge(store, (task, result) => deliver(bot.api, store, task, result));
bot = createBot(store, bridge);

bridge.listen(config.wsHost, config.wsPort, config.wsToken);

// Подписки «следить за новыми»
setInterval(() => {
  store.expireOldTasks(TASK_TIMEOUT_MIN);
  if (!bridge.connected) return;
  for (const search of store.watchedSearches()) {
    if (!store.hasPendingTask(search.id)) enqueue(store, bridge, search, true);
  }
}, config.watchIntervalMin * 60_000);

process.once("SIGINT", () => bot.stop());
process.once("SIGTERM", () => bot.stop());

await bot.start({ onStart: (me) => console.log(`[bot] @${me.username} запущен`) });
