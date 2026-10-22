import type { ParseResult, SearchParams } from "@realt-agent/shared";

/**
 * Разбор запроса без LLM, на правилах. Работает, когда ANTHROPIC_API_KEY не задан.
 * Понимает: купить/снять, число комнат, цену «до/от» с валютой, площадь «от N м²»,
 * «не первый/не последний этаж». Город пока один — Минск.
 */

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

function toNumber(num: string, mult?: string): number {
  let n = Number(num.replace(/[\s ]/g, "").replace(",", "."));
  if (mult) n *= /^(млн|миллион)/.test(mult) ? 1_000_000 : 1_000;
  return n;
}

function toUsd(amount: number, currency: string | undefined, rate: number): number {
  return currency && /(руб|byn|^р)/.test(currency) ? Math.round(amount / rate) : amount;
}

function findRooms(t: string): number[] {
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

function findPrices(t: string, rate: number): { min: number | null; max: number | null } {
  // Не путаем цену с площадью: «от 40 м²» — это не цена
  const notArea = String.raw`(?!\s*${AREA_UNIT})`;
  const max = t.match(new RegExp(String.raw`(?:до|не дороже|максимум|бюджет|за)\s*${NUM}${MULT}${CUR}${notArea}`));
  const min = t.match(new RegExp(String.raw`(?:от|не дешевле|минимум)\s*${NUM}${MULT}${CUR}${notArea}`));
  // «от 30 до 50 тыс $»: множитель и валюта, указанные один раз, относятся к обеим границам
  const mult = max?.[2] ?? min?.[2];
  const cur = max?.[3] ?? min?.[3];
  const price = (m: RegExpMatchArray | null) =>
    m ? toUsd(toNumber(m[1]!, m[2] ?? mult), m[3] ?? cur, rate) : null;
  if (min || max) return { min: price(min), max: price(max) };

  // Число без «до/от» («80000», «40к $») считаем максимальной ценой.
  // «2к» — это комнаты, а не 2000, поэтому с «к» берём только числа от 10.
  const bare = new RegExp(String.raw`(?<![\d.,])${NUM}${MULT}${CUR}${notArea}`, "g");
  for (const m of t.matchAll(bare)) {
    if (/^[кk]/.test(m[2] ?? "") && Number(m[1]) < 10) continue;
    const usd = toUsd(toNumber(m[1]!, m[2]), m[3], rate);
    if (usd >= 100) return { min: null, max: usd };
  }
  return { min: null, max: null };
}

export function simpleParse(text: string, usdBynRate: number): ParseResult {
  const t = text.toLowerCase().replace(/ё/g, "е");

  const deal: SearchParams["deal"] | null = RENT.test(t) ? "rent" : SALE.test(t) ? "sale" : null;
  if (!deal) return { params: null, question: "Купить или снять?" };

  const { min, max } = findPrices(t, usdBynRate);
  const area = t.match(new RegExp(String.raw`от\s*(\d+(?:[.,]\d+)?)\s*${AREA_UNIT}`));

  return {
    params: {
      deal,
      city: "Минск",
      rooms: findRooms(t),
      priceMinUsd: min,
      priceMaxUsd: max,
      areaMin: area ? Number(area[1]!.replace(",", ".")) : null,
      notFirstFloor: /не\s*(на\s*)?перв/.test(t),
      notLastFloor: /не\s*(на\s*)?последн/.test(t),
      keywords: [],
    },
    question: null,
  };
}
