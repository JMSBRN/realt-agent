import { DEAL_LABELS, TYPE_LABELS, type Listing, type SearchParams } from "@realt-agent/shared";

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const num = (n: number) => Math.round(n).toLocaleString("ru-RU").replace(/,/g, " ");

function priceLine(l: Listing): string {
  const parts = [];
  if (l.priceUsd != null) parts.push(`<b>$${num(l.priceUsd)}</b>`);
  if (l.priceByn != null) parts.push(`${num(l.priceByn)} р.`);
  return parts.join(" · ") || "<b>цена договорная</b>";
}

function factsLine(l: Listing): string {
  return [
    l.rooms ? `${l.rooms}-комн.` : null,
    l.areaTotal ? `${l.areaTotal} м²` : null,
    l.areaLand ? `участок ${l.areaLand} сот.` : null,
    l.ready ? `сдача ${l.ready}` : null,
    l.storey ? `этаж ${l.storey}${l.storeys ? `/${l.storeys}` : ""}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Подпись к фото (лимит Telegram — 1024 символа). */
export function listingCaption(l: Listing): string {
  const lines = [
    priceLine(l),
    factsLine(l),
    `📍 ${esc(l.address)}${l.metro ? ` · м. ${esc(l.metro)}` : ""}`,
    esc(l.title.slice(0, 300)),
    `<a href="${esc(l.url)}">Открыть на realt.by</a>`,
  ].filter(Boolean);
  return lines.join("\n").slice(0, 1024);
}

/** Одна строка для формата «только ссылки». */
export function listingLine(l: Listing, i: number): string {
  return `${i + 1}. ${priceLine(l)} · ${factsLine(l)}\n<a href="${esc(l.url)}">${esc(l.address || l.title)}</a>`;
}

export function describeParams(p: SearchParams): string {
  const parts = [DEAL_LABELS[p.deal]];
  if (p.type && p.type !== "flat") parts.push(TYPE_LABELS[p.type]);
  parts.push(p.city);
  if (p.rooms.length) parts.push(`${p.rooms.join("/")}-комн.`);
  if (p.priceMinUsd != null) parts.push(`от $${num(p.priceMinUsd)}`);
  if (p.priceMaxUsd != null) parts.push(`до $${num(p.priceMaxUsd)}`);
  if (p.areaMin != null) parts.push(`от ${p.areaMin} м²`);
  if (p.notFirstFloor) parts.push("не первый этаж");
  if (p.notLastFloor) parts.push("не последний этаж");
  if (p.keywords.length) parts.push(`«${p.keywords.join(", ")}»`);
  return parts.join(", ");
}

/** Вопрос, а не ответ на вопрос бота: такие фразы отдаём собеседнику. */
const QUESTION =
  /\?|^(а\s+)?(сколько|какие|какая|какой|каких|где|есть ли|что|почему|зачем|как|когда|покажи|расскажи|подскажи|посоветуй|чем|можно ли|сравни|почём|почем|стоит ли|нужно ли|правда ли)/i;
export const looksLikeQuestion = (text: string) => QUESTION.test(text.trim());

/** Не квартира или не Минск — кнопочный подбор этого не умеет, разбирается собеседник. */
const OTHER_TYPE = /(^|[^а-яё])(дом|дома|домик|коттедж|таунхаус|дач|участ|сотк|комнату|комната|офис|склад|магазин|помещен|коммерч|бизнес|новострой|жк|застройщик|посуточ|на сутки)/i;
const OTHER_PLACE = /(брест|витеб|гомел|гродн|могил|област|под минском|по стране|беларус|белорус)/i;
// «в Мозыре», «под Лидой»: город с заглавной буквы, кроме Минска
const OTHER_TOWN = /(^|\s)(в|во|под|около)\s+(?![Мм]инск)[А-ЯЁ][а-яё-]{2,}/;
export const needsAgent = (text: string) => OTHER_TYPE.test(text) || OTHER_PLACE.test(text) || OTHER_TOWN.test(text);

/** Markdown модели (**жирный**) → HTML Telegram; остальное экранируем. */
export const agentHtml = (text: string) =>
  esc(text)
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/^#+\s*/gm, "");
