import assert from "node:assert/strict";
import { test } from "node:test";
import { WebSocket } from "ws";
import type { Listing, ProbePayload, ProbeResult } from "@realt-agent/shared";
import { Agent } from "./agent.ts";
import { agentHtml, looksLikeQuestion, needsAgent } from "./format.ts";
import { ExtensionBridge } from "./bridge.ts";
import { Store } from "./db.ts";
import type { ChatMessage, LLM, Tool } from "./llm.ts";
import { retryDelayMs } from "./llm.ts";
import { Realty, topStreets, type Prober } from "./realty.ts";

const listing = (code: number, over: Partial<Listing> = {}): Listing => ({
  id: `realt:${code}`,
  site: "realt",
  url: `https://realt.by/sale-flats/object/${code}/`,
  title: "Квартира",
  priceUsd: 30000 + code,
  priceByn: null,
  rooms: 1,
  areaTotal: 33,
  storey: 2,
  storeys: 9,
  address: "Гомель",
  metro: null,
  images: [],
  description: "",
  createdAt: null,
  ...over,
});

/** Подставной браузер: отвечает по адресу страницы. */
class FakeBrowser implements Prober {
  connected = true;
  calls: ProbePayload[] = [];
  constructor(private answer: (p: ProbePayload) => ProbeResult) {}
  async probe(p: ProbePayload) {
    this.calls.push(p);
    return this.answer(p);
  }
}

const done = (over: Partial<Extract<ProbeResult, { status: "done" }>> = {}): ProbeResult => ({
  status: "done",
  url: "https://realt.by/x/",
  geoTitle: null,
  address: null,
  totalCount: 0,
  scanned: 0,
  matched: 0,
  minPriceUsd: null,
  items: [],
  ...over,
});

test("count: место и комнаты фильтрует сайт — число точное", async () => {
  const browser = new FakeBrowser(() => done({ totalCount: 112, minPriceUsd: 7500, items: [listing(1)] }));
  const realty = new Realty(browser, new Store(":memory:"));
  const r = await realty.count({ deal: "sale", type: "flat", town: "в Гомеле", rooms: [1] });
  assert.equal(r.count, 112);
  assert.equal(r.exact, true);
  assert.equal(r.place, "Гомель");
  assert.equal(r.minPriceUsd, 7500);
  const url = new URL(browser.calls[0]!.urls[0]!);
  assert.equal(url.searchParams.get("rooms"), "1");
  assert.deepEqual(JSON.parse(url.searchParams.get("addressV2")!), [{ townUuid: "4c95d414-7b00-11eb-8943-0cc47adabd66" }]);
  assert.equal(browser.calls[0]!.filter, null); // наши фильтры не нужны — хватает первой страницы
});

test("count: «1 или 2 комнаты» — по запросу на каждое значение, суммой", async () => {
  const browser = new FakeBrowser((p) => done({ totalCount: new URL(p.urls[0]!).searchParams.get("rooms") === "1" ? 112 : 150 }));
  const r = await new Realty(browser, new Store(":memory:")).count({ deal: "sale", type: "flat", town: "Гомель", rooms: [2, 1] });
  assert.equal(r.count, 262);
  assert.equal(browser.calls.length, 2);
});

test("count: цену проверяем сами — точно, если просмотрели всё, иначе оценка", async () => {
  const exact = new FakeBrowser(() => done({ totalCount: 50, scanned: 50, matched: 12 }));
  const r1 = await new Realty(exact, new Store(":memory:")).count({ deal: "sale", type: "flat", priceMaxUsd: 40000 });
  assert.deepEqual([r1.count, r1.exact, r1.place], [12, true, "Беларусь"]);
  assert.equal(exact.calls[0]!.filter?.priceMaxUsd, 40000);

  const approx = new FakeBrowser(() => done({ totalCount: 1000, scanned: 300, matched: 30 }));
  const r2 = await new Realty(approx, new Store(":memory:")).count({ deal: "sale", type: "flat", priceMaxUsd: 40000 });
  assert.deepEqual([r2.count, r2.exact, r2.totalWithoutOurFilters], [100, false, 1000]);
});

