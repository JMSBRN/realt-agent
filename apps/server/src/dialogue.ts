import type { SearchParams } from "@realt-agent/shared";
import { ANY, extract, findBudget, normalize } from "./extract.ts";
import { describeParams } from "./format.ts";
import {
  CALL_TIMES,
  CONTACT_KEYS,
  PROFILE_QUESTIONS,
  normalizeEmail,
  normalizePhone,
  type Contact,
  type ContactKey,
  type ProfileKey,
} from "./survey.ts";

/**
 * Диалог «как у риелтора». Два режима:
 *  - быстрый: параметры поиска; как только известна вилка бюджета — сразу ищем;
 *  - подробный: параметры + вопросы риелтора (семья, дети, животные, ремонт…) + контакты → лид.
 * Логика чистая (без Telegram) — её легко тестировать.
 */

type Deal = SearchParams["deal"];

type CoreStep = "deal" | "rooms" | "budget" | "area" | "floor" | "district";
type ProfileStep = `p_${ProfileKey}`;
type ContactStep = `c_${ContactKey}`;
export type Step = "mode" | CoreStep | ProfileStep | ContactStep;

const CORE: CoreStep[] = ["deal", "rooms", "budget", "area", "floor", "district"];

/** undefined — ещё не спрашивали; null / [] / "" — «не важно» или «пропустить». */
export interface Draft {
  mode?: "quick" | "detailed";
  deal?: Deal;
  rooms?: number[];
  budget?: { min: number | null; max: number | null };
  areaMin?: number | null;
  floor?: { notFirst: boolean; notLast: boolean };
  district?: string | null;
  profile?: Partial<Record<ProfileKey, string>>;
  contact?: Partial<Contact>;
  /** Анкета запущена кнопкой «Связаться с риелтором» — спрашиваем только контакты. */
  contactOnly?: boolean;
  /** Имя из профиля Telegram — подсказка на вопрос «как к вам обращаться». */
  tgName?: string;
}

export interface Button {
  text: string;
  data: string;
}

export interface Reply {
  text: string;
  buttons?: Button[][];
  /** Пора искать с этими параметрами. */
  search?: SearchParams;
  /** Анкета заполнена — сохранить лид. */
  lead?: boolean;
  /** Показать кнопку «Поделиться номером» (обычная клавиатура Telegram). */
  contactRequest?: boolean;
  /** Убрать клавиатуру «Поделиться номером» после ответа. */
  removeKeyboard?: boolean;
  /** Какой вопрос ждёт ответа (null — диалог завершён). */
  step: Step | null;
}

const CORE_FIELD: Record<CoreStep, keyof Draft> = {
  deal: "deal",
  rooms: "rooms",
  budget: "budget",
  area: "areaMin",
  floor: "floor",
  district: "district",
};

const usd = (n: number) => "$" + Math.round(n).toLocaleString("ru-RU").replace(/[\s ,]/g, " ");
const isCore = (s: Step): s is CoreStep => (CORE as string[]).includes(s);
const profileQuestion = (s: Step) => (s.startsWith("p_") ? PROFILE_QUESTIONS.find((q) => `p_${q.key}` === s) : undefined);

// ---------- порядок вопросов ----------

function contactSteps(d: Draft): ContactStep[] {
  if (d.contact?.consent === false) return [];
  return CONTACT_KEYS.filter((k) => d.contact?.[k] === undefined).map((k) => `c_${k}` as const);
}

