import type { Draft } from "./dialogue.ts";
import { PROFILE_QUESTIONS } from "./survey.ts";

/** Строка лида для Google Sheets и сообщение риелтору. */

export interface TgUser {
  id: number;
  username?: string;
  firstName?: string;
}

export const LEAD_HEADER = [
  "Дата",
  "Статус",
  "Имя",
  "Телефон",
  "Email",
  "Мессенджер / соцсети",
  "Удобное время",
  "Telegram",
  "Telegram ID",
  "Режим",
  "Сделка",
  "Комнаты",
  "Бюджет от, $",
  "Бюджет до, $",
  "Площадь от, м²",
  "Этаж",
  "Район",
  ...PROFILE_QUESTIONS.map((q) => q.column),
];

function floorText(d: Draft): string {
  if (!d.floor) return "";
  const { notFirst, notLast } = d.floor;
  return notFirst && notLast ? "не первый, не последний" : notFirst ? "не первый" : notLast ? "не последний" : "любой";
}

export function leadRow(d: Draft, tg: TgUser, now = new Date()): string[] {
  const c = d.contact ?? {};
  const p = d.profile ?? {};
  const date = now.toLocaleString("ru-RU", { timeZone: "Europe/Minsk", dateStyle: "short", timeStyle: "short" });
  return [
    date,
    "Новый",
    c.name ?? "",
    c.phone ?? "",
    c.email ?? "",
    c.social ?? "",
    c.time ?? "",
    tg.username ? `@${tg.username}` : (tg.firstName ?? ""),
    String(tg.id),
    d.mode === "detailed" ? "Подробный" : "Быстрый",
    d.deal === "rent" ? "Аренда" : d.deal === "sale" ? "Покупка" : "",
    d.rooms?.length ? d.rooms.join(", ") : d.rooms ? "любое" : "",
    d.budget?.min != null ? String(d.budget.min) : "",
    d.budget?.max != null ? String(d.budget.max) : "",
    d.areaMin != null ? String(d.areaMin) : "",
    floorText(d),
    d.district ?? "",
    ...PROFILE_QUESTIONS.map((q) => p[q.key] ?? ""),
  ];
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Короткая карточка нового лида для риелтора в Telegram. */
export function leadSummary(row: string[]): string {
  const lines = LEAD_HEADER.map((h, i) => [h, row[i] ?? ""] as const)
    .filter(([h, v]) => v && !["Дата", "Статус", "Telegram ID"].includes(h))
    .map(([h, v]) => `<b>${esc(h)}:</b> ${esc(v)}`);
  return `🔔 <b>Новый лид</b>\n\n${lines.join("\n")}`;
}
