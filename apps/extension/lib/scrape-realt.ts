import {
  buildRealtUrl,
  listPath,
  mapRealtObject,
  matchesParams,
  queryFromParams,
  type Listing,
  type ProbePayload,
  type ProbeResult,
  type RealtRawObject,
  type TaskPayload,
} from "@realt-agent/shared";
import { browser } from "wxt/browser";

export class CaptchaError extends Error {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rand = (a: number, b: number) => a + Math.random() * (b - a);

/** Хватит, чтобы отобрать лучшие и не листать сайт лишний раз. */
const ENOUGH_MATCHES = 30;

interface PageData {
  blocked: boolean;
  hasData: boolean;
  notFound: boolean;
  title: string;
  objects: RealtRawObject[];
  totalCount: number;
  pageSize: number;
  /** Фильтр места, который понял сайт, и его название. */
  address: Record<string, string> | null;
  geoTitle: string | null;
  minPriceUsd: number | null;
}

/**
 * Выполняется внутри страницы realt.by (chrome.scripting.executeScript),
 * поэтому функция самодостаточна: никаких импортов и внешних переменных.
 */
async function readRealtPage(): Promise<PageData> {
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  // Неторопливая прокрутка, как у человека
  const steps = 4 + Math.floor(Math.random() * 5);
  for (let i = 0; i < steps; i++) {
    window.scrollBy(0, 300 + Math.random() * 600);
    await wait(250 + Math.random() * 700);
  }
  const el = document.getElementById("__NEXT_DATA__");
  const notFound = /не найдена|404/i.test(document.title);
  const empty = { objects: [], totalCount: 0, pageSize: 0, address: null, geoTitle: null, minPriceUsd: null };
  if (!el?.textContent) {
    const text = (document.body?.innerText ?? "").slice(0, 3000);
    return {
      blocked: /робот|captcha|доступ ограничен|подтвердите/i.test(text),
      hasData: false,
      notFound,
      title: document.title,
      ...empty,
    };
  }
  const props = JSON.parse(el.textContent)?.props?.pageProps ?? {};
  const address = props.objectListingFilters?.addressV2?.[0] ?? null;
  const geo = props.multiGeoDefaults?.[0];
  return {
    blocked: false,
    hasData: Array.isArray(props.objects),
    notFound,
    title: document.title,
    objects: props.objects ?? [],
    totalCount: props.pagination?.totalCount ?? props.totalCount ?? 0,
    pageSize: props.pagination?.pageSize ?? 0,
    address,
    geoTitle: address ? (geo?.shortTitle ?? geo?.title ?? null) : null,
    minPriceUsd: props.extraFields?.minPriceAggregation ?? null,
  };
}

function waitForComplete(tabId: number, timeoutMs = 45_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = (fn: () => void) => {
      clearTimeout(timer);
      browser.tabs.onUpdated.removeListener(listener);
      fn();
    };
    // проверяем адрес: about:blank, с которого стартует вкладка, тоже шлёт «complete»
    const listener = (id: number, info: { status?: string }, tab: { url?: string }) => {
      if (id === tabId && info.status === "complete" && tab.url?.startsWith("https://realt.by/")) done(resolve);
    };
    const timer = setTimeout(() => done(() => reject(new Error("page load timeout"))), timeoutMs);
    browser.tabs.onUpdated.addListener(listener);
  });
}