test("resolvePlace: незнакомый город узнаём у realt.by и запоминаем", async () => {
  const browser = new FakeBrowser((p) =>
    p.urls[0]!.includes("/gomel-region/sale/flats/mozyr/")
      ? done({ geoTitle: "г. Мозырь", address: { townUuid: "mozyr-uuid" } })
      : { status: "notfound" },
  );
  const store = new Store(":memory:");
  const realty = new Realty(browser, store);
  assert.deepEqual(await realty.resolvePlace("Мозырь", "Гомельская область"), { title: "Мозырь", address: { townUuid: "mozyr-uuid" } });
  await realty.resolvePlace("Мозырь", "Гомельская область");
  assert.equal(browser.calls.length, 1); // второй раз — из кэша
  await assert.rejects(() => realty.resolvePlace("Неведомск"), /не нашёл/);
  // область без города и вся страна — без обращения к сайту
  assert.equal((await realty.resolvePlace(null, "Брестская область")).title, "Брестская область");
  assert.equal((await realty.resolvePlace(null, null)).address, null);
});

/** Подставная модель: по очереди возвращает заготовленные ответы и запоминает, что ей прислали. */
class ScriptedLLM implements LLM {
  seen: ChatMessage[][] = [];
  constructor(private script: Array<{ content: string | null; tool_calls?: Array<{ name: string; args: unknown }> }>) {}
  async chat(messages: ChatMessage[], _tools?: Tool[]) {
    this.seen.push(messages.map((m) => ({ ...m })));
    const step = this.script.shift() ?? { content: "…" };
    return {
      content: step.content,
      tool_calls: step.tool_calls?.map((c, i) => ({
        id: `c${i}`,
        type: "function" as const,
        function: { name: c.name, arguments: JSON.stringify(c.args) },
      })),
    };
  }
}

test("agent: сам узнаёт число на realt.by и отвечает по нему", async () => {
  const browser = new FakeBrowser(() => done({ totalCount: 112 }));
  const store = new Store(":memory:");
  const llm = new ScriptedLLM([
    { content: null, tool_calls: [{ name: "count_listings", args: { deal: "sale", type: "flat", town: "Гомель", rooms: [1] } }] },
    { content: "Сейчас на realt.by 112 однокомнатных квартир в Гомеле." },
  ]);
  const agent = new Agent(llm, new Realty(browser, store), store, "3.0");
  const r = await agent.reply(7, "Сколько однушек в Гомеле?");
  assert.equal(r.text, "Сейчас на realt.by 112 однокомнатных квартир в Гомеле.");
  // о чём шла речь — для кнопок и подборки: Гомель, однушки
  assert.equal(r.query?.city, "Гомель");
  assert.deepEqual(r.query?.rooms, [1]);
  const toolMsg = llm.seen[1]!.find((m) => m.role === "tool")!;
  assert.match(toolMsg.content as string, /"count":112/);
  // разговор запоминается для следующих вопросов
  assert.deepEqual(store.talk(7).map((m) => m.role), ["user", "assistant"]);
  await agent.reply(7, "А двушек?");
  assert.ok(llm.seen[2]!.some((m) => m.role === "user" && m.content === "Сколько однушек в Гомеле?"));
});

test("agent: подборка и живой риелтор — действия для бота", async () => {
  const store = new Store(":memory:");
  const llm = new ScriptedLLM([
    {
      content: null,
      tool_calls: [
        { name: "show_listings", args: { deal: "rent", type: "flat", region: "Минская область", price_max_usd: 500 } },
        { name: "contact_realtor", args: {} },
      ],
    },
    { content: "Отправляю варианты, и риелтор свяжется с вами." },
  ]);
  const r = await new Agent(llm, new Realty(new FakeBrowser(() => done()), store), store, "3.0").reply(1, "Покажи и позови риелтора");
  assert.equal(r.search?.deal, "rent");
  assert.equal(r.search?.city, "Минская область");
  assert.deepEqual(r.search?.place?.address, { stateRegionUuid: "499f06b8-7b00-11eb-8943-0cc47adabd66" });
  assert.equal(r.search?.priceMaxUsd, 500);
  assert.equal(r.contact, true);
});

test("agent: без браузера честно говорит, что живых цифр нет", async () => {
  const browser = new FakeBrowser(() => done());
  browser.connected = false;
  const store = new Store(":memory:");
  const llm = new ScriptedLLM([
    { content: null, tool_calls: [{ name: "count_listings", args: { deal: "sale", type: "house" } }] },
    { content: "Сейчас не могу посмотреть точные цифры." },
  ]);
  await new Agent(llm, new Realty(browser, store), store, "3.0").reply(1, "Сколько домов продаётся?");
  assert.match(llm.seen[1]!.at(-1)!.content as string, /не в сети/);
  assert.equal(browser.calls.length, 0);
});

