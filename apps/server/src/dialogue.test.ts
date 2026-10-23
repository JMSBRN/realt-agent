import assert from "node:assert/strict";
import { test } from "node:test";
import { onChoice, onText, type Draft, type Reply, type Step } from "./dialogue.ts";
import { extract } from "./extract.ts";

const RATE = 3;

/** Прогоняет диалог: строки — текст клиента, «btn:…» — нажатие кнопки. */
function talk(messages: string[]): Reply[] {
  let draft: Draft = {};
  let step: Step | null = null;
  const replies: Reply[] = [];
  for (const m of messages) {
    const r: { draft: Draft; reply: Reply } = m.startsWith("btn:")
      ? onChoice(draft, m.slice(4))!
      : onText(draft, step, m, RATE, null);
    draft = r.draft;
    step = r.reply.step;
    replies.push(r.reply);
  }
  return replies;
}

test("вилка бюджета одной фразой — поиск сразу", () => {
  const [r] = talk(["куплю двушку от 60 до 80 тыс $"]);
  assert.equal(r!.search?.deal, "sale");
  assert.deepEqual(r!.search?.rooms, [2]);
  assert.equal(r!.search?.priceMinUsd, 60000);
  assert.equal(r!.search?.priceMaxUsd, 80000);
});

test("вилка без «тыс» при покупке — это тысячи; через тире тоже вилка", () => {
  assert.equal(talk(["купить от 60 до 80"])[0]!.search?.priceMaxUsd, 80000);
  const r = talk(["купить однушку 50-70к"])[0]!;
  assert.equal(r.search?.priceMinUsd, 50000);
  assert.equal(r.search?.priceMaxUsd, 70000);
});

test("пошаговый диалог: бот спрашивает всё по очереди", () => {
  const r = talk(["привет", "btn:d:deal:sale", "2", "до 90 тысяч", "не важно", "не первый", "Уручье"]);
  assert.equal(r[0]!.step, "deal");
  assert.equal(r[1]!.step, "rooms");
  assert.equal(r[2]!.step, "budget");
  assert.equal(r[3]!.step, "area"); // «до 90» — не вилка, спрашиваем дальше
  assert.equal(r[4]!.step, "floor");
  assert.equal(r[5]!.step, "district");
  const final = r[6]!;
  assert.equal(final.step, null);
  assert.deepEqual(final.search, {
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
});

test("вилка кнопкой посреди диалога — поиск без лишних вопросов", () => {
  const r = talk(["снять", "btn:d:rooms:1", "btn:d:budget:400-700"]);
  assert.equal(r[2]!.step, null);
  assert.equal(r[2]!.search?.deal, "rent");
  assert.equal(r[2]!.search?.priceMaxUsd, 700);
});

test("бот берёт из фразы всё, что понял, и спрашивает только недостающее", () => {
  const r = talk(["двушка до 80к"]);
  assert.equal(r[0]!.step, "deal"); // комнаты и бюджет поняты, не хватает «купить или снять»
  assert.match(r[0]!.text, /Комнат: 2/);
});

test("непонятный ответ — переспрашивает тот же вопрос", () => {
  const r = talk(["купить", "сам не знаю"]);
  assert.equal(r[1]!.step, "rooms");
  assert.match(r[1]!.text, /Не совсем понял/);
});

test("после выдачи «а до 120 тысяч?» уточняет прошлый поиск", () => {
  const last = talk(["куплю двушку от 60 до 80 тыс"])[0]!.search!;
  const r = onText({}, null, "а до 120 тысяч?", RATE, last).reply;
  assert.equal(r.search?.priceMaxUsd, 120000);
  assert.deepEqual(r.search?.rooms, [2]);
});

test("extract: комнаты, площадь, этажи, рубли", () => {
  assert.deepEqual(extract("снять 1-2к до 1500 руб от 40 м2 не первый", RATE), {
    deal: "rent",
    rooms: [1, 2],
    priceMaxUsd: 500,
    areaMin: 40,
    notFirstFloor: true,
  });
  assert.deepEqual(extract("купить 2к", RATE), { deal: "sale", rooms: [2] }); // «2к» — комнаты, не цена
});
