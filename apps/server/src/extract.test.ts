import assert from "node:assert/strict";
import { test } from "node:test";
import { extract } from "./extract.ts";

const RATE = 3;
const p = (text: string) => extract(text, RATE);

test("купить однушку до 40 тысяч долларов", () => {
  assert.deepEqual(p("найди однокомнатную квартиру в Минске купить до 40 тысяч долларов"), {
    deal: "sale",
    rooms: [1],
    priceMaxUsd: 40000,
  });
});

test("разные записи цены", () => {
  assert.equal(p("куплю 2к до 85к$").priceMaxUsd, 85000);
  assert.equal(p("куплю до 120 000 usd").priceMaxUsd, 120000);
  assert.equal(p("куплю квартиру до 0,5 млн").priceMaxUsd, 500000);
  assert.equal(p("снять до 1500 руб").priceMaxUsd, 500); // BYN → USD по курсу 3
  assert.equal(p("снять до 600").priceMaxUsd, 600);
  assert.equal(p("80000\nкупить").priceMaxUsd, 80000);
  assert.equal(p("купить двушку 70к $").priceMaxUsd, 70000);
  assert.equal(p("купить 2к").priceMaxUsd, undefined); // «2к» — комнаты
  assert.equal(p("купить 1к от 30 м2").priceMaxUsd, undefined);
  const range = p("купить от 30 до 50 тыс");
  assert.equal(range.priceMinUsd, 30000);
  assert.equal(range.priceMaxUsd, 50000);
});

test("комнаты", () => {
  assert.deepEqual(p("снять двушку").rooms, [2]);
  assert.deepEqual(p("снять трёшку").rooms, [3]);
  assert.deepEqual(p("купить 2-комн или 3-комн").rooms, [2, 3]);
  assert.deepEqual(p("купить 1-2к").rooms, [1, 2]);
  assert.equal(p("купить квартиру").rooms, undefined);
});

test("площадь не путается с ценой, этажи", () => {
  const r = p("купить от 40 м2 до 70 тыс $ не первый и не последний этаж");
  assert.equal(r.areaMin, 40);
  assert.equal(r.priceMinUsd, undefined);
  assert.equal(r.priceMaxUsd, 70000);
  assert.equal(r.notFirstFloor, true);
  assert.equal(r.notLastFloor, true);
});
