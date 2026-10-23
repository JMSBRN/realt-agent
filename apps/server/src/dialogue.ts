import type { SearchParams } from "@realt-agent/shared";
import { ANY, extract, findBudget, normalize } from "./extract.ts";
import { describeParams } from "./format.ts";

/**
 * Диалог «как у риелтора»: бот по очереди уточняет параметры, но понимает и всё
 * сразу одной фразой. Как только известна вилка бюджета — ищет, не задавая
 * оставшихся необязательных вопросов. Логика чистая (без Telegram) — её легко тестировать.
 */

type Deal = SearchParams["deal"];

export type Step = "deal" | "rooms" | "budget" | "area" | "floor" | "district";
const ORDER: Step[] = ["deal", "rooms", "budget", "area", "floor", "district"];

/** undefined — ещё не спрашивали; null / [] / false — «не важно». */
export interface Draft {
  deal?: Deal;
  rooms?: number[];
  budget?: { min: number | null; max: number | null };
  areaMin?: number | null;
  floor?: { notFirst: boolean; notLast: boolean };
  district?: string | null;
}

export interface Button {
  text: string;
  data: string;
}

export interface Reply {
  text: string;
  buttons?: Button[][];
  /** Если задано — пора искать с этими параметрами. */
  search?: SearchParams;
  /** Какой вопрос ждёт ответа (null — диалог завершён). */
  step: Step | null;
}

const FIELD: Record<Step, keyof Draft> = {
  deal: "deal",
  rooms: "rooms",
  budget: "budget",
  area: "areaMin",
  floor: "floor",
  district: "district",
};

const usd = (n: number) => "$" + Math.round(n).toLocaleString("ru-RU").replace(/[\s ,]/g, " ");

export function nextStep(d: Draft): Step | null {
  return ORDER.find((s) => d[FIELD[s]] === undefined) ?? null;
}

export function hasRange(d: Draft): boolean {
  return d.budget?.min != null && d.budget?.max != null;
}

export function toParams(d: Draft): SearchParams {
  return {
    deal: d.deal ?? "sale",
    city: "Минск",
    rooms: d.rooms ?? [],
    priceMinUsd: d.budget?.min ?? null,
    priceMaxUsd: d.budget?.max ?? null,
    areaMin: d.areaMin ?? null,
    notFirstFloor: d.floor?.notFirst ?? false,
    notLastFloor: d.floor?.notLast ?? false,
    keywords: d.district ? [d.district] : [],
  };
}

/** Черновик из прошлого поиска — все вопросы считаются отвеченными. */
export function fromParams(p: SearchParams): Draft {
  return {
    deal: p.deal,
    rooms: p.rooms,
    budget: { min: p.priceMinUsd, max: p.priceMaxUsd },
    areaMin: p.areaMin,
    floor: { notFirst: p.notFirstFloor, notLast: p.notLastFloor },
    district: p.keywords[0] ?? null,
  };
}

// ---------- вопросы ----------

const row = (...buttons: Array<[string, string]>): Button[] => buttons.map(([text, data]) => ({ text, data }));

export function question(step: Step, d: Draft): Pick<Reply, "text" | "buttons"> {
  switch (step) {
    case "deal":
      return {
        text: "Вы хотите купить квартиру или снять?",
        buttons: [row(["🏠 Купить", "d:deal:sale"], ["🔑 Снять", "d:deal:rent"])],
      };
    case "rooms":
      return {
        text: "Сколько комнат рассматриваете?",
        buttons: [
          row(["1", "d:rooms:1"], ["2", "d:rooms:2"], ["3", "d:rooms:3"], ["4+", "d:rooms:4+"]),
          row(["Не важно", "d:rooms:any"]),
        ],
      };
    case "budget":
      return d.deal === "rent"
        ? {
            text: "На какую сумму в месяц рассчитываете? Можно вилкой — например «от 400 до 600 $».",
            buttons: [
              row(["до $400", "d:budget:-400"], ["$400–700", "d:budget:400-700"]),
              row(["$700–1000", "d:budget:700-1000"], ["от $1000", "d:budget:1000-"]),
              row(["Не важно", "d:budget:any"]),
            ],
          }
        : {
            text: "Какой бюджет? Удобнее всего вилкой — например «от 60 до 80 тыс $».",
            buttons: [
              row(["до $60 тыс", "d:budget:-60000"], ["$60–90 тыс", "d:budget:60000-90000"]),
              row(["$90–130 тыс", "d:budget:90000-130000"], ["от $130 тыс", "d:budget:130000-"]),
              row(["Не важно", "d:budget:any"]),
            ],
          };
    case "area":
      return {
        text: "Есть пожелания по площади?",
        buttons: [row(["от 30 м²", "d:area:30"], ["от 45 м²", "d:area:45"], ["от 60 м²", "d:area:60"]), row(["Не важно", "d:area:any"])],
      };
    case "floor":
      return {
        text: "По этажу что-то исключаем?",
        buttons: [
          row(["Не первый", "d:floor:nf"], ["Не последний", "d:floor:nl"]),
          row(["Ни первый, ни последний", "d:floor:both"]),
          row(["Не важно", "d:floor:any"]),
        ],
      };
    case "district":
      return {
        text: "И последнее: район, улица или метро — есть предпочтения? Напишите, например, «Уручье».",
        buttons: [row(["Любой район", "d:district:any"])],
      };
  }
}

