import { Agent } from "./agent.ts";
import { createBot, enqueue } from "./bot.ts";
import { ExtensionBridge } from "./bridge.ts";
import { config } from "./config.ts";
import { Store } from "./db.ts";
import { deliver } from "./delivery.ts";
import { describeParams } from "./format.ts";
import { LeadService } from "./lead-service.ts";
import { startMapServer } from "./map-page.ts";
import { OpenAICompatibleLLM } from "./llm.ts";
import { Realty } from "./realty.ts";
import { GoogleSheets } from "./sheets.ts";

const TASK_TIMEOUT_MIN = 30;

const store = new Store(config.dbPath);
store.requeueRunning(); // задачи, прерванные прошлым перезапуском сервера

// bot создаётся после bridge, но обработчик результатов вызывается позже — к этому моменту он уже есть
let bot: ReturnType<typeof createBot>;
let leads: LeadService;
const bridge = new ExtensionBridge(store, (task, result) =>
  deliver(bot.api, store, task, result, {
    publicUrl: config.publicUrl,
    research: (chatId, params) => {
      const id = store.addSearch(chatId, describeParams(params), params);
      enqueue(store, bridge, { id, chat_id: chatId, params }, false);
    },
  }),
);
const agent = config.llmApiKey
  ? new Agent(
      new OpenAICompatibleLLM(config.llmBaseUrl, config.llmApiKey, config.llmModel),
      new Realty(bridge, store),
      store,
      config.usdBynRate,
      config.publicUrl ? { publicUrl: config.publicUrl, addMap: (title, points) => store.addMap(title, points) } : null,
    )
  : null;
if (!agent) console.log("[agent] LLM_API_KEY не задан — бот отвечает только по кнопкам и правилам");
bot = createBot(store, bridge, (chatId, draft, tg) => leads.save(chatId, draft, tg), agent);

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
