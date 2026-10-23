import type { SearchParams } from "@realt-agent/shared";

/**
 * Извлечение параметров поиска из русского текста, на правилах (без LLM).
 * Возвращает только то, что удалось понять, — остальное спросит диалог.
 */

type Deal = SearchParams["deal"];

export interface Extracted {
  deal?: Deal;
  rooms?: number[];
  priceMinUsd?: number;
  priceMaxUsd?: number;
  areaMin?: number;
  notFirstFloor?: true;
  notLastFloor?: true;
}

const RENT = /(сним|снять|аренд|сдаю|сдает|на длительный)/;
const SALE = /(куп|покуп|продаж|продаю|продает)/;

const ROOM_WORDS: Array<[RegExp, number]> = [
  [/(однушк|однокомнат|одноком|студи)/, 1],
  [/(двушк|двухкомнат|двухком)/, 2],
  [/(трешк|трехкомнат|трехком)/, 3],
  [/(четырехкомнат|четырехком)/, 4],
  [/(пятикомнат|пятиком)/, 5],
];

// \b в JS не работает с кириллицей, поэтому конец слова проверяем так
const END = String.raw`(?![а-яa-z])`;
// (?!\d) не даёт «откусить» число частично: «от 40 м²» не должно стать «от 4»
const NUM = String.raw`(\d+(?:[\s ]\d{3})*(?:[.,]\d+)?)(?!\d)`;
const MULT = String.raw`(?:\s*(тыс\.?|тысяч[а-я]*|т\.|к${END}|k${END}|млн|миллион[а-я]*))?`;
const CUR = String.raw`(?:\s*(\$|долл[а-я]*|usd|у\.?\s?е\.?|бел\.?\s?руб[а-я]*|руб[а-я]*|byn|р\.))?`;
const AREA_UNIT = String.raw`(?:м2|м²|кв\.?\s?м|метр|квадрат|кв${END})`;
const NOT_AREA = String.raw`(?!\s*${AREA_UNIT})`;

export const ANY = /(не\s*важно|неважно|любой|любая|любое|любые|без разницы|все равно|всё равно|пофиг|пропуст)/;

export function normalize(text: string): string {
  return text.toLowerCase().replace(/ё/g, "е").trim();
}

function toNumber(num: string, mult?: string): number {
  let n = Number(num.replace(/[\s ]/g, "").replace(",", "."));
  if (mult) n *= /^(млн|миллион)/.test(mult) ? 1_000_000 : 1_000;
  return n;
}

function toUsd(amount: number, currency: string | undefined, rate: number): number {
  return currency && /(руб|byn|^р)/.test(currency) ? Math.round(amount / rate) : amount;
}

/** Цены продажи меньше $1000 не бывает: «от 60 до 80» при покупке — это тысячи. */
function scale(n: number | null, deal: Deal | undefined, hasMult: boolean): number | null {
  if (n == null) return null;
  return deal === "sale" && !hasMult && n < 1000 ? n * 1000 : n;
}

export function findDeal(t: string): Deal | undefined {
  return RENT.test(t) ? "rent" : SALE.test(t) ? "sale" : undefined;
}

export function findRooms(t: string): number[] {
  const rooms = new Set<number>();
  for (const [re, n] of ROOM_WORDS) if (re.test(t)) rooms.add(n);
  // «1к», «2-к», «2-комн», «3 комнаты», «2х»
  const single = new RegExp(String.raw`(?<![\d.,])([1-5])\s*-?\s*(?:к${END}|к\.|комн|х${END}|х-)`, "g");
  for (const m of t.matchAll(single)) rooms.add(Number(m[1]));
  // «1-2к», «2 или 3 комнаты»
  const range = t.match(new RegExp(String.raw`([1-5])\s*(?:-|–|или)\s*([1-5])\s*-?\s*(?:к${END}|комн)`));
  if (range) for (let n = Number(range[1]); n <= Number(range[2]); n++) rooms.add(n);
  return [...rooms].sort();
}

