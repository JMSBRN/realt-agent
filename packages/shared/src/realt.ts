import type { Listing, SearchParams } from "./schemas.ts";

/**
 * realt.by — Next.js-сайт: объявления лежат JSON-ом в <script id="__NEXT_DATA__">
 * по пути props.pageProps.objects. Город задаётся параметром addressV2 (townUuid),
 * страница — параметром page. Комнаты, цену и площадь фильтруем сами.
 */

/** townUuid городов на realt.by. Чтобы добавить город: выберите его на сайте и скопируйте townUuid из addressV2 в URL. */
export const REALT_TOWNS: Record<string, string> = {
  "минск": "4cb07174-7b00-11eb-8943-0cc47adabd66",
};

const LIST_PATH = { sale: "/sale/flats/", rent: "/rent/flat-for-long/" } as const;
const OBJECT_PATH = { sale: "/sale-flats/object/", rent: "/rent-flat-for-long/object/" } as const;

const USD = "840";
const BYN = "933";

export function realtTownUuid(city: string): string | null {
  return REALT_TOWNS[city.trim().toLowerCase()] ?? null;
}

export function buildRealtUrl(params: SearchParams, page = 1): string {
  const town = realtTownUuid(params.city);
  if (!town) throw new Error(`Город «${params.city}» пока не поддерживается`);
  const url = new URL(LIST_PATH[params.deal], "https://realt.by");
  url.searchParams.set("addressV2", JSON.stringify([{ townUuid: town }]));
  if (page > 1) url.searchParams.set("page", String(page));
  return url.href;
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
}

export function mapRealtObject(o: RealtRawObject, deal: SearchParams["deal"]): Listing {
  const rooms = o.rooms ?? null;
  return {
    id: `realt:${o.code}`,
    site: "realt",
    url: `https://realt.by${OBJECT_PATH[deal]}${o.code}/`,
    title: o.headline || o.title || (rooms ? `${rooms}-комн. квартира` : "Квартира"),
    priceUsd: o.priceRates?.[USD] ?? null,
    priceByn: o.priceRates?.[BYN] ?? null,
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
  };
}

export function matchesParams(l: Listing, p: SearchParams): boolean {
  if (p.rooms.length && (l.rooms == null || !p.rooms.includes(Math.min(l.rooms, 5)))) return false;
  if (p.priceMaxUsd != null && (l.priceUsd == null || l.priceUsd > p.priceMaxUsd)) return false;
  if (p.priceMinUsd != null && (l.priceUsd == null || l.priceUsd < p.priceMinUsd)) return false;
  if (p.areaMin != null && (l.areaTotal == null || l.areaTotal < p.areaMin)) return false;
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
