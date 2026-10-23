import { readFileSync } from "node:fs";
import { normalizePlace, realtTranslit } from "@realt-agent/shared";

/**
 * Справочник районов и микрорайонов: собран из базы объявлений агентства (mls-base_sale_last,
 * 2025 год; телефонов и имён в нём нет) и дополнен административными районами областных центров.
 * Подробно размечен Минск; по другим городам — районы, где они известны, и улицы, где больше объявлений.
 * Пересобрать: выгрузить колонки «Регион…Микрорайон города» и обновить areas.json.
 */

export interface TownAreas {
  region: string;
  districts: Array<{ name: string; micro: string[] }>;
  streets: string[];
}

const AREAS: Record<string, TownAreas> = JSON.parse(
  readFileSync(new URL("./areas.json", import.meta.url), "utf8"),
);

const norm = (s: string) => normalizePlace(s).replace(/ё/g, "е");

/** Город по названию в любом падеже: «Минске», «в Гомеле», «г. Брест». */
export function townAreas(town: string): (TownAreas & { town: string }) | null {
  const n = norm(town);
  if (!n) return null;
  for (const [name, data] of Object.entries(AREAS)) {
    const key = norm(name);
    // «гомель» ~ «гомеле», «гродно» ~ «гродно», «могилев» ~ «могилеве»
    if (n === key || (n.length - key.length <= 2 && n.startsWith(key.slice(0, Math.max(3, key.length - 1))))) {
      return { town: name, ...data };
    }
  }
  return null;
}

/**
 * Адреса страниц района или микрорайона на realt.by — относительно страницы города:
 *   /sale/flats/minsk/oktjabrskij-rajon/, /sale/flats/minsk/minsk-mir-mk-r-n/,
 *   /gomel-region/sale/flats/gomel/molodezhnyj-mk-r-n/
 * Сайт обрезает адрес до 50 символов.
 */
export function areaPageUrls(townPageUrl: string, area: string): string[] {
  const clean = area
    .replace(/\(.*?\)/g, " ")
    .replace(/(^|\s)(мк-?р-?н|микрорайон|мкр\.?)(?=\s|$)/gi, " ")
    .trim();
  const isDistrict = /район/i.test(clean) && !/микро/i.test(area);
  const base = realtTranslit(clean.replace(/район/gi, " ").trim());
  if (!base) return [];
  const district = `${base}-rajon`.slice(0, 50);
  const micro = `${base}-mk-r-n`.slice(0, 50);
  const slugs = isDistrict ? [district] : [micro, district, base.slice(0, 50)];
  return [...new Set(slugs)].map((s) => `${townPageUrl.replace(/\/+$/, "")}/${s}/`);
}