/** Открывает выдачу realt.by в фоновой вкладке, листает страницы и возвращает подходящие объявления. */
export async function scrapeRealt({
  params,
  maxPages,
}: TaskPayload): Promise<{ items: Listing[]; scanned: number; cheapestUsd?: number }> {
  const tab = await browser.tabs.create({ url: "about:blank", active: false });
  const tabId = tab.id!;
  let keepTab = false;
  const byId = new Map<string, Listing>();
  let scanned = 0;
  let cheapestUsd: number | undefined;
  const anyPrice = { ...params, priceMinUsd: null, priceMaxUsd: null };
  const q = queryFromParams(params);
  const path = listPath(q.deal, q.type);

  try {
    for (let page = 1; page <= maxPages; page++) {
      const loaded = waitForComplete(tabId);
      await browser.tabs.update(tabId, { url: buildRealtUrl(params, page) });
      await loaded;
      await sleep(rand(1500, 3500));

      const [injection] = await browser.scripting.executeScript({ target: { tabId }, func: readRealtPage });
      const data = injection?.result as PageData | undefined;
      if (!data) throw new Error("не удалось прочитать страницу");
      if (data.blocked) {
        // Оставляем вкладку и показываем её: проверку проходит человек
        keepTab = true;
        await browser.tabs.update(tabId, { active: true });
        throw new CaptchaError("captcha");
      }
      if (!data.hasData) {
        // Страница открылась, но без списка объявлений: сайт изменился или показал что-то другое
        throw new Error(`на странице нет списка объявлений (заголовок: «${data.title}»)`);
      }
      console.log(`[realt] стр. ${page}: ${data.objects.length} объявлений из ${data.totalCount}`);
      scanned += data.objects.length;

      for (const raw of data.objects) {
        const listing = mapRealtObject(raw, path);
        if (matchesParams(listing, params)) byId.set(listing.id, listing);
        else if (listing.priceUsd != null && matchesParams(listing, anyPrice)) {
          cheapestUsd = Math.min(cheapestUsd ?? Infinity, listing.priceUsd);
        }
      }

      const lastPage = !data.objects.length || page * data.pageSize >= data.totalCount;
      if (lastPage || byId.size >= ENOUGH_MATCHES) break;
      await sleep(rand(4000, 9000));
    }
  } finally {
    if (!keepTab) await browser.tabs.remove(tabId).catch(() => {});
  }
  return { items: [...byId.values()], scanned, cheapestUsd };
}

/** Открывает страницу в фоновой вкладке и читает её данные. */
async function loadPage(tabId: number, url: string): Promise<PageData> {
  const loaded = waitForComplete(tabId);
  await browser.tabs.update(tabId, { url });
  await loaded;
  await sleep(rand(1200, 2500));
  const [injection] = await browser.scripting.executeScript({ target: { tabId }, func: readRealtPage });
  const data = injection?.result as PageData | undefined;
  if (!data) throw new Error("не удалось прочитать страницу");
  return data;
}

/** URL той же выдачи, но страница page (адрес мог смениться после переадресации сайта). */
function withPage(url: string, page: number): string {
  const u = new URL(url);
  u.searchParams.set("page", String(page));
  return u.href;
}

/**
 * Быстрый запрос: первая существующая страница из urls, общее число объявлений,
 * и, если нужны наши фильтры, — просмотр до maxPages страниц.
 */
export async function probeRealt({ urls, maxPages, listPath: path, filter }: ProbePayload): Promise<ProbeResult> {
  const tab = await browser.tabs.create({ url: "about:blank", active: false });
  const tabId = tab.id!;
  let keepTab = false;
  try {
    for (const url of urls) {
      const first = await loadPage(tabId, url);
      if (first.blocked) {
        keepTab = true;
        await browser.tabs.update(tabId, { active: true });
        return { status: "captcha" };
      }
      if (first.notFound || !first.hasData) continue;

      const finalUrl = (await browser.tabs.get(tabId)).url ?? url;
      const items: Listing[] = [];
      let scanned = 0;
      let matched = 0;
      let data = first;
      for (let page = 1; ; page++) {
        scanned += data.objects.length;
        for (const raw of data.objects) {
          const listing = mapRealtObject(raw, path);
          if (filter && !matchesParams(listing, filter)) continue;
          matched++;
          if (items.length < 60) items.push(listing);
        }
        const lastPage = !data.objects.length || page * (data.pageSize || 1) >= data.totalCount;
        if (lastPage || page >= maxPages) break;
        await sleep(rand(2500, 5000));
        data = await loadPage(tabId, withPage(finalUrl, page + 1));
        if (data.blocked) {
          keepTab = true;
          await browser.tabs.update(tabId, { active: true });
          return { status: "captcha" };
        }
      }
      return {
        status: "done",
        url: finalUrl,
        geoTitle: first.geoTitle,
        address: first.address,
        totalCount: first.totalCount,
        scanned,
        matched,
        minPriceUsd: first.minPriceUsd,
        items,
      };
    }
    return { status: "notfound" };
  } catch (e) {
    return { status: "failed", error: String(e).slice(0, 500) };
  } finally {
    if (!keepTab) await browser.tabs.remove(tabId).catch(() => {});
  }
}
