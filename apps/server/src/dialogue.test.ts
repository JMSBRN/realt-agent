import assert from "node:assert/strict";
import { test } from "node:test";
import { onChoice, onContact, onText, startContact, type Draft, type Reply, type Step } from "./dialogue.ts";
import { extract } from "./extract.ts";
import { normalizeEmail, normalizePhone } from "./survey.ts";

const RATE = 3;

/** Прогоняет диалог: строки — текст клиента, «btn:…» — кнопка, «tel:…» — «Поделиться номером». */
function talk(messages: string[], start: Draft = {}, startStep: Step | null = null) {
  let draft: Draft = start;
  let step: Step | null = startStep;
  const replies: Reply[] = [];
  for (const m of messages) {
    const r: { draft: Draft; reply: Reply } = m.startsWith("btn:")
      ? onChoice(draft, m.slice(4))!
      : m.startsWith("tel:")
        ? onContact(draft, m.slice(4))
        : onText(draft, step, m, RATE, null);
    draft = r.draft;
    step = r.reply.step;
    replies.push(r.reply);
  }
  return { replies, draft };
}

// ---------- быстрый режим ----------

test("вилка бюджета одной фразой — поиск сразу", () => {
  const r = talk(["куплю двушку от 60 до 80 тыс $"]).replies[0]!;
  assert.equal(r.search?.deal, "sale");
  assert.deepEqual(r.search?.rooms, [2]);
  assert.equal(r.search?.priceMinUsd, 60000);
  assert.equal(r.search?.priceMaxUsd, 80000);
});

test("вилка без «тыс» при покупке — это тысячи; через тире тоже вилка", () => {
  assert.equal(talk(["купить от 60 до 80"]).replies[0]!.search?.priceMaxUsd, 80000);
  const r = talk(["купить однушку 50-70к"]).replies[0]!;
  assert.equal(r.search?.priceMinUsd, 50000);
  assert.equal(r.search?.priceMaxUsd, 70000);
});

test("быстрый режим по шагам: бот спрашивает всё по очереди", () => {
  const { replies: r } = talk(["привет", "btn:d:mode:quick", "купить", "2", "до 90 тысяч", "не важно", "не первый", "Уручье"]);
  assert.deepEqual(
    r.map((x) => x.step),
    ["mode", "deal", "rooms", "budget", "area", "floor", "district", null],
  );
  assert.deepEqual(r[7]!.search, {
    deal: "sale",
    city: "Минск",
    rooms: [2],
    priceMinUsd: null,
    priceMaxUsd: 90000,
    areaMin: null,
    notFirstFloor: true,
    notLastFloor: false,
    keywords: ["Уручье"],
  });
  assert.equal(r[7]!.lead, undefined); // быстрый режим лид не создаёт
});

test("вилка кнопкой посреди быстрого диалога — поиск без лишних вопросов", () => {
  const r = talk(["btn:d:mode:quick", "снять", "btn:d:rooms:1", "btn:d:budget:400-700"]).replies;
  assert.equal(r[3]!.step, null);
  assert.equal(r[3]!.search?.deal, "rent");
  assert.equal(r[3]!.search?.priceMaxUsd, 700);
});

test("бот берёт из фразы всё, что понял, и спрашивает только недостающее", () => {
  const r = talk(["двушка до 80к"]).replies[0]!;
  assert.equal(r.step, "deal");
  assert.match(r.text, /Комнат: 2/);
});

test("непонятный ответ — переспрашивает тот же вопрос", () => {
  const r = talk(["купить", "сам не знаю"]).replies;
  assert.equal(r[1]!.step, "rooms");
  assert.match(r[1]!.text, /Не совсем понял/);
});

test("после выдачи «а до 120 тысяч?» уточняет прошлый поиск", () => {
  const last = talk(["куплю двушку от 60 до 80 тыс"]).replies[0]!.search!;
  const r = onText({}, null, "а до 120 тысяч?", RATE, last).reply;
  assert.equal(r.search?.priceMaxUsd, 120000);
  assert.deepEqual(r.search?.rooms, [2]);
});

// ---------- подробный режим ----------

