import { DEALS, PROPERTY_TYPES, type SearchParams } from "@realt-agent/shared";
import type { ChatMessage, LLM, Tool, ToolCall } from "./llm.ts";
import { townAreas } from "./areas.ts";
import { RealtyError, type MarketQuery, type Realty } from "./realty.ts";

/**
 * Собеседник: отвечает на любые вопросы о недвижимости по всей Беларуси.
 * Модель сама решает, что узнать на realt.by (сколько объявлений, какие новостройки),
 * и может запустить подборку с карточками или позвать живого риелтора.
 */

export interface History {
  talk(chatId: number, limit?: number): Array<{ role: "user" | "assistant"; content: string }>;
  addTalk(chatId: number, role: "user" | "assistant", content: string): void;
}

export interface AgentReply {
  text: string;
  /** Отправить клиенту подборку карточками (как обычный поиск). */
  search?: SearchParams;
  /** Клиент хочет живого риелтора — начать сбор контактов. */
  contact?: boolean;
  /** О чём шла речь (город, тип, комнаты) — чтобы кнопки и подборка продолжали с того же места. */
  query?: SearchParams;
}

const MAX_TOOL_ROUNDS = 5;

const PROMPT = `Ты — опытный риелтор-консультант в Telegram. Помогаешь людям с недвижимостью по всей Беларуси: квартиры, комнаты, дома, дачи, участки, коммерция, новостройки, продажа и аренда.

Как ты разговариваешь:
- Как живой человек в мессенджере: коротко, по делу, дружелюбно, на «вы». Обычно 1–4 предложения. Без таблиц и заголовков; короткий список — только если перечисляешь варианты.
- Не больше одного вопроса за ответ. Сначала ответь на то, что спросили, потом можно один уточняющий вопрос, который поможет подобрать.
- Держи нить разговора. Короткое уточнение («а в районе 50 000», «а двушки?», «а снять?») — продолжение прошлого запроса: сохрани город, тип, комнаты и сделку из прошлых сообщений, поменяй только то, что клиент уточнил. Не переспрашивай то, что уже известно.
- После цифры предложи следующий шаг по делу: показать варианты, сузить по цене или району. Если вариантов немного (до ~30) или клиент назвал бюджет — предложи сразу прислать подборку.
- Не придумывай цифры, цены и объекты. Всё про количество, цены и конкретные варианты узнавай инструментами — это живые данные realt.by. Называй источник просто: «сейчас на realt.by».
- Если оценка неточная (exact: false) — говори «около», «примерно».
- Общие вопросы (как проходит сделка, что проверить перед покупкой, ипотека, районы города) объясняй сам, кратко и без юридических гарантий; сложное — предложи обсудить с риелтором.
- Контакты продавцов и агентов не называй. Ссылки на объявления давать можно.
- Когда человек готов смотреть варианты — вызови show_listings: подборка с фото придёт отдельными сообщениями.
- Когда нужна помощь человека (просмотр, торг, сделка, подбор под ключ) — предложи живого риелтора; если человек согласен — вызови contact_realtor.

Про места:
- town — город или посёлок в именительном падеже («Гомель», «Мозырь», «Боровляны»), region — область («Гомельская область»), если знаешь её. Для вопроса про всю область — только region. Про всю страну — ни town, ни region.
- Район или микрорайон города передавай в area («Октябрьский район», «Уручье», «Печи»): бот найдёт его страницу на realt.by и посчитает точно, а если такой страницы нет — поищет по упоминанию в объявлениях (в ответе будет areaBy).
- Про районы и микрорайоны города сначала вызови town_areas — это справочник агентства. НЕ называй по памяти районы, микрорайоны, улицы, ЖК, школы и другие подробности городов — особенно небольших: легко ошибиться. Ещё опора — streets из count_listings: улицы, где сейчас больше всего объявлений. Если данных нет — честно скажи, что не хочешь ошибиться с названиями, и спроси, какой район интересует клиента.
- Название района от клиента принимай как есть (он знает свой город лучше) и ищи по нему через area; если ничего не нашлось — так и скажи.

Про параметры:
- Цены в долларах США. Если человек назвал рубли — пересчитай примерно по курсу 1 $ ≈ {RATE} BYN.
- rooms — список комнат: [1] — однушка, [2, 3] — двушка или трёшка, [4, 5] — «4 и больше». Комнаты — только для квартир, комнат и новостроек.
- «Новостройки», «ЖК», «от застройщика» — инструмент new_buildings.`;

