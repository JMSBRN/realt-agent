import { knownPlace, type Place } from "./geo.ts";
import type { Deal, Listing, PropertyType, SearchParams } from "./schemas.ts";

/**
 * realt.by — Next.js-сайт: объявления лежат JSON-ом в <script id="__NEXT_DATA__">
 * по пути props.pageProps.objects, общее число — в pagination.totalCount.
 * Место задаётся параметром addressV2 (см. geo.ts), одно значение комнат — параметром rooms,
 * страница — параметром page. Цену, площадь, этаж и несколько вариантов комнат фильтруем сами.
 */

/** Разделы сайта: тип недвижимости × сделка. */
export const LIST_PATHS: Record<Deal, Partial<Record<PropertyType, string>>> = {
  sale: {
    flat: "/sale/flats/",
    room: "/sale/rooms/",
    house: "/sale/cottages/",
    dacha: "/sale/dachi/",
    plot: "/sale/plots/",
    office: "/sale/offices/",
    shop: "/sale/shops/",
    warehouse: "/sale/warehouses/",
    business: "/sale/business/",
    newbuild: "/newflats/",
  },
  rent: {
    flat: "/rent/flat-for-long/",
    room: "/rent/room-for-long/",
    house: "/rent/cottage-for-long/",
    office: "/rent/offices/",
    shop: "/rent/shops/",
    warehouse: "/rent/warehouses/",
    business: "/rent/business/",
  },
  rent_day: { flat: "/rent/flat-for-day/", house: "/rent/cottage-for-day/" },
};

export const TYPE_LABELS: Record<PropertyType, string> = {
  flat: "квартиры",
  room: "комнаты",
  house: "дома и коттеджи",
  dacha: "дачи",
  plot: "участки",
  office: "офисы",
  shop: "торговые помещения",
  warehouse: "склады",
  business: "готовый бизнес",
  newbuild: "новостройки",
};

export const DEAL_LABELS: Record<Deal, string> = { sale: "купить", rent: "снять", rent_day: "снять на сутки" };

export function listPath(deal: Deal, type: PropertyType): string {
  const path = LIST_PATHS[deal][type];
  if (!path) throw new Error(`На realt.by нет раздела «${TYPE_LABELS[type]}» для «${DEAL_LABELS[deal]}»`);
  return path;
}

/** /sale/flats/ → /sale-flats/object/, /newflats/ → /zhiloy-kompleks/object/ */
export function objectPath(path: string): string {
  if (path === "/newflats/") return "/zhiloy-kompleks/object/";
  return "/" + path.split("/").filter(Boolean).join("-") + "/object/";
}

const USD = "840";
const BYN = "933";

/** Город поиска из старых параметров (поле city), если место не задано явно. */
export function paramsPlace(params: SearchParams): Place {
  if (params.place !== undefined) return params.place;
  const place = knownPlace(params.city);
  if (!place?.address?.townUuid) throw new Error(`Город «${params.city}» пока не поддерживается`);
  return place;
}

export interface ListQuery {
  deal: Deal;
  type: PropertyType;
  place: Place;
  /** Одно значение комнат сайт фильтрует сам; несколько — фильтруем мы. */
  rooms?: number | null;
}

export function buildListUrl(q: ListQuery, page = 1): string {
  const url = new URL(listPath(q.deal, q.type), "https://realt.by");
  if (q.place.address) url.searchParams.set("addressV2", JSON.stringify([q.place.address]));
  if (q.rooms) url.searchParams.set("rooms", String(q.rooms));
  if (page > 1) url.searchParams.set("page", String(page));
  return url.href;
}

/** Ровно одно значение комнат (кроме «5 и больше») можно отдать фильтру сайта. */
export function siteRooms(params: SearchParams): number | null {
  return params.rooms.length === 1 && params.rooms[0]! < 5 ? params.rooms[0]! : null;
}