/**
 * Бюджет: «от 30 до 50 тыс», «60–80к $», «до 70 000», «80000».
 * strict = true — ищем только явные цены (в свободной фразе), false — в ответе на вопрос о бюджете.
 */
export function findBudget(
  t: string,
  rate: number,
  deal: Deal | undefined,
  strict: boolean,
): { min: number | null; max: number | null } | null {
  const max = t.match(new RegExp(String.raw`(?:до|не дороже|максимум|бюджет|за)\s*${NUM}${MULT}${CUR}${NOT_AREA}`));
  const min = t.match(new RegExp(String.raw`(?:от|не дешевле|минимум)\s*${NUM}${MULT}${CUR}${NOT_AREA}`));
  if (min || max) {
    // «от 30 до 50 тыс $»: множитель и валюта, указанные один раз, относятся к обеим границам
    const mult = max?.[2] ?? min?.[2];
    const cur = max?.[3] ?? min?.[3];
    const price = (m: RegExpMatchArray | null) =>
      m ? scale(toUsd(toNumber(m[1]!, m[2] ?? mult), m[3] ?? cur, rate), deal, !!(m[2] ?? mult)) : null;
    return { min: price(min), max: price(max) };
  }

  // Вилка через тире: «60-80 тыс», «60–80к $». «1-2к» — это комнаты, поэтому числа от 10.
  const dash = t.match(new RegExp(String.raw`(?<![\d.,])${NUM}\s*[-–—]\s*${NUM}${MULT}${CUR}${NOT_AREA}`));
  if (dash && Number(dash[1]) >= 10 && (!strict || dash[3] || dash[4] || Number(dash[2]) >= 1000)) {
    const conv = (n: string) => scale(toUsd(toNumber(n, dash[3]), dash[4], rate), deal, !!dash[3]);
    return { min: conv(dash[1]!), max: conv(dash[2]!) };
  }

  // Одно число («80000», «70к $») — максимальная цена. «2к» — комнаты, поэтому с «к» числа от 10.
  const bare = new RegExp(String.raw`(?<![\d.,])${NUM}${MULT}${CUR}${NOT_AREA}`, "g");
  for (const m of t.matchAll(bare)) {
    if (/^[кk]/.test(m[2] ?? "") && Number(m[1]) < 10) continue;
    // В свободной фразе «2» или «45» — не цена (это комнаты, площадь…), нужны «тыс», «$» или число от 1000
    if (strict && !m[2] && !m[3] && toNumber(m[1]!) < 1000) continue;
    const usd = scale(toUsd(toNumber(m[1]!, m[2]), m[3], rate), deal, !!m[2]);
    if (usd != null && usd >= (strict ? 100 : 1)) return { min: null, max: usd };
  }
  return null;
}

export function findArea(t: string): number | undefined {
  const m = t.match(new RegExp(String.raw`(?:от|не меньше|минимум)\s*(\d+(?:[.,]\d+)?)\s*${AREA_UNIT}`));
  return m ? Number(m[1]!.replace(",", ".")) : undefined;
}

/** Всё, что удалось понять из свободной фразы. dealHint — уже известный тип сделки. */
export function extract(text: string, rate: number, dealHint?: Deal): Extracted {
  const t = normalize(text);
  const out: Extracted = {};
  const deal = findDeal(t);
  if (deal) out.deal = deal;

  const rooms = findRooms(t);
  if (rooms.length) out.rooms = rooms;

  const budget = findBudget(t, rate, deal ?? dealHint, true);
  if (budget?.min != null) out.priceMinUsd = budget.min;
  if (budget?.max != null) out.priceMaxUsd = budget.max;

  const area = findArea(t);
  if (area != null) out.areaMin = area;

  if (/не\s*(на\s*)?перв/.test(t)) out.notFirstFloor = true;
  if (/не\s*(на\s*)?последн/.test(t)) out.notLastFloor = true;
  return out;
}