const where = {
  town: { type: "string", description: "Город/посёлок в именительном падеже; пусто — вся область или страна" },
  region: { type: "string", description: "Область, например «Гомельская область»" },
};

const market = {
  deal: { type: "string", enum: [...DEALS], description: "sale — купить, rent — снять надолго, rent_day — на сутки" },
  type: {
    type: "string",
    enum: PROPERTY_TYPES.filter((t) => t !== "newbuild"),
    description: "flat квартира, room комната, house дом/коттедж, dacha дача, plot участок, office, shop, warehouse, business",
  },
  ...where,
  area: { type: "string", description: "Район или микрорайон города, если клиент его назвал" },
  rooms: { type: "array", items: { type: "integer", minimum: 1, maximum: 5 } },
  price_min_usd: { type: "number" },
  price_max_usd: { type: "number" },
  area_min: { type: "number", description: "м²; для участков — сотки" },
  not_first_floor: { type: "boolean" },
  not_last_floor: { type: "boolean" },
  keywords: { type: "array", items: { type: "string" }, description: "Район, микрорайон, улица, «ремонт»" },
};

export const TOOLS: Tool[] = [
  {
    type: "function",
    function: {
      name: "count_listings",
      description:
        "Сколько сейчас объявлений на realt.by по условиям, минимальная и типичная цена, пара примеров. " +
        "Для вопросов «сколько», «есть ли», «почём», «какие цены».",
      parameters: { type: "object", properties: market, required: ["deal", "type"] },
    },
  },
  {
    type: "function",
    function: {
      name: "new_buildings",
      description: "Новостройки и жилые комплексы от застройщиков: названия, адреса, срок сдачи, цена за м², ссылки.",
      parameters: { type: "object", properties: where },
    },
  },
  {
    type: "function",
    function: {
      name: "town_areas",
      description:
        "Справочник агентства: районы, микрорайоны и улицы города. Вызывай, когда спрашивают про районы " +
        "или нужно предложить, где искать. Подробно размечен Минск; по другим городам может быть мало данных.",
      parameters: { type: "object", properties: { town: where.town }, required: ["town"] },
    },
  },
  {
    type: "function",
    function: {
      name: "show_listings",
      description: "Прислать клиенту подборку объявлений с фото и ссылками (несколько отдельных сообщений).",
      parameters: { type: "object", properties: market, required: ["deal", "type"] },
    },
  },
  {
    type: "function",
    function: {
      name: "contact_realtor",
      description: "Клиент согласен, чтобы с ним связался живой риелтор: начать сбор имени и телефона.",
      parameters: { type: "object", properties: {} },
    },
  },
];

function toQuery(a: Record<string, unknown>): MarketQuery {
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  return {
    deal: (DEALS as readonly string[]).includes(a.deal as string) ? (a.deal as MarketQuery["deal"]) : "sale",
    type: (PROPERTY_TYPES as readonly string[]).includes(a.type as string) ? (a.type as MarketQuery["type"]) : "flat",
    town: str(a.town),
    region: str(a.region),
    area: str(a.area),
    rooms: Array.isArray(a.rooms) ? a.rooms.map(Number).filter(Number.isInteger) : [],
    priceMinUsd: num(a.price_min_usd),
    priceMaxUsd: num(a.price_max_usd),
    areaMin: num(a.area_min),
    notFirstFloor: a.not_first_floor === true,
    notLastFloor: a.not_last_floor === true,
    keywords: Array.isArray(a.keywords) ? a.keywords.map(String).filter(Boolean).slice(0, 3) : [],
  };
}

