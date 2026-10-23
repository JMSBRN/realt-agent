import type { SearchParams } from "@realt-agent/shared";

/**
 * Вопросы риелтора для подробного подбора и сбор контактов.
 * Список декларативный: чтобы добавить, убрать или переформулировать вопрос,
 * достаточно поправить его здесь — диалог и таблица лидов подхватят изменения.
 */

type Deal = SearchParams["deal"];

export type ProfileKey =
  | "purpose"
  | "household"
  | "kids"
  | "school"
  | "pets"
  | "nearby"
  | "renovation"
  | "building"
  | "surroundings"
  | "timeline"
  | "payment"
  | "term"
  | "comment";

export interface ProfileQuestion {
  key: ProfileKey;
  /** Заголовок колонки в Google Sheets */
  column: string;
  text: (deal: Deal | undefined) => string;
  options: (deal: Deal | undefined) => string[];
  /** Когда вопрос уместен; по умолчанию — всегда. */
  applies?: (deal: Deal | undefined, profile: Partial<Record<ProfileKey, string>>) => boolean;
  /** Подпись кнопки «пропустить» */
  skip?: string;
}

const hasKids = (_: Deal | undefined, p: Partial<Record<ProfileKey, string>>) => /дет|ребен|ребён/i.test(p.household ?? "");

export const PROFILE_QUESTIONS: ProfileQuestion[] = [
  {
    key: "purpose",
    column: "Цель",
    text: (deal) => (deal === "rent" ? "Для кого ищете жильё?" : "Для чего покупаете квартиру?"),
    options: (deal) =>
      deal === "rent"
        ? ["Для себя", "Для семьи", "Для сотрудника / компании"]
        : ["Для жизни", "Инвестиция / сдавать", "Для детей или родителей"],
  },
  {
    key: "household",
    column: "Кто будет жить",
    text: () => "Кто будет жить в квартире?",
    options: () => ["Один / одна", "Пара", "Семья с детьми", "Семья с родителями"],
  },
  {
    key: "kids",
    column: "Дети",
    text: () => "Сколько детей и какого они возраста? Можно написать, например, «двое, 5 и 9 лет».",
    options: () => ["Один ребёнок", "Двое", "Трое и больше"],
    applies: hasKids,
  },
  {
    key: "school",
    column: "Школа / садик рядом",
    text: () => "Что важно рядом для детей?",
    options: () => ["Школа", "Детский сад", "И школа, и садик", "Не важно"],
    applies: hasKids,
  },
  {
    key: "pets",
    column: "Животные",
    text: (deal) =>
      deal === "rent"
        ? "Есть домашние животные? Многие хозяева против — учту это сразу."
        : "Есть домашние животные?",
    options: () => ["Нет", "Собака", "Кошка", "Другие"],
  },
  {
    key: "nearby",
    column: "Важно рядом",
    text: () => "Что обязательно должно быть рядом с домом? Если важно добираться до работы — напишите, где она.",
    options: () => ["Метро", "Парк / зелёная зона", "Магазины, ТЦ", "Не важно"],
  },
  {
    key: "renovation",
    column: "Ремонт",
    text: () => "Какое состояние квартиры рассматриваете?",
    options: (deal) =>
      deal === "rent"
        ? ["Свежий ремонт", "Обычное, жилое", "Не важно"]
        : ["С ремонтом — заехать и жить", "Под косметический ремонт", "Без отделки", "Не важно"],
  },
  {
    key: "building",
    column: "Тип дома",
    text: () => "Новостройка или вторичное жильё?",
    options: () => ["Новостройка", "Вторичка", "Не важно"],
    applies: (deal) => deal !== "rent",
  },
  {
    key: "surroundings",
    column: "Дом и соседи",
    text: () => "Пожелания к дому и соседям? Можно своими словами: тихий подъезд, без шумных соседей, лифт…",
    options: () => ["Тихий двор", "Парковка", "Охрана / консьерж", "Не важно"],
  },
  {
    key: "timeline",
    column: "Сроки",
    text: (deal) => (deal === "rent" ? "Когда нужно заехать?" : "Когда планируете покупку?"),
    options: () => ["Срочно, в этом месяце", "В ближайшие 1–3 месяца", "Пока присматриваюсь"],
  },
  {
    key: "payment",
    column: "Оплата",
    text: () => "Как планируете оплату?",
    options: () => ["Наличные", "Ипотека / кредит", "Продажа своей квартиры", "Пока не решил(а)"],
    applies: (deal) => deal !== "rent",
  },
  {
    key: "term",
    column: "Срок аренды",
    text: () => "На какой срок планируете снимать?",
    options: () => ["От года", "6–12 месяцев", "Меньше полугода"],
    applies: (deal) => deal === "rent",
  },
  {
    key: "comment",
    column: "Пожелания",
    text: () => "Есть ещё что-то, что риелтору важно знать? Напишите своими словами.",
    options: () => [],
    skip: "Нет, всё",
  },
];

// ---------- контакты ----------

export type ContactKey = "consent" | "name" | "phone" | "email" | "social" | "time";
export const CONTACT_KEYS: ContactKey[] = ["consent", "name", "phone", "email", "social", "time"];

export interface Contact {
  consent: boolean;
  name: string;
  phone: string;
  email: string;
  social: string;
  time: string;
}

export const CALL_TIMES = ["Утром", "Днём", "Вечером", "В любое время"];

/** Телефон: 9–15 цифр, допускаются +, пробелы, скобки и дефисы. Возвращает в виде «+375291234567». */
export function normalizePhone(text: string): string | null {
  const cleaned = text.replace(/[\s()\-–]/g, "");
  if (!/^\+?\d{9,15}$/.test(cleaned)) return null;
  const digits = cleaned.replace(/^\+/, "");
  // белорусский номер без кода страны: 029 123 45 67 / 29 123 45 67
  if (/^80\d{9}$/.test(digits)) return "+375" + digits.slice(2);
  if (/^0?(25|29|33|44|17)\d{7}$/.test(digits)) return "+375" + digits.replace(/^0/, "");
  return "+" + digits;
}

export function normalizeEmail(text: string): string | null {
  const t = text.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[a-zа-я]{2,}$/i.test(t) ? t : null;
}
