import {
  BELARUS,
  buildListUrl,
  DEAL_LABELS,
  knownPlace,
  listPath,
  townPageUrls,
  TYPE_LABELS,
  type Deal,
  type Listing,
  type Place,
  type ProbePayload,
  type ProbeResult,
  type PropertyType,
  type SearchParams,
} from "@realt-agent/shared";

/**
 * Знания о рынке для собеседника: сколько объявлений, какие есть новостройки, где искать.
 * Все цифры — живые, с realt.by: браузер клиента открывает выдачу и читает её.
 */

export interface Prober {
  connected: boolean;
  probe(payload: ProbePayload, timeoutMs?: number): Promise<ProbeResult>;
}

export interface PlaceCache {
  cachedPlace(key: string): Place | null;
  cachePlace(key: string, place: Place): void;
}

export interface MarketQuery {
  deal: Deal;
  type: PropertyType;
  town?: string | null;
  region?: string | null;
  rooms?: number[];
  priceMinUsd?: number | null;
  priceMaxUsd?: number | null;
  areaMin?: number | null;
  notFirstFloor?: boolean;
  notLastFloor?: boolean;
  keywords?: string[];
}

/** Сколько страниц выдачи (по 60 объявлений) просматривать, чтобы посчитать по нашим фильтрам. */
const FILTER_PAGES = 5;

export class RealtyError extends Error {}

const ROOMS_TYPES: PropertyType[] = ["flat", "room", "newbuild"];

function probeError(r: Exclude<ProbeResult, { status: "done" }>): RealtyError {
  if (r.status === "captcha") return new RealtyError("realt.by показал проверку «я не робот» — её нужно пройти в браузере");
  if (r.status === "notfound") return new RealtyError("такой страницы на realt.by нет");
  return new RealtyError(r.error);
}

const short = (l: Listing) => ({
  title: l.title.slice(0, 120),
  priceUsd: l.priceUsd,
  pricePerM2Usd: l.pricePerM2Usd ?? null,
  rooms: l.rooms,
  areaTotal: l.areaTotal,
  areaLand: l.areaLand ?? null,
  storey: l.storey && l.storeys ? `${l.storey}/${l.storeys}` : null,
  address: l.address,
  ready: l.ready ?? null,
  url: l.url,
});

export class Realty {
  constructor(
    private browser: Prober,
    private cache: PlaceCache,
  ) {}

  get online(): boolean {
    return this.browser.connected;
  }

  /** Город, область или вся страна. Незнакомый город ищем по страницам realt.by и запоминаем. */
  async resolvePlace(town?: string | null, region?: string | null): Promise<Place> {
    if (!town?.trim()) return region?.trim() ? (knownPlace(region) ?? BELARUS) : BELARUS;
    const known = knownPlace(town);
    if (known) return known;
    const key = `${town}|${region ?? ""}`.toLowerCase().trim();
    const cached = this.cache.cachedPlace(key);
    if (cached) return cached;

    const urls = townPageUrls(town, region);
    const r = await this.browser.probe({ urls, maxPages: 1, listPath: "/sale/flats/" });
    if (r.status === "notfound") throw new RealtyError(`не нашёл «${town}» на realt.by — уточните название или область`);
    if (r.status !== "done") throw probeError(r);
    if (!r.address) throw new RealtyError(`realt.by не распознал «${town}»`);
    const place = { title: r.geoTitle?.replace(/^г\.\s*/, "") || town, address: r.address };
    this.cache.cachePlace(key, place);
    return place;
  }

  async toParams(q: MarketQuery): Promise<SearchParams> {
    listPath(q.deal, q.type); // проверка, что такой раздел есть
    const place = await this.resolvePlace(q.town, q.region);
    return {
      deal: q.deal,
      type: q.type,
      city: place.title,
      place,
      rooms: ROOMS_TYPES.includes(q.type) ? [...new Set(q.rooms ?? [])].filter((n) => n >= 1 && n <= 5).sort() : [],
      priceMinUsd: q.priceMinUsd ?? null,
      priceMaxUsd: q.priceMaxUsd ?? null,
      areaMin: q.areaMin ?? null,
      notFirstFloor: q.notFirstFloor ?? false,
      notLastFloor: q.notLastFloor ?? false,
      keywords: q.keywords ?? [],
    };
  }

  /**
   * Сколько объявлений. Место и одно значение комнат фильтрует сам сайт — число точное.
   * Цену, площадь, этаж и слова проверяем по первым страницам выдачи: если просмотрели всё — точно,
   * иначе — оценка по доле подходящих.
   */
  async count(q: MarketQuery) {
    const params = await this.toParams(q);
    const place = params.place!;
    const path = listPath(params.deal, params.type!);
    const ownFilters =
      params.priceMinUsd != null ||
      params.priceMaxUsd != null ||
      params.areaMin != null ||
      params.notFirstFloor ||
      params.notLastFloor ||
      params.keywords.length > 0;
    const siteRooms = params.rooms.length && params.rooms.every((n) => n < 5) ? params.rooms : [null];

    let total = 0;
    let matchedEstimate = 0;
    let exact = true;
    let minPriceUsd: number | null = null;
    const samples: Listing[] = [];
    // «1 или 2 комнаты» — по запросу на каждое значение: так числа точные
    for (const rooms of siteRooms) {
      const filter = ownFilters || (rooms === null && params.rooms.length) ? params : null;
      const r = await this.browser.probe({
        urls: [buildListUrl({ deal: params.deal, type: params.type!, place, rooms }, 1)],
        maxPages: filter ? FILTER_PAGES : 1,
        listPath: path,
        filter,
      });
      if (r.status !== "done") throw probeError(r);
      total += r.totalCount;
      if (!filter) matchedEstimate += r.totalCount;
      else if (r.scanned >= r.totalCount) matchedEstimate += r.matched;
      else {
        exact = false;
        matchedEstimate += r.scanned ? Math.round((r.matched / r.scanned) * r.totalCount) : 0;
      }
      if (r.minPriceUsd != null && !filter) minPriceUsd = Math.min(minPriceUsd ?? Infinity, r.minPriceUsd);
      samples.push(...r.items);
    }

    const prices = samples.map((l) => l.priceUsd).filter((p): p is number => p != null).sort((a, b) => a - b);
    return {
      what: `${DEAL_LABELS[params.deal]} ${TYPE_LABELS[params.type!]}`,
      place: place.title,
      count: matchedEstimate,
      exact,
      totalWithoutOurFilters: ownFilters ? total : undefined,
      minPriceUsd: minPriceUsd ?? prices[0] ?? null,
      medianPriceUsd: prices.length ? prices[Math.floor(prices.length / 2)] : null,
      examples: samples.slice(0, 3).map(short),
    };
  }

  /** Новостройки и жилые комплексы — в том порядке, в каком их показывает realt.by. */
  async newBuildings(town?: string | null, region?: string | null) {
    const place = await this.resolvePlace(town, region);
    const r = await this.browser.probe({
      urls: [buildListUrl({ deal: "sale", type: "newbuild", place }, 1)],
      maxPages: 1,
      listPath: "/newflats/",
    });
    if (r.status !== "done") throw probeError(r);
    // Без места раздел новостроек показывает Минскую область — называем то, что показал сайт
    const title = place.address ? place.title : (r.geoTitle ?? "Минск и Минская область");
    return { place: title, count: r.totalCount, buildings: r.items.slice(0, 10).map(short) };
  }
}