test("looksLikeQuestion и agentHtml", () => {
  assert.ok(looksLikeQuestion("сколько однушек в гомеле"));
  assert.ok(looksLikeQuestion("А какие новостройки есть?"));
  assert.ok(!looksLikeQuestion("2"));
  assert.ok(!looksLikeQuestion("до 60 тысяч"));
  assert.equal(agentHtml("**112** квартир <дёшево>"), "<b>112</b> квартир &lt;дёшево&gt;");
  // не Минск и не квартира — к собеседнику, обычные ответы — правилам
  assert.ok(needsAgent("двушка в Гомеле до 40 тысяч"));
  assert.ok(needsAgent("хочу дом под Минском"));
  assert.ok(needsAgent("участок 10 соток"));
  assert.ok(!needsAgent("куплю двушку в Минске до 80 тыс"));
  assert.ok(!needsAgent("однушка, не первый этаж"));
  assert.ok(!needsAgent("Уручье"));
});

test("retryDelayMs: заголовок и текст ошибки Groq", () => {
  assert.equal(retryDelayMs(new Headers({ "retry-after": "3" }), "", 0), 3000);
  assert.equal(retryDelayMs(new Headers(), "Please try again in 7.5s.", 0), 7500);
  assert.equal(retryDelayMs(new Headers(), "try again in 1m2.5s", 0), 62500);
  assert.equal(retryDelayMs(new Headers(), "oops", 2), 4000);
});

test("bridge.probe: запрос уходит в расширение и ответ возвращается", async () => {
  const store = new Store(":memory:");
  const bridge = new ExtensionBridge(store, async () => {});
  const port = 19765 + Math.floor(Math.random() * 1000);
  bridge.listen("127.0.0.1", port, "secret");
  const ws = new WebSocket(`ws://127.0.0.1:${port}?token=secret`);
  ws.on("message", (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.type === "probe") ws.send(JSON.stringify({ type: "probe_result", id: msg.id, result: done({ totalCount: 5 }) }));
  });
  await new Promise((r) => ws.once("open", r));
  await new Promise((r) => setTimeout(r, 50));
  const r = await bridge.probe({ urls: ["https://realt.by/sale/flats/"], maxPages: 1, listPath: "/sale/flats/" });
  assert.equal(r.status === "done" && r.totalCount, 5);
  ws.close();
  bridge.close();
  // без браузера — сразу ошибка, без ожидания
  assert.equal((await new ExtensionBridge(store, async () => {}).probe({ urls: [], maxPages: 1, listPath: "/" })).status, "failed");
});

test("wantsAgent: после ответа собеседника уточнения идут ему, анкета и контакты — правилам", async () => {
  const { wantsAgent, onText } = await import("./dialogue.ts");
  const rules = (d: object, step: Parameters<typeof wantsAgent>[1], text: string) =>
    wantsAgent(d, step, onText(d, step, text, 3, null).reply, text);
  // «в районе 50000 долларов» правила поняли бы как бюджет квартиры в Минске — но разговор ведёт собеседник
  assert.ok(rules({ talking: true }, null, "в районе 50000 долларов"));
  assert.ok(!rules({}, null, "куплю двушку в Минске до 80 тыс"));
  assert.ok(rules({}, "mode", "сколько однушек в гомеле"));
  assert.ok(!rules({ talking: true }, "c_phone", "+375291112233"));
});

test("подборка после разговора — в том же городе", async () => {
  const { fromParams, toParams } = await import("./dialogue.ts");
  const store = new Store(":memory:");
  const realty = new Realty(new FakeBrowser(() => done()), store);
  const q = await realty.toParams({ deal: "sale", type: "flat", town: "Гомель", rooms: [1] });
  // клиент нажал «Изменить бюджет» или выбрал бюджет кнопкой — параметры поиска остаются гомельскими
  const params = toParams({ ...fromParams(q), budget: { min: null, max: 50000 } });
  assert.equal(params.city, "Гомель");
  assert.deepEqual(params.place, q.place);
  assert.deepEqual(params.rooms, [1]);
  assert.equal(params.priceMaxUsd, 50000);
});

test("topStreets: улицы из адресов объявлений", () => {
  const items = [
    listing(1, { address: "Борисов Гагарина ул. 12", town: "Борисов" }),
    listing(2, { address: "Борисов Гагарина ул. 40 2", town: "Борисов" }),
    listing(3, { address: "Борисов Строителей ул. 5", town: "Борисов" }),
    listing(4, { address: "Гомель Речицкий просп. 8 Б" }),
  ];
  assert.deepEqual(topStreets(items, 2), [
    { street: "Гагарина ул.", count: 2 },
    { street: "Строителей ул.", count: 1 },
  ]);
  assert.equal(topStreets([listing(4, { address: "Гомель Речицкий просп. 8 Б", town: "Гомель" })])[0]!.street, "Речицкий просп.");
});