export function greeting(): Reply {
  const q = question("deal", {});
  return {
    ...q,
    text:
      "Здравствуйте! Я помогу подобрать квартиру в Минске на realt.by 🏠\n" +
      "Можно сразу одной фразой — например «куплю двушку от 60 до 80 тыс $», — а можно по шагам.\n\n" +
      q.text,
    step: "deal",
  };
}

// ---------- подтверждения ----------

function ack(field: keyof Draft, d: Draft): string {
  switch (field) {
    case "deal":
      return d.deal === "sale" ? "Покупка — понял." : "Аренда — понял.";
    case "rooms":
      return d.rooms?.length ? `Комнат: ${d.rooms.join(" или ")}.` : "Количество комнат не важно.";
    case "budget": {
      const { min, max } = d.budget!;
      if (min != null && max != null) return `Бюджет: ${usd(min)} – ${usd(max)}.`;
      if (max != null) return `Бюджет: до ${usd(max)}.`;
      if (min != null) return `Бюджет: от ${usd(min)}.`;
      return "Бюджет не ограничиваем.";
    }
    case "areaMin":
      return d.areaMin != null ? `Площадь от ${d.areaMin} м².` : "Площадь не важна.";
    case "floor": {
      const { notFirst, notLast } = d.floor!;
      if (notFirst && notLast) return "Ни первый, ни последний этаж.";
      if (notFirst) return "Не первый этаж.";
      if (notLast) return "Не последний этаж.";
      return "Этаж любой.";
    }
    case "district":
      return d.district ? `Район: ${d.district}.` : "Район любой.";
  }
}

/** Следующий шаг: либо вопрос, либо поиск (если известна вилка бюджета или всё уже спросили). */
export function advance(d: Draft, acks: string[]): Reply {
  const prefix = acks.length ? acks.join(" ") + "\n\n" : "";
  const step = nextStep(d);
  if (d.deal && (hasRange(d) || step === null)) {
    const params = toParams(d);
    return {
      text: `${prefix}Итак, ищу: ${describeParams(params)}.\nСмотрю realt.by — это займёт около минуты ⏳`,
      search: params,
      step: null,
    };
  }
  return { ...question(step!, d), text: prefix + question(step!, d).text, step };
}

// ---------- ответы ----------

function merge(d: Draft, text: string, rate: number): { draft: Draft; acks: string[] } {
  const e = extract(text, rate, d.deal);
  const draft = { ...d };
  const changed: Array<keyof Draft> = [];
  if (e.deal) (draft.deal = e.deal), changed.push("deal");
  if (e.rooms) (draft.rooms = e.rooms), changed.push("rooms");
  if (e.priceMinUsd != null || e.priceMaxUsd != null) {
    draft.budget = { min: e.priceMinUsd ?? null, max: e.priceMaxUsd ?? null };
    changed.push("budget");
  }
  if (e.areaMin != null) (draft.areaMin = e.areaMin), changed.push("areaMin");
  if (e.notFirstFloor || e.notLastFloor) {
    draft.floor = { notFirst: !!e.notFirstFloor, notLast: !!e.notLastFloor };
    changed.push("floor");
  }
  return { draft, acks: changed.map((f) => ack(f, draft)) };
}