test("подробный режим: анкета риелтора, контакты, лид и поиск", () => {
  const { replies: r, draft } = talk(
    [
      "btn:d:mode:detailed",
      "btn:d:deal:sale",
      "btn:d:rooms:2",
      "btn:d:budget:60000-90000", // вилка, но в подробном режиме вопросы продолжаются
      "btn:d:area:any",
      "btn:d:floor:nf",
      "Уручье",
      "btn:d:p_purpose:0", // для жизни
      "btn:d:p_household:2", // семья с детьми → вопросы про детей
      "двое, 5 и 9 лет",
      "btn:d:p_school:2",
      "btn:d:p_pets:2", // кошка
      "рядом работа на Немиге",
      "btn:d:p_renovation:0",
      "btn:d:p_building:skip",
      "тихий подъезд, лифт",
      "btn:d:p_timeline:1",
      "btn:d:p_payment:1", // ипотека
      "балкон обязательно",
      "btn:d:c_consent:yes",
      "Анна",
      "+375 (29) 123-45-67",
      "anna@mail.ru",
      "Viber",
      "btn:d:c_time:2",
    ],
    { tgName: "Аня" },
  );
  assert.deepEqual(
    r.map((x) => x.step),
    [
      "deal", "rooms", "budget", "area", "floor", "district",
      "p_purpose", "p_household", "p_kids", "p_school", "p_pets", "p_nearby", "p_renovation",
      "p_building", "p_surroundings", "p_timeline", "p_payment", "p_comment",
      "c_consent", "c_name", "c_phone", "c_email", "c_social", "c_time", null,
    ],
  );
  const final = r.at(-1)!;
  assert.equal(final.lead, true);
  assert.equal(final.search?.priceMaxUsd, 90000);
  assert.match(final.text, /Спасибо, Анна! .* вечером/);
  assert.equal(r[20]!.contactRequest, true); // на вопросе о телефоне — кнопка «Поделиться номером»
  assert.equal(r[21]!.removeKeyboard, true); // после ответа её убираем

  assert.deepEqual(draft.profile, {
    purpose: "Для жизни",
    household: "Семья с детьми",
    kids: "двое, 5 и 9 лет",
    school: "И школа, и садик",
    pets: "Кошка",
    nearby: "рядом работа на Немиге",
    renovation: "С ремонтом — заехать и жить",
    building: "",
    surroundings: "тихий подъезд, лифт",
    timeline: "В ближайшие 1–3 месяца",
    payment: "Ипотека / кредит",
    comment: "балкон обязательно",
  });
  assert.deepEqual(draft.contact, {
    consent: true,
    name: "Анна",
    phone: "+375291234567",
    email: "anna@mail.ru",
    social: "Viber",
    time: "Вечером",
  });
});

test("аренда: без вопросов про ипотеку и тип дома, но со сроком аренды; без детей — без школы", () => {
  const { replies: r } = talk([
    "btn:d:mode:detailed", "снять", "1", "до 500", "не важно", "не важно", "любой",
    "btn:d:p_purpose:0", "btn:d:p_household:0", "btn:d:p_pets:0", "btn:d:p_nearby:0",
    "btn:d:p_renovation:2", "btn:d:p_surroundings:3", "btn:d:p_timeline:0",
  ]);
  const steps = r.map((x) => x.step);
  assert.ok(!steps.includes("p_payment") && !steps.includes("p_building") && !steps.includes("p_school"));
  assert.equal(steps.at(-1), "p_term");
});

test("контакты: неверный телефон и почта переспрашиваются, «Поделиться номером» принимается", () => {
  const start: Draft = { mode: "detailed", contactOnly: true, contact: { consent: true, name: "Олег" } };
  const r = talk(["12345", "tel:375291112233", "не почта", "oleg@gmail.com"], start, "c_phone").replies;
  assert.equal(r[0]!.step, "c_phone");
  assert.match(r[0]!.text, /Не похоже на номер/);
  assert.equal(r[1]!.step, "c_email");
  assert.equal(r[2]!.step, "c_email");
  assert.match(r[2]!.text, /Не похоже на почту/);
  assert.equal(r[3]!.step, "c_social");
});

test("«Связаться с риелтором» после быстрого поиска: только контакты, лид без нового поиска", () => {
  const last = talk(["куплю двушку от 60 до 80 тыс"]).replies[0]!.search!;
  const s = startContact(last, "Иван");
  assert.equal(s.reply.step, "c_consent");
  const { replies: r, draft } = talk(
    ["btn:d:c_consent:yes", "btn:d:c_name:tg", "tel:+375441234567", "btn:d:c_email:skip", "btn:d:c_social:tg", "btn:d:c_time:3"],
    s.draft,
    "c_consent",
  );
  const final = r.at(-1)!;
  assert.equal(final.lead, true);
  assert.equal(final.search, undefined);
  assert.equal(draft.contact?.name, "Иван");
  assert.equal(draft.budget?.max, 80000); // параметры поиска сохранены для лида
});

test("отказ от контактов — без лида, поиск всё равно идёт", () => {
  const start: Draft = { mode: "detailed", deal: "sale", rooms: [1], budget: { min: null, max: 60000 }, areaMin: null,
    floor: { notFirst: false, notLast: false }, district: null,
    profile: Object.fromEntries(["purpose", "household", "pets", "nearby", "renovation", "building", "surroundings", "timeline", "payment", "comment"].map((k) => [k, ""])) };
  const r = talk(["btn:d:c_consent:no"], start, "c_consent").replies[0]!;
  assert.equal(r.lead, false);
  assert.equal(r.search?.priceMaxUsd, 60000);
});

// ---------- разбор ----------

test("телефон и почта", () => {
  assert.equal(normalizePhone("+375 (29) 123-45-67"), "+375291234567");
  assert.equal(normalizePhone("8 029 123 45 67"), "+375291234567");
  assert.equal(normalizePhone("29 1234567"), "+375291234567");
  assert.equal(normalizePhone("12345"), null);
  assert.equal(normalizeEmail(" Anna@Mail.ru "), "anna@mail.ru");
  assert.equal(normalizeEmail("anna@mail"), null);
});

test("extract: комнаты, площадь, этажи, рубли", () => {
  assert.deepEqual(extract("снять 1-2к до 1500 руб от 40 м2 не первый", RATE), {
    deal: "rent",
    rooms: [1, 2],
    priceMaxUsd: 500,
    areaMin: 40,
    notFirstFloor: true,
  });
  assert.deepEqual(extract("купить 2к", RATE), { deal: "sale", rooms: [2] });
});
