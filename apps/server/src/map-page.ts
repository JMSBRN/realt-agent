import { createServer, type Server } from "node:http";
import type { Listing } from "@realt-agent/shared";
import type { Store } from "./db.ts";

/**
 * Карта с результатами поиска: на каждом объявлении — плашка с ценой,
 * нажатие открывает объявление на realt.by. Страница открывается кнопкой
 * в Telegram (как Mini App при https, иначе — в браузере).
 */

export interface MapPoint {
  lat: number;
  lon: number;
  usd: number | null;
  price: string;
  url: string;
  title: string;
  /** «1-комн. · 34 м² · этаж 3/9» */
  details: string;
  address: string;
}

export function toPoints(items: Listing[]): MapPoint[] {
  return items
    .filter((l) => l.lat != null && l.lon != null)
    .map((l) => ({
      lat: l.lat!,
      lon: l.lon!,
      usd: l.priceUsd,
      price: l.priceUsd != null ? "$" + Math.round(l.priceUsd).toLocaleString("ru-RU").replace(/[\s\u00a0,]/g, " ") : "цена ?",
      url: l.url,
      title: l.title.slice(0, 120),
      details: [
        l.rooms ? `${l.rooms}-комн.` : null,
        l.areaTotal ? `${l.areaTotal} м²` : null,
        l.storey ? `этаж ${l.storey}${l.storeys ? `/${l.storeys}` : ""}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
      address: l.address,
    }));
}

const escHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function renderMapPage(title: string, points: MapPoint[]): string {
  // JSON внутри <script>: экранируем «<», чтобы текст объявления не закрыл тег
  const data = JSON.stringify(points).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<title>${escHtml(title)}</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script src="https://telegram.org/js/telegram-web-app.js"></script>
<style>
  :root { --bg: #ffffff; --fg: #18181b; --muted: #71717a; --pill: #ffffff; --pill-fg: #065f46; --accent: #059669; }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #18181b; --fg: #f4f4f5; --muted: #a1a1aa; --pill: #27272a; --pill-fg: #6ee7b7; }
  }
  html, body { height: 100%; margin: 0; background: var(--bg); color: var(--fg); font: 14px/1.35 system-ui, sans-serif; }
  body { display: flex; flex-direction: column; }
  header { padding: 10px 16px; border-bottom: 1px solid rgba(127,127,127,.2); }
  header b { display: block; font-size: 15px; }
  header span { color: var(--muted); font-size: 12px; }
  #map { flex: 1; }
  .price { background: none; border: 0; }
  .price button {
    transform: translate(-50%, -100%); white-space: nowrap; cursor: pointer;
    padding: 3px 8px; border-radius: 999px; border: 1px solid var(--accent);
    background: var(--pill); color: var(--pill-fg); font: 600 13px system-ui, sans-serif;
    box-shadow: 0 1px 4px rgba(0,0,0,.25);
  }
  .price button:hover, .price button:focus-visible { background: var(--accent); color: #fff; outline: none; }
  .empty { padding: 24px 16px; color: var(--muted); }
  .list { max-height: 260px; overflow-y: auto; margin: 0; padding: 0; list-style: none; }
  .list li + li { border-top: 1px solid rgba(127,127,127,.2); }
  .list button {
    display: block; width: 100%; text-align: left; cursor: pointer; padding: 6px 2px;
    border: 0; background: none; font: 13px/1.3 system-ui, sans-serif; color: #18181b;
  }
  .list button b { color: var(--accent); }
  .list button:hover b { text-decoration: underline; }
  .list small { display: block; color: #71717a; }
  .addr { font: 600 13px system-ui, sans-serif; margin-bottom: 4px; }
</style>
</head>
<body>
<header><b>${escHtml(title)}</b><span>Нажмите на цену, чтобы открыть объявление на realt.by</span></header>
<div id="map"></div>
<script>
  const points = ${data};
  const tg = window.Telegram && window.Telegram.WebApp;
  if (tg && tg.initData) { tg.ready(); tg.expand(); }

  // В Telegram открываем ссылку во внешнем браузере, иначе — в новой вкладке
  function open(url) {
    if (tg && tg.initData) tg.openLink(url); else window.open(url, "_blank", "noopener");
  }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

  if (!points.length) {
    document.getElementById("map").outerHTML = '<p class="empty">У этих объявлений нет координат.</p>';
  } else {
    const map = L.map("map", { zoomControl: true });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    // Короткая подпись: «$58к» для продажи, «$650» для аренды
    const short = (n) => (n >= 10000 ? Math.round(n / 1000) : Math.round(n));
    const unit = (n) => (n >= 10000 ? "к" : "");
    function label(group) {
      const prices = group.map((p) => p.usd).filter((n) => n != null);
      if (!prices.length) return group.length > 1 ? "· " + group.length : "?";
      const lo = Math.min(...prices), hi = Math.max(...prices);
      const range = short(lo) === short(hi) ? "$" + short(lo) + unit(lo) : "$" + short(lo) + "–" + short(hi) + unit(hi);
      return group.length > 1 ? range + " · " + group.length : range;
    }

    // Квартиры в одном доме (новостройки!) объединяем в одну плашку со списком
    const groups = new Map();
    for (const p of points) {
      const key = p.lat.toFixed(4) + "," + p.lon.toFixed(4);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(p);
    }

    const bounds = [];
    for (const group of groups.values()) {
      group.sort((a, b) => (a.usd ?? Infinity) - (b.usd ?? Infinity));
      const first = group[0];
      const icon = L.divIcon({ className: "price", html: "<button>" + esc(label(group)) + "</button>", iconSize: null });
      const marker = L.marker([first.lat, first.lon], { icon, title: first.address }).addTo(map);
      if (group.length === 1) {
        marker
          .bindTooltip(esc(first.details) + "<br>" + esc(first.address), { direction: "top", offset: [0, -28] })
          .on("click", () => open(first.url));
      } else {
        const items = group
          .map((p) => '<li><button data-url="' + esc(p.url) + '"><b>' + esc(p.price) + "</b> · " + esc(p.details) +
            "<small>" + esc(p.title) + "</small></button></li>")
          .join("");
        marker.bindPopup('<div class="addr">' + esc(first.address) + '</div><ul class="list">' + items + "</ul>", {
          maxWidth: Math.min(300, window.innerWidth - 110),
          minWidth: Math.min(220, window.innerWidth - 110),
          offset: [0, -24],
          // чтобы список не уезжал под кнопки «+ / −»
          autoPanPaddingTopLeft: [56, 16],
          autoPanPaddingBottomRight: [16, 16],
        });
      }
      bounds.push([first.lat, first.lon]);
    }
    // Нажатие на цену в списке дома открывает объявление
    document.addEventListener("click", (e) => {
      const b = e.target.closest("[data-url]");
      if (b) open(b.dataset.url);
    });
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
  }
</script>
</body>
</html>`;
}

/** HTTP-сервер карты: GET /map/<id>. Отдельно от WebSocket расширения, чтобы тот оставался закрытым. */
export function startMapServer(store: Store, host: string, port: number): Server {
  const server = createServer((req, res) => {
    const id = req.url?.match(/^\/map\/([a-f0-9]{24})\/?(?:\?.*)?$/)?.[1];
    const map = id ? store.getMap(id) : null;
    if (req.method !== "GET" || !map) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("Карта не найдена или устарела");
      return;
    }
    res
      .writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "private, max-age=300" })
      .end(renderMapPage(map.title, map.points));
  });
  server.listen(port, host, () => console.log(`[map] http://${host}:${port}`));
  return server;
}
