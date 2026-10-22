import {
  buildRealtUrl,
  mapRealtObject,
  matchesParams,
  type Listing,
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
  objects: RealtRawObject[];
  totalCount: number;
  pageSize: number;
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
  if (!el?.textContent) {
    const text = (document.body?.innerText ?? "").slice(0, 3000);
    return { blocked: /робот|captcha|доступ ограничен|подтвердите/i.test(text), objects: [], totalCount: 0, pageSize: 0 };
  }
  const props = JSON.parse(el.textContent)?.props?.pageProps ?? {};
  return {
    blocked: false,
    objects: props.objects ?? [],
    totalCount: props.pagination?.totalCount ?? 0,
    pageSize: props.pagination?.pageSize ?? 0,
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
export async function scrapeRealt({ params, maxPages }: TaskPayload): Promise<Listing[]> {
  const tab = await browser.tabs.create({ url: "about:blank", active: false });
  const tabId = tab.id!;
  let keepTab = false;
  const byId = new Map<string, Listing>();

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

      for (const raw of data.objects) {
        const listing = mapRealtObject(raw, params.deal);
        if (matchesParams(listing, params)) byId.set(listing.id, listing);
      }

      const lastPage = !data.objects.length || page * data.pageSize >= data.totalCount;
      if (lastPage || byId.size >= ENOUGH_MATCHES) break;
      await sleep(rand(4000, 9000));
    }
  } finally {
    if (!keepTab) await browser.tabs.remove(tabId).catch(() => {});
  }
  return [...byId.values()];
}