test("справочник районов: падежи, Минск подробно, у Борисова районов нет", async () => {
  const { townAreas, areaPageUrls } = await import("./areas.ts");
  const minsk = townAreas("в Минске")!;
  assert.equal(minsk.town, "Минск");
  assert.equal(minsk.districts.length, 9);
  assert.ok(minsk.districts.some((d) => d.micro.includes("Уручье")));
  assert.deepEqual(townAreas("Гомеле")!.districts.map((d) => d.name).sort(), [
    "Железнодорожный район", "Новобелицкий район", "Советский район", "Центральный район",
  ]);
  assert.equal(townAreas("Борисов")!.districts.length, 0);
  assert.equal(townAreas("Неведомск"), null);

  const base = "https://realt.by/sale/flats/minsk/";
  assert.deepEqual(areaPageUrls(base, "Октябрьский район"), ["https://realt.by/sale/flats/minsk/oktjabrskij-rajon/"]);
  assert.equal(areaPageUrls(base, "Минск Мир (Minsk World)")[0], "https://realt.by/sale/flats/minsk/minsk-mir-mk-r-n/");
  // realt.by обрезает адрес до 50 символов
  assert.equal(
    areaPageUrls(base, "Пушкина-Глебки-Притыцкого-Ольшевского-Кальварийская")[0],
    "https://realt.by/sale/flats/minsk/pushkina-glebki-prityckogo-olshevskogo-kalvarijska/",
  );
});

test("count по району: страница района — точно, нет страницы — по упоминанию", async () => {
  const browser = new FakeBrowser((p) => {
    const url = p.urls[0]!;
    if (url.endsWith("/uruche-mk-r-n/")) return done({ geoTitle: "Уручье", address: { townSubDistrictUuid: "uru" } });
    if (url.endsWith("/sale/flats/borisov/")) return done({ geoTitle: "г. Борисов", address: { townUuid: "bor" } });
    if (url.includes("/pechi")) return { status: "notfound" };
    return done({ totalCount: 40, scanned: 40, matched: 3 });
  });
  const realty = new Realty(browser, new Store(":memory:"));
  const uru = await realty.toParams({ deal: "sale", type: "flat", town: "Минск", area: "Уручье" });
  assert.deepEqual(uru.place?.address, { townSubDistrictUuid: "uru" });
  assert.equal(uru.city, "Минск, Уручье");
  assert.deepEqual(uru.keywords, []);

  const pechi = await realty.count({ deal: "sale", type: "flat", town: "Борисов", region: "Минская область", area: "Печи" });
  assert.equal(pechi.count, 3);
  assert.match(pechi.areaBy!, /упоминанию/);
  // страницы района ищем один раз — неудача тоже запоминается
  const before = browser.calls.length;
  await realty.toParams({ deal: "sale", type: "flat", town: "Борисов", region: "Минская область", area: "Печи" });
  assert.equal(browser.calls.filter((c) => c.urls[0]!.includes("/pechi")).length, 1);
  assert.ok(browser.calls.length >= before);
});

test("deliver: район/улица ничего не дали — снимаем условие и ищем снова", async () => {
  const { deliver } = await import("./delivery.ts");
  const store = new Store(":memory:");
  const params = {
    deal: "sale" as const, city: "Борисов", rooms: [1], priceMinUsd: null, priceMaxUsd: 68000, areaMin: null,
    notFirstFloor: false, notLastFloor: false, keywords: ["Днепровская"],
  };
  const searchId = store.addSearch(5, "x", params);
  const task = store.addTask({ id: searchId, chat_id: 5 }, { site: "realt", params, maxPages: 3 }, false);
  const sent: string[] = [];
  const api = { sendMessage: async (_c: number, text: string) => void sent.push(text) } as never;
  const research: Array<typeof params> = [];
  await deliver(api, store, task, { status: "done", items: [], scanned: 60 }, { research: (_c, p) => void research.push(p as typeof params) });
  assert.match(sent[0]!, /С условием «Днепровская» подходящих нет среди 60 объявлений/);
  assert.deepEqual(research[0]!.keywords, []);
  assert.equal(research[0]!.priceMaxUsd, 68000);
});
