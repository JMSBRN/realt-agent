import { z } from "zod/v4";

export const DEALS = ["sale", "rent", "rent_day"] as const;
export type Deal = (typeof DEALS)[number];

export const PROPERTY_TYPES = [
  "flat", "room", "house", "dacha", "plot", "office", "shop", "warehouse", "business", "newbuild",
] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number];

export const PlaceSchema = z.object({
  title: z.string(),
  address: z.record(z.string(), z.string()).nullable(),
});

/** Параметры поиска. type и place — необязательны: старые поиски — квартиры в городе city. */
export const SearchParamsSchema = z.object({
  deal: z.enum(DEALS).describe("sale — купить, rent — снять на длительный срок, rent_day — на сутки"),
  type: z.enum(PROPERTY_TYPES).optional(),
  city: z.string().describe("Название места для людей, например «Минск»"),
  place: PlaceSchema.optional(),
  rooms: z.array(z.number().int().min(1).max(5)).describe("Допустимое число комнат; пустой массив — любое"),
  priceMinUsd: z.number().nullable().describe("Минимальная цена в долларах США или null"),
  priceMaxUsd: z.number().nullable().describe("Максимальная цена в долларах США или null"),
  areaMin: z.number().nullable().describe("Минимальная общая площадь, м², или null"),
  notFirstFloor: z.boolean(),
  notLastFloor: z.boolean(),
  keywords: z.array(z.string()).describe("Слова, которые должны встречаться в объявлении (район, улица, «ремонт»)"),
});
export type SearchParams = z.infer<typeof SearchParamsSchema>;

export type Site = "realt";

/** Задача, которую сервер кладёт в таблицу tasks, а расширение выполняет. */
export interface TaskPayload {
  site: Site;
  params: SearchParams;
  maxPages: number;
}

/** Нормализованное объявление, одинаковое для всех сайтов. */
export const ListingSchema = z.object({
  id: z.string(), // "<site>:<код объявления>"
  site: z.literal("realt"),
  url: z.url(),
  title: z.string(),
  priceUsd: z.number().nullable(),
  priceByn: z.number().nullable(),
  rooms: z.number().nullable(),
  areaTotal: z.number().nullable(),
  storey: z.number().nullable(),
  storeys: z.number().nullable(),
  address: z.string(),
  metro: z.string().nullable(),
  images: z.array(z.string()),
  description: z.string(),
  createdAt: z.string().nullable(),
  // координаты для карты; optional — чтобы старые версии расширения не ломали проверку
  lat: z.number().nullable().optional(),
  lon: z.number().nullable().optional(),
  town: z.string().nullable().optional(),
  pricePerM2Usd: z.number().nullable().optional(),
  areaLand: z.number().nullable().optional(),
  /** Новостройки: срок сдачи («4 кв. 2026»). */
  ready: z.string().nullable().optional(),
});
export type Listing = z.infer<typeof ListingSchema>;

export type TaskStatus = "queued" | "running" | "done" | "captcha" | "failed";

/** То, что расширение отправляет на сервер по итогам задачи. */
export const TaskResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("done"),
    items: z.array(ListingSchema).max(500),
    // сколько объявлений расширение просмотрело до фильтрации
    scanned: z.number().optional(),
    // минимальная цена среди подходящих по всему, кроме цены, — чтобы предложить поднять бюджет
    cheapestUsd: z.number().optional(),
  }),
  z.object({ status: z.literal("captcha") }),
  z.object({ status: z.literal("failed"), error: z.string().max(2000) }),
]);
export type TaskResult = z.infer<typeof TaskResultSchema>;

/**
 * Быстрый запрос к сайту: «сколько однушек в Гомеле», «какие новостройки», «какой uuid у Мозыря».
 * Расширение открывает адреса по очереди до первой существующей страницы, читает общее число
 * объявлений и до maxPages страниц выдачи; filter — наши фильтры (цена, площадь…), которых нет у сайта.
 */
export interface ProbePayload {
  urls: string[];
  maxPages: number;
  /** Раздел сайта — чтобы собрать ссылки на объекты. */
  listPath: string;
  filter?: SearchParams | null;
}

export const ProbeResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("done"),
    url: z.string(),
    /** Место, которое понял сайт: название и фильтр addressV2. */
    geoTitle: z.string().nullable(),
    address: z.record(z.string(), z.string()).nullable(),
    /** Всего объявлений по фильтрам сайта. */
    totalCount: z.number(),
    /** Сколько просмотрели и сколько из них прошло наши фильтры. */
    scanned: z.number(),
    matched: z.number(),
    minPriceUsd: z.number().nullable(),
    items: z.array(ListingSchema).max(60),
  }),
  z.object({ status: z.literal("notfound") }),
  z.object({ status: z.literal("captcha") }),
  z.object({ status: z.literal("failed"), error: z.string().max(2000) }),
]);
export type ProbeResult = z.infer<typeof ProbeResultSchema>;
