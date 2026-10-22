import type { Listing, SearchParams } from "@realt-agent/shared";

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
  const parts = [p.deal === "sale" ? "купить" : "снять", p.city];
  if (p.rooms.length) parts.push(`${p.rooms.join("/")}-комн.`);
  if (p.priceMinUsd != null) parts.push(`от $${num(p.priceMinUsd)}`);
  if (p.priceMaxUsd != null) parts.push(`до $${num(p.priceMaxUsd)}`);
  if (p.areaMin != null) parts.push(`от ${p.areaMin} м²`);
  if (p.notFirstFloor) parts.push("не первый этаж");
  if (p.notLastFloor) parts.push("не последний этаж");
  if (p.keywords.length) parts.push(`«${p.keywords.join(", ")}»`);
  return parts.join(", ");
}