export class Agent {
  constructor(
    private llm: LLM,
    private realty: Realty,
    private history: History,
    private usdBynRate: string,
  ) {}

  /** context — что клиент уже выбрал кнопками (если выбирал). */
  async reply(chatId: number, text: string, context = ""): Promise<AgentReply> {
    const system = PROMPT.replace("{RATE}", this.usdBynRate) + (context ? `\n\nКлиент уже выбрал кнопками: ${context}.` : "");
    const messages: ChatMessage[] = [
      { role: "system", content: system },
      ...this.history.talk(chatId),
      { role: "user", content: text },
    ];
    const out: AgentReply = { text: "" };

    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      // На последнем круге инструменты не даём — пусть отвечает тем, что уже узнал
      const msg = await this.llm.chat(messages, round < MAX_TOOL_ROUNDS ? TOOLS : undefined);
      const calls = msg.tool_calls ?? [];
      if (!calls.length) {
        out.text = (msg.content ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
        break;
      }
      messages.push({ role: "assistant", content: msg.content ?? null, tool_calls: calls });
      for (const call of calls) {
        messages.push({ role: "tool", tool_call_id: call.id, content: await this.runTool(call, out) });
      }
    }

    if (!out.text) out.text = out.search ? "Собираю подборку — пришлю через минуту ⏳" : "Секунду, уточню 🙂";
    this.history.addTalk(chatId, "user", text);
    this.history.addTalk(chatId, "assistant", out.text);
    return out;
  }

  private async runTool(call: ToolCall, out: AgentReply): Promise<string> {
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(call.function.arguments || "{}");
    } catch {
      /* пустые аргументы */
    }
    try {
      switch (call.function.name) {
        case "count_listings":
          if (!this.realty.online) return offline;
          out.query = await this.realty.toParams(toQuery(args));
          return JSON.stringify(await this.realty.countFor(out.query));
        case "new_buildings":
          if (!this.realty.online) return offline;
          return JSON.stringify(
            await this.realty.newBuildings(toQuery(args).town, toQuery(args).region),
          );
        case "town_areas": {
          const town = String(args.town ?? "");
          const found = townAreas(town);
          if (!found || (!found.districts.length && !found.streets.length)) {
            return `В справочнике нет районов для «${town}». Не называй районы по памяти — спроси клиента, какой район или улица ему нужны.`;
          }
          return JSON.stringify({
            ...found,
            note: found.districts.length
              ? "Названия микрорайонов — как в базе агентства. Улицы — где было больше всего объявлений."
              : "Районов в справочнике нет, только улицы, где было больше всего объявлений. Районы по памяти не называй.",
          });
        }
        case "show_listings":
          out.search = out.query = await this.realty.toParams(toQuery(args));
          return this.realty.online
            ? "Подборка запущена: карточки с фото придут клиенту отдельными сообщениями примерно через минуту."
            : "Подборка поставлена в очередь, но браузер с realt.by сейчас не в сети — карточки придут, как только он подключится.";
        case "contact_realtor":
          out.contact = true;
          return "Сейчас бот спросит у клиента имя и телефон. Коротко поблагодари и скажи, что риелтор свяжется.";
        default:
          return `Нет инструмента ${call.function.name}`;
      }
    } catch (e) {
      if (e instanceof RealtyError) return `Не получилось: ${e.message}`;
      console.error("[agent]", call.function.name, e);
      return "Не получилось узнать на realt.by. Извинись и предложи попробовать чуть позже.";
    }
  }
}

const offline =
  "Браузер с realt.by сейчас не в сети, живых цифр нет. Честно скажи об этом, ответь из общих знаний без конкретных чисел и предложи спросить чуть позже.";