export function nextStep(d: Draft): Step | null {
  if (d.contactOnly) return contactSteps(d)[0] ?? null;
  if (d.mode === undefined) return "mode";
  const core = CORE.find((s) => d[CORE_FIELD[s]] === undefined);
  if (core) return core;
  if (d.mode !== "detailed") return null;
  const profile = PROFILE_QUESTIONS.find(
    (q) => (q.applies?.(d.deal, d.profile ?? {}) ?? true) && d.profile?.[q.key] === undefined,
  );
  if (profile) return `p_${profile.key}`;
  return contactSteps(d)[0] ?? null;
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

/** Черновик из прошлого поиска — все вопросы о квартире считаются отвеченными. */
export function fromParams(p: SearchParams): Draft {
  return {
    mode: "quick",
    deal: p.deal,
    rooms: p.rooms,
    budget: { min: p.priceMinUsd, max: p.priceMaxUsd },
    areaMin: p.areaMin,
    floor: { notFirst: p.notFirstFloor, notLast: p.notLastFloor },
    district: p.keywords[0] ?? null,
  };
}

/** Начать сбор контактов после выдачи (кнопка «Связаться с риелтором»). */
export function startContact(last: SearchParams | null, tgName?: string): { draft: Draft; reply: Reply } {
  const draft: Draft = { ...(last ? fromParams(last) : {}), contactOnly: true, tgName };
  return { draft, reply: { ...question("c_consent", draft), step: "c_consent" } };
}

// ---------- вопросы ----------

const row = (...buttons: Array<[string, string]>): Button[] => buttons.map(([text, data]) => ({ text, data }));

/** Кнопки по две в ряд. */
function grid(buttons: Button[]): Button[][] {
  const rows: Button[][] = [];
  for (let i = 0; i < buttons.length; i += 2) rows.push(buttons.slice(i, i + 2));
  return rows;
}

export function question(step: Step, d: Draft): Pick<Reply, "text" | "buttons" | "contactRequest"> {
  const pq = profileQuestion(step);
  if (pq) {
    const options = pq.options(d.deal).map((text, i) => ({ text, data: `d:${step}:${i}` }));
    return {
      text: pq.text(d.deal),
      buttons: [...grid(options), row([pq.skip ?? "Пропустить", `d:${step}:skip`])],
    };
  }

  switch (step) {
    case "mode":
      return {
        text: "Как удобнее?",
        buttons: [
          row(["⚡ Быстрый поиск", "d:mode:quick"]),
          row(["🤝 Подробный подбор с риелтором", "d:mode:detailed"]),
        ],
      };
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
        text: "Район, улица или метро — есть предпочтения? Напишите, например, «Уручье».",
        buttons: [row(["Любой район", "d:district:any"])],
      };
    case "c_consent":
      return {
        text:
          (d.contactOnly ? "С удовольствием подключу живого риелтора 🙌\n" : "Картина ясна, спасибо 👍\n") +
          "Чтобы риелтор подобрал варианты и связался с вами, оставьте, пожалуйста, контакты.\n\n" +
          "Нажимая «Продолжить», вы соглашаетесь на обработку ваших персональных данных для подбора жилья.",
        buttons: [row(["✅ Продолжить", "d:c_consent:yes"], ["Не сейчас", "d:c_consent:no"])],
      };
    case "c_name":
      return {
        text: "Как к вам обращаться?",
        buttons: d.tgName ? [row([d.tgName, "d:c_name:tg"])] : undefined,
      };
    case "c_phone":
      return {
        text: "Ваш номер телефона? Нажмите «📱 Поделиться номером» внизу или напишите его, например +375 29 123-45-67.",
        contactRequest: true,
      };
    case "c_email":
      return {
        text: "Электронная почта — пришлём подборку и туда.",
        buttons: [row(["Пропустить", "d:c_email:skip"])],
      };
    case "c_social":
      return {
        text: "Где вам удобнее переписываться? Напишите Viber, WhatsApp, Instagram или ссылку на профиль.",
        buttons: [row(["Telegram — здесь", "d:c_social:tg"], ["Пропустить", "d:c_social:skip"])],
      };
    case "c_time":
      return {
        text: "Когда удобно принять звонок?",
        buttons: grid(CALL_TIMES.map((t, i) => ({ text: t, data: `d:c_time:${i}` }))),
      };
  }
  throw new Error(`unknown step ${step}`);
}

