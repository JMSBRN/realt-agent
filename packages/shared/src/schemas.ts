import { z } from "zod/v4";

/** Параметры поиска квартиры. */
export const SearchParamsSchema = z.object({
  deal: z.enum(["sale", "rent"]).describe("sale — купить, rent — снять на длительный срок"),
  city: z.string().describe("Город в именительном падеже, например «Минск»"),
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