/** Ответ на конкретный вопрос, если общий разбор его не понял («2», «не важно», «Уручье»). */
function answerStep(d: Draft, step: Step, raw: string, rate: number): Draft | null {
  const t = normalize(raw);
  const any = ANY.test(t);
  switch (step) {
    case "deal":
      return null;
    case "rooms": {
      if (any) return { ...d, rooms: [] };
      const nums = [...t.matchAll(/[1-5]/g)].map((m) => Number(m[0]));
      if (!nums.length) return null;
      const rooms = /[-–]/.test(t) && nums.length === 2 ? range(nums[0]!, nums[1]!) : nums;
      if (/\+|больше|более/.test(t)) for (let n = Math.max(...nums); n <= 5; n++) rooms.push(n);
      return { ...d, rooms: [...new Set(rooms)].sort() };
    }
    case "budget": {
      if (any) return { ...d, budget: { min: null, max: null } };
      const b = findBudget(t, rate, d.deal, false);
      return b ? { ...d, budget: b } : null;
    }
    case "area": {
      if (any) return { ...d, areaMin: null };
      const n = t.match(/\d+(?:[.,]\d+)?/);
      return n ? { ...d, areaMin: Number(n[0].replace(",", ".")) } : null;
    }
    case "floor": {
      if (any || /^нет/.test(t)) return { ...d, floor: { notFirst: false, notLast: false } };
      const first = /перв/.test(t);
      const last = /последн/.test(t);
      return first || last ? { ...d, floor: { notFirst: first, notLast: last } } : null;
    }
    case "district": {
      if (any || /^нет/.test(t)) return { ...d, district: null };
      const name = raw.trim().replace(/^(в|на|у|около|возле|рядом с)\s+/i, "");
      return name.length >= 2 && name.length <= 40 ? { ...d, district: name } : null;
    }
  }
}

function range(a: number, b: number): number[] {
  const out = [];
  for (let n = Math.min(a, b); n <= Math.max(a, b); n++) out.push(n);
  return out;
}

/**
 * Текстовое сообщение клиента.
 * step — вопрос, на который ждём ответа (null — диалога нет);
 * last — параметры прошлого поиска: «а до 90 тысяч?» после выдачи уточняет его.
 */
export function onText(
  d: Draft,
  step: Step | null,
  text: string,
  rate: number,
  last: SearchParams | null,
): { draft: Draft; reply: Reply } {
  const { deal: newDeal } = extract(text, rate);

  // Вне диалога: новая сделка — новый поиск, иначе уточняем прошлый
  let base = d;
  if (step === null) base = !newDeal && last ? fromParams(last) : {};

  const { draft, acks } = merge(base, text, rate);
  let result = draft;

  if (step !== null && draft[FIELD[step]] === undefined) {
    const answered = answerStep(draft, step, text, rate);
    if (answered) {
      result = answered;
      acks.push(ack(FIELD[step], answered));
    }
  }

  if (!acks.length) {
    // Ничего не поняли: в диалоге переспрашиваем, вне диалога начинаем знакомство заново
    if (step === null) return { draft: {}, reply: greeting() };
    const q = question(step, result);
    return { draft: result, reply: { ...q, text: "Не совсем понял 🙂 " + q.text, step } };
  }
  return { draft: result, reply: advance(result, acks) };
}

/** Нажатие кнопки ответа (data вида «d:budget:60000-90000»). */
export function onChoice(d: Draft, data: string): { draft: Draft; reply: Reply } | null {
  const [, key, value] = data.split(":");
  const draft = { ...d };
  const any = value === "any";
  switch (key) {
    case "deal":
      if (value !== "sale" && value !== "rent") return null;
      draft.deal = value;
      break;
    case "rooms":
      draft.rooms = any ? [] : value === "4+" ? [4, 5] : [Number(value)];
      break;
    case "budget": {
      const [min, max] = (value ?? "").split("-");
      draft.budget = any ? { min: null, max: null } : { min: min ? Number(min) : null, max: max ? Number(max) : null };
      break;
    }
    case "area":
      draft.areaMin = any ? null : Number(value);
      break;
    case "floor":
      draft.floor = { notFirst: value === "nf" || value === "both", notLast: value === "nl" || value === "both" };
      break;
    case "district":
      draft.district = null;
      break;
    default:
      return null;
  }
  const field = key === "area" ? "areaMin" : (key as keyof Draft);
  return { draft, reply: advance(draft, [ack(field, draft)]) };
}