export function greeting(): Reply {
  const q = question("mode", {});
  return {
    ...q,
    text:
      "Здравствуйте! Я помогу подобрать квартиру в Минске на realt.by 🏠\n\n" +
      "⚡ Быстрый поиск — пара вопросов, и сразу варианты. Можно одной фразой: «куплю двушку от 60 до 80 тыс $».\n" +
      "🤝 Подробный подбор — расспрошу, как риелтор, о том, что вам важно, и передам заявку живому специалисту.\n\n" +
      q.text,
    step: "mode",
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
    default:
      return "";
  }
}

/** Следующий шаг: вопрос, поиск или завершение анкеты. */
export function advance(d: Draft, acks: string[], prev: Step | null = null): Reply {
  const prefix = acks.filter(Boolean).length ? acks.filter(Boolean).join(" ") + "\n\n" : "";
  const step = nextStep(d);
  const removeKeyboard = prev === "c_phone" && step !== "c_phone";

  // Быстрый режим: вилка бюджета — ищем сразу, без оставшихся вопросов
  if (d.mode !== "detailed" && !d.contactOnly && d.deal && (hasRange(d) || step === null)) {
    const params = toParams(d);
    return {
      text: `${prefix}Итак, ищу: ${describeParams(params)}.\nСмотрю realt.by — это займёт около минуты ⏳`,
      search: params,
      step: null,
    };
  }

  if (step === null) return finish(d, prefix, removeKeyboard);

  const q = question(step, d);
  return { ...q, text: prefix + q.text, step, removeKeyboard };
}

/** Анкета пройдена: благодарим, сохраняем лид (если дали согласие) и, в подробном режиме, ищем. */
function finish(d: Draft, prefix: string, removeKeyboard: boolean): Reply {
  const c = d.contact ?? {};
  const lead = c.consent === true;
  const thanks = lead
    ? `Спасибо${c.name ? ", " + c.name : ""}! Заявку передал риелтору — он свяжется с вами` +
      (c.time && c.time !== "В любое время" ? ` ${c.time.toLowerCase()}` : " в ближайшее время") +
      ".\n\n"
    : c.consent === false
      ? "Хорошо, без контактов. Если передумаете — нажмите «📞 Связаться с риелтором» после подборки.\n\n"
      : "";

  if (d.contactOnly) {
    return { text: prefix + (thanks || "Готово."), lead, step: null, removeKeyboard };
  }
  const params = toParams(d);
  return {
    text: `${prefix}${thanks}А пока посмотрю, что есть на realt.by: ${describeParams(params)} ⏳`,
    search: params,
    lead,
    step: null,
    removeKeyboard,
  };
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
  // Параметры одной фразой без выбора режима — это быстрый поиск
  if (changed.length && draft.mode === undefined) draft.mode = "quick";
  return { draft, acks: changed.map((f) => ack(f, draft)) };
}

const setProfile = (d: Draft, key: ProfileKey, value: string): Draft => ({ ...d, profile: { ...d.profile, [key]: value } });
const setContact = <K extends ContactKey>(d: Draft, key: K, value: Contact[K]): Draft => ({
  ...d,
  contact: { ...d.contact, [key]: value },
});

/**
 * Ответ текстом на конкретный вопрос. Возвращает черновик и подтверждение,
 * либо строку-подсказку, если ответ не подошёл (неверный телефон и т.п.).
 */