export function queryFromParams(params: SearchParams): ListQuery {
  return { deal: params.deal, type: params.type ?? "flat", place: paramsPlace(params), rooms: siteRooms(params) };
}

export function buildRealtUrl(params: SearchParams, page = 1): string {
  return buildListUrl(queryFromParams(params), page);
}

/** Сырой объект из __NEXT_DATA__ (только поля, которые используем). */
export interface RealtRawObject {
  code: number;
  headline?: string | null;
  title?: string | null;
  description?: string | null;
  price?: number | null;
  priceRates?: Record<string, number> | null;
  rooms?: number | null;
  areaTotal?: number | null;
  storey?: number | null;
  storeys?: number | null;
  address?: string | null;
  metroStationName?: string | null;
  images?: string[] | null;
  createdAt?: string | null;
  /** [долгота, широта] */
  location?: [number, number] | null;
  townName?: string | null;
  areaLand?: number | null;
  priceRatesPerM2?: Record<string, number> | null;
  priceRatesMin?: Record<string, number> | null;
  availableYear?: number | null;
  availableQuarter?: number | null;
}

/** Раздел, из которого взят объект: deal — для старых квартирных задач, иначе путь раздела. */
export function mapRealtObject(o: RealtRawObject, from: Deal | string): Listing {
  const rooms = o.rooms ?? null;
  const path = from.startsWith("/") ? from : listPath(from as Deal, "flat");
  // У новостроек цена «от» лежит в priceRatesMin
  const rates = o.priceRates && Object.keys(o.priceRates).length ? o.priceRates : (o.priceRatesMin ?? null);
  return {
    id: `realt:${o.code}`,
    site: "realt",
    url: `https://realt.by${objectPath(path)}${o.code}/`,
    title: (path === "/newflats/" ? o.title || o.headline : o.headline || o.title) || (rooms ? `${rooms}-комн. квартира` : "Объект"),
    priceUsd: rates?.[USD] || null,
    priceByn: rates?.[BYN] || null,
    rooms,
    areaTotal: o.areaTotal ?? null,
    storey: o.storey ?? null,
    storeys: o.storeys ?? null,
    address: o.address ?? "",
    metro: o.metroStationName ?? null,
    images: Array.isArray(o.images) ? o.images : [],
    description: (o.description ?? "").slice(0, 1000),
    createdAt: o.createdAt ?? null,
    lat: o.location?.[1] ?? null,
    lon: o.location?.[0] ?? null,
    town: o.townName ?? null,
    pricePerM2Usd: o.priceRatesPerM2?.[USD] || null,
    areaLand: o.areaLand ?? null,
    ready: o.availableYear ? `${o.availableQuarter ? `${o.availableQuarter} кв. ` : ""}${o.availableYear}` : null,
  };
}

export function matchesParams(l: Listing, p: SearchParams): boolean {
  if (p.rooms.length && (l.rooms == null || !p.rooms.includes(Math.min(l.rooms, 5)))) return false;
  if (p.priceMaxUsd != null && (l.priceUsd == null || l.priceUsd > p.priceMaxUsd)) return false;
  if (p.priceMinUsd != null && (l.priceUsd == null || l.priceUsd < p.priceMinUsd)) return false;
  // У участков важна площадь земли (в сотках), у остального — общая
  const area = p.type === "plot" ? (l.areaLand ?? null) : l.areaTotal;
  if (p.areaMin != null && (area == null || area < p.areaMin)) return false;
  if (p.notFirstFloor && l.storey === 1) return false;
  if (p.notLastFloor && l.storey != null && l.storey === l.storeys) return false;
  if (p.keywords.length) {
    const hay = `${l.title} ${l.address} ${l.metro ?? ""} ${l.description}`.toLowerCase();
    if (!p.keywords.every((k) => hay.includes(k.toLowerCase()))) return false;
  }
  return true;
}

/** Свежие объявления первыми. */
export function sortNewestFirst(items: Listing[]): Listing[] {
  return [...items].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
}