function answerStep(d: Draft, step: Step, raw: string, rate: number): { draft: Draft; ack: string } | string | null {
  const t = normalize(raw);
  const any = ANY.test(t);
  const pq = profileQuestion(step);
  if (pq) return { draft: setProfile(d, pq.key, raw.trim().slice(0, 300)), ack: "" };

  switch (step) {
    case "mode":
      if (/подроб|риелтор|риэлтор/.test(t)) return { draft: { ...d, mode: "detailed" }, ack: "" };
      if (/быстр/.test(t)) return { draft: { ...d, mode: "quick" }, ack: "" };
      return null;
    case "rooms": {
      if (any) return { draft: { ...d, rooms: [] }, ack: "Количество комнат не важно." };
      const nums = [...t.matchAll(/[1-5]/g)].map((m) => Number(m[0]));
      if (!nums.length) return null;
      const rooms = /[-–]/.test(t) && nums.length === 2 ? range(nums[0]!, nums[1]!) : nums;
      if (/\+|больше|более/.test(t)) for (let n = Math.max(...nums); n <= 5; n++) rooms.push(n);
      const draft = { ...d, rooms: [...new Set(rooms)].sort() };
      return { draft, ack: ack("rooms", draft) };
    }
    case "budget": {
      const draft = any
        ? { ...d, budget: { min: null, max: null } }
        : (() => {
            const b = findBudget(t, rate, d.deal, false);
            return b ? { ...d, budget: b } : null;
          })();
      return draft ? { draft, ack: ack("budget", draft) } : null;
    }
    case "area": {
      if (any) return { draft: { ...d, areaMin: null }, ack: ack("areaMin", { areaMin: null }) };
      const n = t.match(/\d+(?:[.,]\d+)?/);
      if (!n) return null;
      const draft = { ...d, areaMin: Number(n[0].replace(",", ".")) };
      return { draft, ack: ack("areaMin", draft) };
    }
    case "floor": {
      if (any || /^нет/.test(t)) {
        const draft = { ...d, floor: { notFirst: false, notLast: false } };
        return { draft, ack: ack("floor", draft) };
      }
      const first = /перв/.test(t);
      const last = /последн/.test(t);
      if (!first && !last) return null;
      const draft = { ...d, floor: { notFirst: first, notLast: last } };
      return { draft, ack: ack("floor", draft) };
    }
    case "district": {
      if (any || /^нет/.test(t)) return { draft: { ...d, district: null }, ack: "Район любой." };
      const name = raw.trim().replace(/^(в|на|у|около|возле|рядом с)\s+/i, "");
      if (name.length < 2 || name.length > 40) return null;
      return { draft: { ...d, district: name }, ack: `Район: ${name}.` };
    }
    case "c_consent":
      if (/^(да|ок|хорошо|согласен|согласна|продолж)/.test(t)) return { draft: setContact(d, "consent", true), ack: "" };
      if (/^(нет|не сейчас|не хочу)/.test(t)) return { draft: setContact(d, "consent", false), ack: "" };
      return null;
    case "c_name": {
      const name = raw.trim().replace(/^(меня зовут|я)\s+/i, "");
      if (name.length < 2 || name.length > 60 || /\d{3,}/.test(name)) return "Напишите, пожалуйста, имя — например «Анна».";
      return { draft: setContact(d, "name", name), ack: `Приятно познакомиться, ${name}!` };
    }
    case "c_phone": {
      if (/без телефона|не хочу|пропуст/.test(t)) return { draft: setContact(d, "phone", ""), ack: "" };
      const phone = normalizePhone(raw);
      if (!phone) return "Не похоже на номер телефона 🙂 Напишите, например, +375 29 123-45-67 или нажмите «📱 Поделиться номером».";
      return { draft: setContact(d, "phone", phone), ack: "Номер записал ✅" };
    }
    case "c_email": {
      if (any || /^нет/.test(t)) return { draft: setContact(d, "email", ""), ack: "" };
      const email = normalizeEmail(raw);
      if (!email) return "Не похоже на почту 🙂 Напишите, например, anna@mail.ru — или нажмите «Пропустить».";
      return { draft: setContact(d, "email", email), ack: "" };
    }
    case "c_social":
      if (any || /^нет/.test(t)) return { draft: setContact(d, "social", ""), ack: "" };
      return { draft: setContact(d, "social", raw.trim().slice(0, 200)), ack: "" };
    case "c_time": {
      const i = CALL_TIMES.findIndex((v) => t.includes(normalize(v).slice(0, 4)));
      return { draft: setContact(d, "time", i >= 0 ? CALL_TIMES[i]! : raw.trim().slice(0, 60)), ack: "" };
    }
    default:
      return null;
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
  // Вопросы анкеты и контакты — свободные ответы, параметры квартиры из них не извлекаем
  if (step && !isCore(step) && step !== "mode") {
    const answered = answerStep(d, step, text, rate);
    if (answered && typeof answered === "object") {
      return { draft: answered.draft, reply: advance(answered.draft, [answered.ack], step) };
    }
    const q = question(step, d);
    const hint = typeof answered === "string" ? answered : "Не совсем понял 🙂 " + q.text;
    return { draft: d, reply: { ...q, text: hint, step } };
  }

  // Вне диалога: новая сделка — новый поиск, иначе уточняем прошлый
  let base = d;
  if (step === null) {
    const { deal: newDeal } = extract(text, rate);
    base = !newDeal && last ? fromParams(last) : { tgName: d.tgName };
  }

  const merged = merge(base, text, rate);
  let result = merged.draft;
  const acks = merged.acks;

  if (step !== null && (step === "mode" ? result.mode === undefined : result[CORE_FIELD[step as CoreStep]] === undefined)) {
    const answered = answerStep(result, step, text, rate);
    if (answered && typeof answered === "object") {
      result = answered.draft;
      acks.push(answered.ack || "👍");
    }
  }

  if (!acks.length) {
    // Ничего не поняли: в диалоге переспрашиваем, вне диалога начинаем знакомство заново
    if (step === null) return { draft: { tgName: d.tgName }, reply: greeting() };
    const q = question(step, result);
    return { draft: result, reply: { ...q, text: "Не совсем понял 🙂 " + q.text, step } };
  }
  return { draft: result, reply: advance(result, acks.filter((a) => a !== "👍"), step) };
}

/** Телефон, присланный кнопкой «Поделиться номером». */
export function onContact(d: Draft, phone: string): { draft: Draft; reply: Reply } {
  const draft = setContact(d, "phone", normalizePhone(phone) ?? phone);
  return { draft, reply: advance(draft, ["Номер записал ✅"], "c_phone") };
}

/** Нажатие кнопки ответа (data вида «d:budget:60000-90000», «d:p_pets:1»). */
export function onChoice(d: Draft, data: string): { draft: Draft; reply: Reply } | null {
  const [, key, value] = data.split(":") as [string, Step, string];
  let draft = { ...d };
  const any = value === "any";

  const pq = profileQuestion(key);
  if (pq) {
    const options = pq.options(d.deal);
    draft = setProfile(draft, pq.key, value === "skip" ? "" : (options[Number(value)] ?? ""));
    return { draft, reply: advance(draft, [], key) };
  }

  switch (key) {
    case "mode":
      if (value !== "quick" && value !== "detailed") return null;
      draft.mode = value;
      return { draft, reply: advance(draft, [value === "detailed" ? "Отлично, подберём основательно 🤝" : ""], key) };
    case "deal":
      if (value !== "sale" && value !== "rent") return null;
      draft.deal = value;
      if (draft.mode === undefined) draft.mode = "quick";
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
    case "c_consent":
      draft = setContact(draft, "consent", value === "yes");
      return { draft, reply: advance(draft, [], key) };
    case "c_name":
      if (!d.tgName) return null;
      draft = setContact(draft, "name", d.tgName);
      return { draft, reply: advance(draft, [`Приятно познакомиться, ${d.tgName}!`], key) };
    case "c_email":
      draft = setContact(draft, "email", "");
      return { draft, reply: advance(draft, [], key) };
    case "c_social":
      draft = setContact(draft, "social", value === "tg" ? "Telegram" : "");
      return { draft, reply: advance(draft, [], key) };
    case "c_time":
      draft = setContact(draft, "time", CALL_TIMES[Number(value)] ?? "");
      return { draft, reply: advance(draft, [], key) };
    default:
      return null;
  }
  const field = key === "area" ? "areaMin" : (key as keyof Draft);
  return { draft, reply: advance(draft, [ack(field, draft)], key) };
}
